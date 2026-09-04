//! Dual-stream capture session.
//!
//! Owns one thread per stream and the shared stop signal, and produces two
//! WAV files in a session directory:
//!
//! ```text
//! <sessions>/<session-id>/mic.wav
//! <sessions>/<session-id>/system.wav
//! ```
//!
//! # Alignment
//!
//! The two streams run on independent device clocks and their devices take
//! different amounts of time to initialise — WASAPI loopback in particular has
//! to enumerate and open a render endpoint. So the files do **not** start at
//! the same instant, and lining them up by index would drift the transcripts
//! apart over a long meeting.
//!
//! Each stream therefore records the offset, from a single session clock, at
//! which its *first* sample arrived. Downstream, a segment's true session time
//! is `stream_offset_ms + (frame_index / sample_rate)`. That is the only
//! honest way to relate two independently-clocked recordings.
//!
//! # Partial failure
//!
//! One stream failing does not stop the other. If the microphone is missing
//! but system audio works, capturing one side of a meeting is far better than
//! capturing none — the outcome is reported per stream rather than collapsing
//! to a single error.

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Instant;

use super::{AudioError, StopSignal, StreamFormat, StreamSource, StreamStats};

/// What one stream did over the course of a session.
#[derive(Debug, Clone, serde::Serialize)]
pub struct StreamOutcome {
    pub source: StreamSource,
    pub path: PathBuf,
    pub device_name: String,
    pub sample_rate: u32,
    pub frames_captured: u64,
    pub chunks_dropped: u64,
    /// Offset from session start at which this stream's first sample arrived.
    pub start_offset_ms: u64,
    /// `None` on success; the failure reason otherwise.
    pub error: Option<String>,
}

impl StreamOutcome {
    /// Whether this stream produced anything usable.
    pub fn is_usable(&self) -> bool {
        self.error.is_none() && self.frames_captured > 0
    }

    pub fn duration_secs(&self) -> f64 {
        if self.sample_rate == 0 {
            return 0.0;
        }
        self.frames_captured as f64 / self.sample_rate as f64
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SessionSummary {
    pub session_id: String,
    pub directory: PathBuf,
    pub streams: Vec<StreamOutcome>,
}

impl SessionSummary {
    /// A session is a failure only if *neither* stream captured anything.
    pub fn captured_anything(&self) -> bool {
        self.streams.iter().any(StreamOutcome::is_usable)
    }
}

struct StreamThread {
    source: StreamSource,
    path: PathBuf,
    stats: Arc<StreamStats>,
    handle: JoinHandle<Result<StreamFormat, AudioError>>,
}

pub struct CaptureSession {
    session_id: String,
    directory: PathBuf,
    stop: StopSignal,
    clock: Instant,
    threads: Vec<StreamThread>,
}

impl CaptureSession {
    /// Start capturing both streams into `directory`.
    ///
    /// Returns as soon as the threads are spawned; device initialisation
    /// happens on those threads, so a slow device cannot block the caller.
    /// `mic_device` selects an input by name; `None` uses the system default.
    /// See `mic::run_capture` for why naming the device matters.
    pub fn start(
        session_id: impl Into<String>,
        directory: impl AsRef<Path>,
        mic_device: Option<String>,
    ) -> Self {
        let session_id = session_id.into();
        let directory = directory.as_ref().to_path_buf();
        let stop = StopSignal::new();
        let clock = Instant::now();

        // The microphone is the one stream every platform has. System audio is
        // appended per-platform; `mut` is unused where no backend exists yet.
        #[cfg_attr(not(target_os = "windows"), allow(unused_mut))]
        let mut threads = vec![spawn_stream(
            StreamSource::Microphone,
            &directory,
            &stop,
            clock,
            move |path, stats, stop, clock| {
                super::mic::run_capture(path, stats, stop, clock, mic_device)
            },
        )];

        #[cfg(target_os = "windows")]
        threads.push(spawn_stream(
            StreamSource::System,
            &directory,
            &stop,
            clock,
            super::loopback_win::run_capture,
        ));

        Self {
            session_id,
            directory,
            stop,
            clock,
            threads,
        }
    }

    /// Live stats for the meters, cheap enough to poll at UI frame rate.
    pub fn levels(&self) -> Vec<(StreamSource, f32)> {
        self.threads
            .iter()
            .map(|t| (t.source, t.stats.level()))
            .collect()
    }

    pub fn elapsed_ms(&self) -> u64 {
        self.clock.elapsed().as_millis() as u64
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    /// Signal both streams to stop, wait for them, and finalise both files.
    ///
    /// Consumes the session: a stopped capture cannot be restarted, because
    /// its WAV headers have already been rewritten.
    pub fn stop(self) -> SessionSummary {
        self.stop.stop();

        let streams = self
            .threads
            .into_iter()
            .map(|thread| {
                let stats = Arc::clone(&thread.stats);
                let source = thread.source;
                let path = thread.path.clone();

                // A panicked capture thread must not panic the caller — a
                // meeting recorder reports what it salvaged.
                let (sample_rate, device_name, error) = match thread.handle.join() {
                    Ok(Ok(format)) => (format.sample_rate, format.device_name, None),
                    Ok(Err(e)) => (0, String::new(), Some(e.to_string())),
                    Err(_) => (
                        0,
                        String::new(),
                        Some("capture thread panicked".to_string()),
                    ),
                };

                StreamOutcome {
                    source,
                    path,
                    device_name,
                    sample_rate,
                    frames_captured: stats.frames_captured.load(Ordering::Relaxed),
                    chunks_dropped: stats.chunks_dropped.load(Ordering::Relaxed),
                    start_offset_ms: stats.start_offset_ms().unwrap_or(0),
                    error,
                }
            })
            .collect();

        SessionSummary {
            session_id: self.session_id,
            directory: self.directory,
            streams,
        }
    }
}

fn spawn_stream<F>(
    source: StreamSource,
    directory: &Path,
    stop: &StopSignal,
    clock: Instant,
    run: F,
) -> StreamThread
where
    F: FnOnce(PathBuf, Arc<StreamStats>, StopSignal, Instant) -> Result<StreamFormat, AudioError>
        + Send
        + 'static,
{
    let path = directory.join(format!("{}.wav", source.file_stem()));
    let stats = Arc::new(StreamStats::default());

    let thread_path = path.clone();
    let thread_stats = Arc::clone(&stats);
    let thread_stop = stop.clone();

    let handle = std::thread::Builder::new()
        .name(format!("trace-capture-{}", source.file_stem()))
        .spawn(move || run(thread_path, thread_stats, thread_stop, clock))
        .expect("failed to spawn capture thread");

    StreamThread {
        source,
        path,
        stats,
        handle,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn outcome(frames: u64, rate: u32, error: Option<&str>) -> StreamOutcome {
        StreamOutcome {
            source: StreamSource::Microphone,
            path: PathBuf::from("x.wav"),
            device_name: "test".into(),
            sample_rate: rate,
            frames_captured: frames,
            chunks_dropped: 0,
            start_offset_ms: 0,
            error: error.map(String::from),
        }
    }

    #[test]
    fn a_stream_with_frames_and_no_error_is_usable() {
        assert!(outcome(16_000, 16_000, None).is_usable());
    }

    #[test]
    fn a_silent_stream_is_not_usable() {
        // Zero frames means the device opened but delivered nothing — the
        // exact symptom of a loopback that failed quietly.
        assert!(!outcome(0, 48_000, None).is_usable());
    }

    #[test]
    fn an_errored_stream_is_not_usable_even_with_frames() {
        assert!(!outcome(1000, 48_000, Some("device lost")).is_usable());
    }

    #[test]
    fn duration_is_derived_from_the_streams_own_rate() {
        assert!((outcome(48_000, 48_000, None).duration_secs() - 1.0).abs() < f64::EPSILON);
        assert!((outcome(16_000, 16_000, None).duration_secs() - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn zero_sample_rate_does_not_divide_by_zero() {
        assert_eq!(outcome(1000, 0, Some("failed")).duration_secs(), 0.0);
    }

    #[test]
    fn a_session_survives_one_stream_failing() {
        let summary = SessionSummary {
            session_id: "s".into(),
            directory: PathBuf::from("d"),
            streams: vec![
                outcome(0, 0, Some("no microphone")),
                StreamOutcome {
                    source: StreamSource::System,
                    ..outcome(48_000, 48_000, None)
                },
            ],
        };
        assert!(
            summary.captured_anything(),
            "one working stream must still yield a usable session"
        );
    }

    #[test]
    fn a_session_with_both_streams_dead_captured_nothing() {
        let summary = SessionSummary {
            session_id: "s".into(),
            directory: PathBuf::from("d"),
            streams: vec![outcome(0, 0, Some("a")), outcome(0, 0, Some("b"))],
        };
        assert!(!summary.captured_anything());
    }
}
