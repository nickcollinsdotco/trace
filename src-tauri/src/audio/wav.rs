//! Streaming WAV sink.
//!
//! Audio goes to disk as it arrives. It is never accumulated in memory.
//!
//! This is the one place TRACE deliberately diverges from Voicebox's otherwise
//! excellent capture layer, which collects every sample into an unbounded
//! `Arc<Mutex<Vec<f32>>>`. That is fine for the short, bounded dictation clips
//! Voicebox records; for a two-hour meeting at 48 kHz stereo f32 it is roughly
//! 2.7 GB of resident memory. A meeting recorder cannot work that way.
//!
//! Format is 16-bit PCM mono at the device's native rate:
//!   * 16-bit halves the file size versus f32 and is below the noise floor of
//!     any real microphone, so nothing audible is lost.
//!   * Mono because both ASR and the meters want one channel.
//!   * Native rate because resampling belongs downstream of capture, not
//!     inside a realtime path.

use std::fs::File;
use std::io::BufWriter;
use std::path::{Path, PathBuf};

use hound::{SampleFormat, WavSpec, WavWriter};

use super::AudioError;

pub struct WavSink {
    writer: Option<WavWriter<BufWriter<File>>>,
    path: PathBuf,
    frames_written: u64,
}

impl WavSink {
    pub fn create(path: impl AsRef<Path>, sample_rate: u32) -> Result<Self, AudioError> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let spec = WavSpec {
            channels: 1,
            sample_rate,
            bits_per_sample: 16,
            sample_format: SampleFormat::Int,
        };

        Ok(Self {
            writer: Some(WavWriter::create(&path, spec)?),
            path,
            frames_written: 0,
        })
    }

    /// Append mono samples in the range -1.0..=1.0.
    pub fn write(&mut self, samples: &[f32]) -> Result<(), AudioError> {
        let Some(writer) = self.writer.as_mut() else {
            return Ok(()); // already finalised; dropping late audio is correct
        };

        for &sample in samples {
            writer.write_sample(f32_to_i16(sample))?;
        }
        self.frames_written += samples.len() as u64;
        Ok(())
    }

    pub fn frames_written(&self) -> u64 {
        self.frames_written
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Flush and rewrite the RIFF header with the true length.
    ///
    /// Must be called explicitly. `Drop` cannot report an error, and a WAV
    /// whose header still claims zero samples is unreadable — exactly the
    /// failure mode that loses a meeting.
    pub fn finalize(&mut self) -> Result<(), AudioError> {
        if let Some(writer) = self.writer.take() {
            writer.finalize()?;
        }
        Ok(())
    }
}

/// Convert a float sample to 16-bit PCM.
///
/// Clamps before scaling: a value beyond ±1.0 would otherwise wrap around and
/// turn a loud passage into harsh noise rather than clean clipping. Scales by
/// 32767 so that +1.0 maps to i16::MAX without overflowing.
#[inline]
fn f32_to_i16(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_full_scale_without_overflow() {
        assert_eq!(f32_to_i16(1.0), i16::MAX);
        assert_eq!(f32_to_i16(-1.0), -i16::MAX);
        assert_eq!(f32_to_i16(0.0), 0);
    }

    #[test]
    fn clamps_rather_than_wrapping() {
        // Without the clamp these would wrap to large negative values, turning
        // a loud moment into noise instead of clipping.
        assert_eq!(f32_to_i16(2.5), i16::MAX);
        assert_eq!(f32_to_i16(-2.5), -i16::MAX);
    }

    #[test]
    fn handles_non_finite_samples() {
        // f32::clamp propagates NaN, and `NaN as i16` saturates to 0 in Rust.
        // Asserting the behaviour so a future change to the cast is noticed.
        assert_eq!(f32_to_i16(f32::NAN), 0);
        assert_eq!(f32_to_i16(f32::INFINITY), i16::MAX);
        assert_eq!(f32_to_i16(f32::NEG_INFINITY), -i16::MAX);
    }

    #[test]
    fn writes_a_readable_wav_with_correct_length() {
        let dir = std::env::temp_dir().join(format!("trace-wav-{}", std::process::id()));
        let path = dir.join("t.wav");

        let mut sink = WavSink::create(&path, 48_000).expect("create");
        sink.write(&[0.0, 0.5, -0.5]).expect("write");
        sink.write(&[1.0]).expect("write");
        assert_eq!(sink.frames_written(), 4);
        sink.finalize().expect("finalize");

        let reader = hound::WavReader::open(&path).expect("reopen");
        assert_eq!(reader.spec().channels, 1);
        assert_eq!(reader.spec().sample_rate, 48_000);
        assert_eq!(reader.len(), 4, "header must report the true sample count");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn writing_after_finalize_is_a_no_op_not_an_error() {
        // A capture thread may deliver one last buffer after stop was
        // signalled. Losing those samples is correct; panicking is not.
        let dir = std::env::temp_dir().join(format!("trace-wav-late-{}", std::process::id()));
        let path = dir.join("t.wav");

        let mut sink = WavSink::create(&path, 16_000).expect("create");
        sink.write(&[0.1]).expect("write");
        sink.finalize().expect("finalize");
        assert!(sink.write(&[0.2]).is_ok(), "late write must not error");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn creates_missing_parent_directories() {
        let dir = std::env::temp_dir().join(format!("trace-wav-deep-{}", std::process::id()));
        let path = dir.join("nested").join("deeper").join("t.wav");

        let mut sink = WavSink::create(&path, 16_000).expect("create nested");
        sink.finalize().expect("finalize");
        assert!(path.exists());

        std::fs::remove_dir_all(&dir).ok();
    }
}
