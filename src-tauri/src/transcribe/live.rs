//! Live transcription during capture.
//!
//! ```text
//!   capture thread ──tap──> bounded channel ──> worker thread
//!    (never blocks)          (drops when full)   chunk -> resample -> ASR
//!                                                        │
//!                                                        └──> Segment events
//! ```
//!
//! Inference runs on its own thread, never on a capture thread. Parakeet takes
//! hundreds of milliseconds per chunk; blocking a capture thread for that long
//! would drop audio, and dropping audio to produce a *provisional* transcript
//! would be a bad trade — the recording is the thing that must not be lost.
//!
//! # Provisional output
//!
//! Segments emitted here are marked provisional. They come from chunks decided
//! on a prefix of the stream, and the accurate re-pass at the end of the
//! meeting supersedes them. Because [`super::streaming`] and
//! [`super::chunker`] agree on boundaries, that re-pass refines text rather
//! than reshuffling the transcript.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

use crossbeam_channel::{bounded, Receiver, Sender, TrySendError};

use super::chunker::ChunkConfig;
use super::streaming::StreamingChunker;
use super::{secs_to_ms, Segment, Transcriber};
use crate::audio::resample::to_16k;
use crate::audio::StreamSource;

/// Audio handed from a capture thread to the transcription worker.
pub struct AudioTap {
    pub source: StreamSource,
    pub sample_rate: u32,
    /// Mono samples at `sample_rate`.
    pub samples: Vec<f32>,
    /// Frames of unmaterialised silence preceding `samples`.
    pub leading_silence_frames: u64,
    /// This stream's offset from the session clock, for timeline alignment.
    pub start_offset_ms: u64,
}

/// Something the worker produced.
#[derive(Debug, Clone)]
pub enum LiveEvent {
    /// A provisional segment. Superseded by the final pass.
    Segment(Segment),
    /// Transcription failed for one chunk. Capture is unaffected.
    Error {
        source: StreamSource,
        message: String,
    },
}

/// How far the worker may fall behind before it starts discarding audio.
///
/// Sized against what actually has to be absorbed, not picked round. Capture
/// delivers roughly 100 blocks per second per stream, and inference on a
/// 20-second chunk takes on the order of a second, during which blocks keep
/// arriving from both streams. At 64 this held only ~300 ms of audio and
/// dropped on every chunk — measured.
///
/// Each block is ~10 ms of mono f32, so 4000 slots is about 20 seconds of
/// headroom per stream and a few megabytes at worst.
///
/// Live transcription remains best-effort: the WAV on disk is the source of
/// truth and the final pass reads that, so a drop here costs a provisional
/// segment rather than any recorded audio.
const QUEUE_CAPACITY: usize = 4000;

/// A running live-transcription worker.
pub struct LiveTranscriber {
    tx: Sender<AudioTap>,
    events: Receiver<LiveEvent>,
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
    dropped: Arc<AtomicBool>,
}

impl LiveTranscriber {
    /// Start a worker with an already-loaded engine.
    ///
    /// Loading is the caller's job because it takes about a second and should
    /// happen before capture starts, not during the first utterance.
    pub fn start(mut engine: Transcriber) -> Self {
        let (tx, rx) = bounded::<AudioTap>(QUEUE_CAPACITY);
        let (event_tx, events) = bounded::<LiveEvent>(256);
        let stop = Arc::new(AtomicBool::new(false));
        let dropped = Arc::new(AtomicBool::new(false));

        let worker_stop = Arc::clone(&stop);
        let handle = std::thread::Builder::new()
            .name("trace-live-transcribe".into())
            .spawn(move || worker(&mut engine, rx, event_tx, worker_stop))
            .expect("failed to spawn transcription worker");

        Self {
            tx,
            events,
            stop,
            handle: Some(handle),
            dropped,
        }
    }

    /// Hand audio to the worker. Never blocks.
    ///
    /// Returns `false` if the queue was full and this audio was discarded.
    pub fn submit(&self, tap: AudioTap) -> bool {
        match self.tx.try_send(tap) {
            Ok(()) => true,
            Err(TrySendError::Full(_)) => {
                self.dropped.store(true, Ordering::Relaxed);
                false
            }
            Err(TrySendError::Disconnected(_)) => false,
        }
    }

    /// Segments produced so far, without blocking.
    pub fn poll(&self) -> Vec<LiveEvent> {
        self.events.try_iter().collect()
    }

    /// Whether any audio was ever discarded, so the UI can be honest that the
    /// live transcript has holes the final one will not.
    pub fn dropped_audio(&self) -> bool {
        self.dropped.load(Ordering::Relaxed)
    }

    /// Stop the worker, drain the queue, and return any final events.
    pub fn stop(mut self) -> Vec<LiveEvent> {
        self.stop.store(true, Ordering::Relaxed);
        drop(std::mem::replace(&mut self.tx, bounded(1).0));

        if let Some(handle) = self.handle.take() {
            handle.join().ok();
        }
        self.events.try_iter().collect()
    }
}

fn worker(
    engine: &mut Transcriber,
    rx: Receiver<AudioTap>,
    events: Sender<LiveEvent>,
    stop: Arc<AtomicBool>,
) {
    // One chunker per stream: the microphone and the system audio have
    // independent silence patterns and must be segmented separately.
    let mut mic: Option<(StreamingChunker, u32, u64)> = None;
    let mut system: Option<(StreamingChunker, u32, u64)> = None;

    let mut counters = (0usize, 0usize);

    while let Ok(tap) = rx.recv() {
        let slot = match tap.source {
            StreamSource::Microphone => &mut mic,
            StreamSource::System => &mut system,
        };

        let (chunker, rate, offset) = slot.get_or_insert_with(|| {
            (
                StreamingChunker::new(ChunkConfig::live(tap.sample_rate)),
                tap.sample_rate,
                tap.start_offset_ms,
            )
        });
        let rate = *rate;
        let offset = *offset;

        // Replay any skipped silence first, so the chunker sees the real
        // timeline and can split on gaps rather than only at its ceiling.
        let mut produced = chunker.push_silence(tap.leading_silence_frames);
        produced.extend(chunker.push(&tap.samples));

        for chunk in produced {
            let chunk_start_ms = offset + chunk.start_ms(rate);
            emit(
                engine,
                &events,
                &mut counters,
                tap.source,
                &chunk.samples,
                rate,
                chunk_start_ms,
            );
        }

        if stop.load(Ordering::Relaxed) {
            break;
        }
    }

    // Capture has ended: flush each stream's trailing utterance, which is
    // frequently where a meeting's conclusion lives.
    for (source, slot) in [
        (StreamSource::Microphone, &mut mic),
        (StreamSource::System, &mut system),
    ] {
        if let Some((chunker, rate, offset)) = slot {
            if let Some(chunk) = chunker.flush() {
                let chunk_start_ms = *offset + chunk.start_ms(*rate);
                emit(
                    engine,
                    &events,
                    &mut counters,
                    source,
                    &chunk.samples,
                    *rate,
                    chunk_start_ms,
                );
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn emit(
    engine: &mut Transcriber,
    events: &Sender<LiveEvent>,
    counters: &mut (usize, usize),
    source: StreamSource,
    samples: &[f32],
    rate: u32,
    chunk_start_ms: u64,
) {
    // Resample here, not in the capture path: a chunk is bounded, so this is a
    // one-shot conversion with no state to carry across callbacks.
    let samples16 = match to_16k(samples, rate) {
        Ok(s) => s,
        Err(e) => {
            let _ = events.send(LiveEvent::Error {
                source,
                message: format!("resample failed: {e}"),
            });
            return;
        }
    };

    // Timing is opt-in via TRACE_LIVE_TIMING, so a lagging worker can be
    // diagnosed on a real meeting without shipping noise by default.
    let timing = std::env::var_os("TRACE_LIVE_TIMING").is_some();
    let started = std::time::Instant::now();

    let raw = match engine.transcribe_chunk(&samples16) {
        Ok(segments) => segments,
        Err(e) => {
            // One failed chunk must not end the meeting's transcription.
            let _ = events.send(LiveEvent::Error {
                source,
                message: e.to_string(),
            });
            return;
        }
    };

    if timing {
        eprintln!(
            "  [timing] {source:?} chunk {:.1}s -> inference {:.0}ms",
            samples16.len() as f64 / 16_000.0,
            started.elapsed().as_secs_f64() * 1000.0
        );
    }

    let (prefix, counter) = match source {
        StreamSource::Microphone => ("mic", &mut counters.0),
        StreamSource::System => ("sys", &mut counters.1),
    };

    for seg in raw {
        let text = seg.text.trim();
        if text.is_empty() {
            continue;
        }
        let segment = Segment {
            id: format!("{prefix}_{:04}", *counter),
            start_ms: chunk_start_ms + secs_to_ms(seg.start),
            end_ms: chunk_start_ms + secs_to_ms(seg.end),
            text: text.to_string(),
            source,
        };
        *counter += 1;

        // A full event queue means nobody is reading; dropping is correct.
        if events.send(LiveEvent::Segment(segment)).is_err() {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::resample::TARGET_SAMPLE_RATE;

    #[test]
    fn chunk_config_scales_with_sample_rate() {
        let base = ChunkConfig::default();
        let at48 = ChunkConfig::for_rate(48_000);

        // 48 kHz is exactly 3x the target rate.
        assert_eq!(at48.frame_size, base.frame_size * 3);
        assert_eq!(at48.hard_max_samples, base.hard_max_samples * 3);
        assert_eq!(at48.pad_samples, base.pad_samples * 3);

        // Frame-counted and amplitude thresholds must not scale.
        assert_eq!(at48.silence_frames, base.silence_frames);
        assert_eq!(at48.energy_threshold, base.energy_threshold);
    }

    #[test]
    fn chunk_config_at_target_rate_is_the_default() {
        assert_eq!(
            ChunkConfig::for_rate(TARGET_SAMPLE_RATE).frame_size,
            ChunkConfig::default().frame_size
        );
    }

    #[test]
    fn chunk_config_survives_a_zero_rate() {
        // Never divide by zero on a device that reports nonsense.
        let c = ChunkConfig::for_rate(0);
        assert!(c.frame_size > 0);
    }

    #[test]
    fn a_frame_stays_thirty_milliseconds_at_any_rate() {
        for rate in [16_000u32, 44_100, 48_000, 96_000] {
            let c = ChunkConfig::for_rate(rate);
            let ms = c.frame_size as f64 * 1000.0 / rate as f64;
            assert!((ms - 30.0).abs() < 2.0, "{rate} Hz gave a {ms:.1} ms frame");
        }
    }
}
