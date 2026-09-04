//! Dual-stream audio capture.
//!
//! TRACE captures the microphone and the system output as **two independent
//! streams**, written to two separate files. This is the single most important
//! decision in the audio layer: because each stream has a known origin, every
//! transcript segment already knows whether the local user said it or a remote
//! participant did. Speaker attribution falls out of the audio topology rather
//! than requiring a diarisation model.
//!
//! Platform split (`cpal` cannot do Windows loopback — see RustAudio/cpal#476):
//!
//! | Stream     | Windows                  | macOS (later)        |
//! |------------|--------------------------|----------------------|
//! | Microphone | `cpal`                   | `cpal`               |
//! | System     | `wasapi` (loopback_win)  | `cpal` 0.18 / ScreenCaptureKit |
//!
//! # Measured: separation holds on headphones
//!
//! Verified in M1 over a real 30-second capture with speech on both sides.
//! Cross-stream Pearson correlation was **+0.000** — the two streams are
//! genuinely independent signals, which is the premise the whole attribution
//! design rests on. Run `wav_check` against a session to re-measure it.
//!
//! The untested case is **open speakers**, where the microphone would pick up
//! the system output acoustically and the remote voice would land in both
//! streams. That has not been observed here, only reasoned about, so treat it
//! as an open risk rather than a known defect. Should it prove real, the fix
//! is acoustic echo cancellation (the `wasapi` crate ships an `aec.rs`
//! example) — not a change to the stream topology.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

pub mod mic;
pub mod resample;
pub mod session;
pub mod wav;

#[cfg(target_os = "windows")]
pub mod loopback_win;

/// Which physical stream a chunk of audio came from.
///
/// Mirrors `AudioSource` in `src/lib/types.ts`; the two must stay in step until
/// `tauri-specta` generates the TypeScript side.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StreamSource {
    Microphone,
    System,
}

impl StreamSource {
    /// Filename stem used for this stream's WAV within a session directory.
    pub fn file_stem(self) -> &'static str {
        match self {
            StreamSource::Microphone => "mic",
            StreamSource::System => "system",
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AudioError {
    #[error("no {0} device available")]
    NoDevice(&'static str),
    #[error("device configuration rejected: {0}")]
    Config(String),
    #[error("failed to build audio stream: {0}")]
    BuildStream(String),
    #[error("capture backend failed: {0}")]
    Backend(String),
    #[error("wav write failed: {0}")]
    Wav(#[from] hound::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

/// The native format a capture stream is delivering.
///
/// Streams are **not** resampled during capture. The mic and the loopback run
/// on independent device clocks at whatever rate the hardware prefers, and
/// converting mid-capture would mean doing sample-rate conversion inside a
/// realtime callback. Both files are written at their native rate and
/// resampled to 16 kHz later, when feeding the ASR (M2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamFormat {
    pub sample_rate: u32,
    /// Channel count *as delivered by the device*. Chunks are downmixed to
    /// mono before they leave the callback, so files are always 1-channel.
    pub source_channels: u16,
    /// Which endpoint was actually opened.
    ///
    /// Worth surfacing, not just logging: on a machine with virtual audio
    /// devices (NVIDIA Broadcast, VoiceMeeter, VB-Cable) the *default* endpoint
    /// is frequently a virtual one that emits digital silence when its source
    /// app isn't running. The recording then succeeds and contains nothing,
    /// which is the worst possible failure for a meeting recorder. Naming the
    /// device is what makes that diagnosable.
    pub device_name: String,
}

/// Sentinel for `start_offset_ms` before any sample has arrived.
const OFFSET_UNSET: u64 = u64::MAX;

/// Counters shared between a capture thread and the rest of the app.
///
/// All fields are atomics because they are written from a realtime audio
/// callback, which must never block. Reading a slightly stale value in the UI
/// is fine; stalling the audio thread on a mutex is not.
#[derive(Debug)]
pub struct StreamStats {
    /// Mono frames successfully handed to the writer.
    pub frames_captured: AtomicU64,
    /// Chunks discarded because the writer could not keep up. Any non-zero
    /// value here means the recording has gaps and must be surfaced, not
    /// silently tolerated — this is a meeting recorder.
    pub chunks_dropped: AtomicU64,
    /// Errors reported by the audio backend.
    ///
    /// Deliberately separate from `chunks_dropped`. Counting a device error as
    /// a dropped chunk conflates "the driver complained" with "we lost audio",
    /// and the two demand different responses: the first is usually a benign
    /// startup underrun, the second means the recording has a hole in it.
    pub stream_errors: AtomicU64,
    /// Most recent RMS level, scaled to 0..=10_000 so it fits an integer
    /// atomic. Divide by 10_000.0 for the 0..=1 value the meters want.
    pub level_milli: AtomicU64,
    /// Offset from the shared session clock at which this stream's first
    /// sample arrived, or `OFFSET_UNSET`. Streams do not start together —
    /// opening a WASAPI loopback endpoint takes materially longer than
    /// opening a microphone — so this is what makes the two files alignable.
    pub start_offset_ms: AtomicU64,
    /// Frames of silence written to fill spans the backend skipped.
    ///
    /// Expected to be large for system audio in a normal meeting: an idle
    /// render endpoint sends nothing, so every quiet stretch is padded. A
    /// value of zero on a long capture is the suspicious case, not a high one.
    pub silence_padded_frames: AtomicU64,
}

impl Default for StreamStats {
    fn default() -> Self {
        Self {
            frames_captured: AtomicU64::new(0),
            chunks_dropped: AtomicU64::new(0),
            stream_errors: AtomicU64::new(0),
            level_milli: AtomicU64::new(0),
            start_offset_ms: AtomicU64::new(OFFSET_UNSET),
            silence_padded_frames: AtomicU64::new(0),
        }
    }
}

impl StreamStats {
    pub fn level(&self) -> f32 {
        self.level_milli.load(Ordering::Relaxed) as f32 / 10_000.0
    }

    /// Record when the first sample arrived, relative to the session clock.
    ///
    /// Only the first call has any effect; later chunks leave it alone.
    pub fn mark_first_sample(&self, clock: std::time::Instant) {
        let elapsed = clock.elapsed().as_millis() as u64;
        // compare_exchange rather than a check-then-set: the writer thread and
        // the audio callback can both reach this.
        let _ = self.start_offset_ms.compare_exchange(
            OFFSET_UNSET,
            elapsed,
            Ordering::Relaxed,
            Ordering::Relaxed,
        );
    }

    /// `None` if this stream never delivered a sample.
    pub fn start_offset_ms(&self) -> Option<u64> {
        match self.start_offset_ms.load(Ordering::Relaxed) {
            OFFSET_UNSET => None,
            ms => Some(ms),
        }
    }

    pub fn record_level(&self, samples: &[f32]) {
        if samples.is_empty() {
            return;
        }
        let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
        let rms = (sum_sq / samples.len() as f32).sqrt();
        let scaled = (rms.clamp(0.0, 1.0) * 10_000.0) as u64;
        self.level_milli.store(scaled, Ordering::Relaxed);
    }
}

/// Cooperative stop flag, shared with capture threads.
///
/// Capture backends poll this rather than being killed, so that WASAPI/COM
/// teardown and the WAV header rewrite both happen on the owning thread.
#[derive(Debug, Clone, Default)]
pub struct StopSignal(Arc<AtomicBool>);

impl StopSignal {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn stop(&self) {
        self.0.store(true, Ordering::Relaxed);
    }

    pub fn is_stopped(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }
}

/// Downmix an interleaved frame buffer to mono by averaging channels.
///
/// Averaging rather than taking channel 0: a stereo system-audio stream can
/// legitimately carry a speaker only in one channel, and dropping a channel
/// would silence them entirely.
pub fn downmix_to_mono(interleaved: &[f32], channels: u16) -> Vec<f32> {
    let channels = channels.max(1) as usize;
    if channels == 1 {
        return interleaved.to_vec();
    }
    interleaved
        .chunks_exact(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mono_passthrough_is_unchanged() {
        let input = vec![0.1, -0.2, 0.3];
        assert_eq!(downmix_to_mono(&input, 1), input);
    }

    #[test]
    fn stereo_averages_both_channels() {
        // L=1.0 R=0.0 -> 0.5, L=-1.0 R=1.0 -> 0.0
        let input = vec![1.0, 0.0, -1.0, 1.0];
        assert_eq!(downmix_to_mono(&input, 2), vec![0.5, 0.0]);
    }

    #[test]
    fn a_speaker_in_one_channel_survives_the_downmix() {
        // Regression guard: taking channel 0 instead of averaging would
        // silence anyone panned hard right.
        let right_only = vec![0.0, 0.8];
        assert_eq!(downmix_to_mono(&right_only, 2), vec![0.4]);
    }

    #[test]
    fn partial_trailing_frame_is_discarded_not_misaligned() {
        // chunks_exact drops the remainder; a partial frame would otherwise
        // shift every subsequent sample into the wrong channel.
        let input = vec![1.0, 1.0, 0.5];
        assert_eq!(downmix_to_mono(&input, 2), vec![1.0]);
    }

    #[test]
    fn zero_channels_is_treated_as_mono_rather_than_dividing_by_zero() {
        let input = vec![0.25, 0.5];
        assert_eq!(downmix_to_mono(&input, 0), input);
    }

    #[test]
    fn level_is_rms_not_peak() {
        let stats = StreamStats::default();
        // Full-scale square wave: RMS == 1.0
        stats.record_level(&[1.0, -1.0, 1.0, -1.0]);
        assert!((stats.level() - 1.0).abs() < 1e-3);

        stats.record_level(&[0.0, 0.0]);
        assert_eq!(stats.level(), 0.0);
    }

    #[test]
    fn empty_buffer_leaves_the_previous_level_untouched() {
        let stats = StreamStats::default();
        stats.record_level(&[1.0, -1.0]);
        stats.record_level(&[]);
        assert!(
            stats.level() > 0.9,
            "an empty callback must not blank the meter"
        );
    }

    #[test]
    fn stop_signal_is_observable_through_a_clone() {
        let a = StopSignal::new();
        let b = a.clone();
        assert!(!b.is_stopped());
        a.stop();
        assert!(b.is_stopped(), "clones must share the underlying flag");
    }
}

/// A selectable capture endpoint.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DeviceInfo {
    pub name: String,
    pub is_default: bool,
}

/// Enumerate microphone input devices.
///
/// TRACE needs this because the *default* input is often not the one the user
/// means. Virtual devices (NVIDIA Broadcast, VoiceMeeter, VB-Cable) routinely
/// install themselves as default and return silence unless their host app is
/// running — producing a recording that succeeds and contains nothing.
pub fn list_input_devices() -> Vec<DeviceInfo> {
    use cpal::traits::HostTrait;

    let host = cpal::default_host();
    let default_name = host
        .default_input_device()
        .map(|d| d.to_string())
        .unwrap_or_default();

    host.input_devices()
        .map(|devices| {
            devices
                .map(|d| d.to_string())
                .map(|name| DeviceInfo {
                    is_default: name == default_name,
                    name,
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Enumerate playback endpoints, which are what loopback captures *from*.
pub fn list_output_devices() -> Vec<DeviceInfo> {
    use cpal::traits::HostTrait;

    let host = cpal::default_host();
    let default_name = host
        .default_output_device()
        .map(|d| d.to_string())
        .unwrap_or_default();

    host.output_devices()
        .map(|devices| {
            devices
                .map(|d| d.to_string())
                .map(|name| DeviceInfo {
                    is_default: name == default_name,
                    name,
                })
                .collect()
        })
        .unwrap_or_default()
}

/// A block of captured audio, handed to any live consumer.
///
/// Defined here rather than in `transcribe` so the capture layer stays
/// independent of what happens to the audio downstream.
#[derive(Debug, Clone)]
pub struct CapturedAudio {
    pub source: StreamSource,
    pub sample_rate: u32,
    /// Mono samples at `sample_rate`, exactly as written to the WAV.
    pub samples: Vec<f32>,
    /// Frames of silence that precede `samples` and were never materialised.
    ///
    /// WASAPI loopback emits nothing while the render endpoint is idle, so
    /// quiet spans are padded. Shipping that padding as real samples floods
    /// the tap — measured: it pushed the worker into dropping audio. Sending
    /// the gap length instead costs nothing and lets the consumer synthesise
    /// it locally.
    pub leading_silence_frames: u64,
    /// This stream's offset from the session clock, for timeline alignment.
    pub start_offset_ms: u64,
}

/// Channel a capture thread pushes live audio into.
///
/// Bounded and non-blocking at the send site: a slow consumer must never stall
/// capture. The WAV on disk remains complete regardless of what the tap drops.
pub type AudioTapSender = crossbeam_channel::Sender<CapturedAudio>;
