//! Offline transcription of a captured session.
//!
//! Each stream is transcribed independently and its segments tagged with the
//! stream they came from. That is what gives TRACE speaker attribution without
//! a diarisation model: microphone segments are the local user, system-audio
//! segments are everyone else.
//!
//! Segment times are placed on the **session** timeline, not the file's. Each
//! stream starts at a different moment (measured 22-189 ms apart, with the
//! order varying between runs), so every timestamp is shifted by that stream's
//! `start_offset_ms`.

pub mod chunker;

use std::path::Path;

use transcribe_rs::onnx::parakeet::{ParakeetModel, ParakeetParams, TimestampGranularity};
use transcribe_rs::onnx::Quantization;

use self::chunker::{chunk_by_silence, ChunkConfig};
use crate::audio::resample::{to_16k, TARGET_SAMPLE_RATE};
use crate::audio::StreamSource;
use crate::models::{require_installed, ModelError, PARAKEET_V3_INT8};

#[derive(Debug, thiserror::Error)]
pub enum TranscribeError {
    #[error(transparent)]
    Model(#[from] ModelError),
    #[error(transparent)]
    Audio(#[from] crate::audio::AudioError),
    #[error("engine failed: {0}")]
    Engine(String),
    #[error("could not read {path}: {source}")]
    ReadWav {
        path: String,
        #[source]
        source: hound::Error,
    },
}

/// One transcribed span, positioned on the session timeline.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Segment {
    /// Stable, citable identifier — synthesis references these (`seg_0412`).
    pub id: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    /// Which physical stream produced this. Carries the speaker attribution.
    pub source: StreamSource,
}

impl Segment {
    /// Who said it, derived from the audio topology rather than a model.
    pub fn speaker_label(&self) -> &'static str {
        match self.source {
            StreamSource::Microphone => "you",
            StreamSource::System => "them",
        }
    }
}

/// A loaded ASR engine.
///
/// Loading pulls three ONNX graphs into memory, so hold one and reuse it
/// across streams rather than loading per file.
pub struct Transcriber {
    model: ParakeetModel,
}

impl Transcriber {
    /// Load the default engine from the installed model directory.
    pub fn load() -> Result<Self, TranscribeError> {
        let dir = require_installed(&PARAKEET_V3_INT8)?;
        let model = ParakeetModel::load(&dir, &Quantization::Int8)
            .map_err(|e| TranscribeError::Engine(e.to_string()))?;
        Ok(Self { model })
    }

    /// Transcribe one stream's WAV file.
    ///
    /// `start_offset_ms` comes from the capture session and shifts this
    /// stream's timestamps onto the shared session timeline.
    pub fn transcribe_stream(
        &mut self,
        wav_path: &Path,
        source: StreamSource,
        start_offset_ms: u64,
    ) -> Result<Vec<Segment>, TranscribeError> {
        let (samples, rate) = read_mono_wav(wav_path)?;
        if samples.is_empty() {
            return Ok(Vec::new());
        }

        let samples = to_16k(&samples, rate)?;

        // Chunk before transcribing. Feeding a whole stream in one call makes
        // the engine emit a single unbounded segment whenever the speaker does
        // not pause — measured in M2, where 30s of continuous speech produced
        // exactly one segment. Chunking also skips silence entirely, so a
        // quiet meeting costs proportionally less to transcribe.
        let chunks = chunk_by_silence(&samples, &ChunkConfig::default());
        let prefix = match source {
            StreamSource::Microphone => "mic",
            StreamSource::System => "sys",
        };

        let mut out = Vec::new();
        for chunk in &chunks {
            let chunk_offset_ms = start_offset_ms + chunk.start_ms(TARGET_SAMPLE_RATE);
            for seg in self.transcribe_chunk(&chunk.samples)? {
                // Skip empty results rather than emitting blank segments.
                let text = seg.text.trim();
                if text.is_empty() {
                    continue;
                }
                out.push(Segment {
                    // Numbered across the whole stream, so ids stay unique and
                    // stable regardless of how the audio was chunked.
                    id: format!("{prefix}_{:04}", out.len()),
                    start_ms: chunk_offset_ms + secs_to_ms(seg.start),
                    end_ms: chunk_offset_ms + secs_to_ms(seg.end),
                    text: text.to_string(),
                    source,
                });
            }
        }

        Ok(out)
    }

    /// Transcribe one chunk, returning engine-relative segments.
    ///
    /// A chunk that yields flat text with no segment timings still becomes one
    /// segment spanning the chunk — dropping the words would be worse than an
    /// imprecise timestamp, and the chunk is already bounded in length.
    fn transcribe_chunk(
        &mut self,
        samples: &[f32],
    ) -> Result<Vec<transcribe_rs::TranscriptionSegment>, TranscribeError> {
        // Segment granularity, not the default Token. Token granularity emits
        // one segment per sub-word piece — "et", "'", "s", "k" — which is
        // useless as a transcript and would make evidence citations
        // meaningless. `transcribe_with` also applies Parakeet's own leading
        // silence padding, which its mel preprocessor needs.
        let params = ParakeetParams {
            timestamp_granularity: Some(TimestampGranularity::Segment),
            ..Default::default()
        };
        let result = self
            .model
            .transcribe_with(samples, &params)
            .map_err(|e| TranscribeError::Engine(e.to_string()))?;

        if let Some(segments) = result.segments {
            if !segments.is_empty() {
                return Ok(segments);
            }
        }

        if result.text.trim().is_empty() {
            return Ok(Vec::new());
        }

        Ok(vec![transcribe_rs::TranscriptionSegment {
            start: 0.0,
            end: samples.len() as f32 / TARGET_SAMPLE_RATE as f32,
            text: result.text,
        }])
    }
}

/// Merge per-stream segments into one chronological transcript.
pub fn merge(mut segments: Vec<Segment>) -> Vec<Segment> {
    // Stable sort, so segments that genuinely overlap in time keep a
    // deterministic order rather than shuffling between runs.
    segments.sort_by_key(|s| s.start_ms);
    segments
}

/// Read a mono WAV as f32, returning its sample rate.
///
/// Accepts both integer and float WAVs. TRACE writes 16-bit PCM, but a file
/// could arrive from elsewhere and failing on format would be gratuitous.
fn read_mono_wav(path: &Path) -> Result<(Vec<f32>, u32), TranscribeError> {
    let mut reader = hound::WavReader::open(path).map_err(|e| TranscribeError::ReadWav {
        path: path.display().to_string(),
        source: e,
    })?;
    let spec = reader.spec();

    let interleaved: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Int => reader
            .samples::<i32>()
            .filter_map(Result::ok)
            // Normalise by the actual bit depth, not a hard-coded i16 range.
            .map(|s| s as f32 / (1i64 << (spec.bits_per_sample - 1)) as f32)
            .collect(),
        hound::SampleFormat::Float => reader.samples::<f32>().filter_map(Result::ok).collect(),
    };

    let mono = crate::audio::downmix_to_mono(&interleaved, spec.channels);
    Ok((mono, spec.sample_rate))
}

fn secs_to_ms(secs: f32) -> u64 {
    (secs.max(0.0) * 1000.0).round() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(id: &str, start: u64, source: StreamSource) -> Segment {
        Segment {
            id: id.into(),
            start_ms: start,
            end_ms: start + 500,
            text: "x".into(),
            source,
        }
    }

    #[test]
    fn speaker_label_comes_from_the_stream() {
        assert_eq!(seg("a", 0, StreamSource::Microphone).speaker_label(), "you");
        assert_eq!(seg("b", 0, StreamSource::System).speaker_label(), "them");
    }

    #[test]
    fn merge_interleaves_streams_chronologically() {
        let merged = merge(vec![
            seg("m0", 3000, StreamSource::Microphone),
            seg("s0", 1000, StreamSource::System),
            seg("m1", 2000, StreamSource::Microphone),
        ]);
        let order: Vec<&str> = merged.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(order, vec!["s0", "m1", "m0"]);
    }

    #[test]
    fn merge_is_stable_for_simultaneous_segments() {
        // People talk over each other. Equal timestamps must not reorder
        // between runs, or the transcript would be non-deterministic.
        let merged = merge(vec![
            seg("first", 1000, StreamSource::Microphone),
            seg("second", 1000, StreamSource::System),
        ]);
        let order: Vec<&str> = merged.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(order, vec!["first", "second"]);
    }

    #[test]
    fn merge_of_nothing_is_nothing() {
        assert!(merge(Vec::new()).is_empty());
    }

    #[test]
    fn seconds_convert_to_milliseconds_and_clamp_at_zero() {
        assert_eq!(secs_to_ms(1.5), 1500);
        assert_eq!(secs_to_ms(0.0), 0);
        // Padding compensation can push a timestamp slightly negative.
        assert_eq!(secs_to_ms(-0.25), 0);
    }
}
