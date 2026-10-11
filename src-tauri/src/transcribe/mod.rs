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
pub mod live;
pub mod streaming;

use std::path::Path;

use transcribe_rs::onnx::parakeet::{ParakeetModel, ParakeetParams, TimestampGranularity};
use transcribe_rs::onnx::Quantization;

use self::chunker::ChunkConfig;
use self::streaming::StreamingChunker;
use crate::audio::resample::TARGET_SAMPLE_RATE;
use crate::audio::StreamSource;
use crate::models::{require_installed, ModelError, ModelSpec};

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
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
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
    /// Load the speech model the user has chosen.
    pub fn load() -> Result<Self, TranscribeError> {
        Self::load_model(crate::models::active_speech_model())
    }

    /// Load a specific speech model. Every one TRACE offers is a Parakeet
    /// export, so one engine serves them all.
    pub fn load_model(spec: &ModelSpec) -> Result<Self, TranscribeError> {
        let dir = require_installed(spec)?;
        let model = ParakeetModel::load(&dir, &Quantization::Int8)
            .map_err(|e| TranscribeError::Engine(e.to_string()))?;
        Ok(Self { model })
    }

    /// Transcribe one stream's WAV file.
    ///
    /// `start_offset_ms` comes from the capture session and shifts this
    /// stream's timestamps onto the shared session timeline.
    ///
    /// Chunked before transcribing. Feeding a whole stream in one call makes
    /// the engine emit a single unbounded segment whenever the speaker does
    /// not pause — measured in M2, where 30s of continuous speech produced
    /// exactly one segment. Chunking also skips silence entirely, so a quiet
    /// meeting costs proportionally less to transcribe.
    pub fn transcribe_stream(
        &mut self,
        wav_path: &Path,
        source: StreamSource,
        start_offset_ms: u64,
    ) -> Result<Vec<Segment>, TranscribeError> {
        let prefix = match source {
            StreamSource::Microphone => "mic",
            StreamSource::System => "sys",
        };

        let mut out = Vec::new();
        stream_chunks(wav_path, |chunk| {
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
            Ok(())
        })?;

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

/// Cut a recording into the chunks the engine is given, without holding it.
///
/// The recording used to be read whole, downmixed into a second copy and
/// resampled into a third — about 1.5 GB at the peak for an hour of one
/// stream, growing with the meeting and arriving just as the summary model
/// loads. Two streaming passes replace that. The first reads only the frame
/// energies, to find this recording's noise floor; the second resamples and
/// chunks as it reads, holding one chunk at a time. Reading the file twice
/// costs a few seconds an hour, against minutes of inference.
///
/// The chunks are exactly those `chunk_by_silence` cuts from the whole
/// recording — same threshold, same boundaries, same padding — which is held
/// by test, so streaming changes what the pass costs and nothing it hears.
pub fn stream_chunks(
    wav_path: &Path,
    mut on_chunk: impl FnMut(chunker::Chunk) -> Result<(), TranscribeError>,
) -> Result<(), TranscribeError> {
    let config = ChunkConfig::default();

    let mut energies = chunker::FrameEnergies::new(config.frame_size);
    let mut wav = Wav16k::open(wav_path)?;
    while let Some(block) = wav.next_block()? {
        energies.push(&block);
    }

    let mut chunker = StreamingChunker::new(ChunkConfig {
        energy_threshold: Some(energies.threshold()),
        ..config
    });
    let mut wav = Wav16k::open(wav_path)?;
    while let Some(block) = wav.next_block()? {
        for chunk in chunker.push(&block) {
            on_chunk(chunk)?;
        }
    }
    for chunk in chunker.flush() {
        on_chunk(chunk)?;
    }
    Ok(())
}

/// Frames read from the WAV per block: a second of audio at 48 kHz.
const BLOCK_FRAMES: usize = 48_000;

/// A WAV read as mono 16 kHz, a block at a time.
///
/// Accepts both integer and float WAVs. TRACE writes 16-bit PCM, but a file
/// could arrive from elsewhere and failing on format would be gratuitous.
struct Wav16k {
    reader: hound::WavReader<std::io::BufReader<std::fs::File>>,
    spec: hound::WavSpec,
    resampler: Option<crate::audio::resample::To16k>,
}

impl Wav16k {
    fn open(path: &Path) -> Result<Self, TranscribeError> {
        let reader = hound::WavReader::open(path).map_err(|e| TranscribeError::ReadWav {
            path: path.display().to_string(),
            source: e,
        })?;
        let spec = reader.spec();
        let resampler = Some(crate::audio::resample::To16k::new(spec.sample_rate)?);
        Ok(Self {
            reader,
            spec,
            resampler,
        })
    }

    /// The next block of 16 kHz samples, or `None` once the file is done.
    fn next_block(&mut self) -> Result<Option<Vec<f32>>, TranscribeError> {
        let Some(resampler) = self.resampler.as_mut() else {
            return Ok(None);
        };
        let want = BLOCK_FRAMES * usize::from(self.spec.channels.max(1));
        let mut interleaved = Vec::with_capacity(want);
        // Counted separately from what was read, so a block of unreadable
        // samples is skipped, as it always was, rather than taken for the end.
        let mut taken = 0;
        match self.spec.sample_format {
            hound::SampleFormat::Int => {
                // Normalised by the actual bit depth, not a hard-coded i16 range.
                let scale = (1i64 << (self.spec.bits_per_sample - 1)) as f32;
                for s in self.reader.samples::<i32>().take(want) {
                    taken += 1;
                    interleaved.extend(s.ok().map(|s| s as f32 / scale));
                }
            }
            hound::SampleFormat::Float => {
                for s in self.reader.samples::<f32>().take(want) {
                    taken += 1;
                    interleaved.extend(s.ok());
                }
            }
        }

        let mut out = Vec::new();
        if taken == 0 {
            if let Some(resampler) = self.resampler.take() {
                resampler.finish(&mut out)?;
            }
            return Ok((!out.is_empty()).then_some(out));
        }
        let mono = crate::audio::downmix_to_mono(&interleaved, self.spec.channels);
        resampler.push(&mono, &mut out)?;
        Ok(Some(out))
    }
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

    /// A 48 kHz 16-bit WAV of tone and silence, as `(seconds, loud)` spans.
    fn write_wav(path: &Path, spans: &[(f32, bool)]) {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 48_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut w = hound::WavWriter::create(path, spec).unwrap();
        let mut i = 0u64;
        for &(secs, loud) in spans {
            for _ in 0..(secs * 48_000.0) as u64 {
                let t = i as f32 / 48_000.0;
                // A little hiss under everything, so the noise floor is real.
                let hiss = ((i * 2_654_435_761) % 1000) as f32 / 1000.0 - 0.5;
                let tone = if loud {
                    0.2 * (2.0 * std::f32::consts::PI * 220.0 * t).sin()
                } else {
                    0.0
                };
                w.write_sample(((tone + 0.002 * hiss) * 32767.0) as i16)
                    .unwrap();
                i += 1;
            }
        }
        w.finalize().unwrap();
    }

    #[test]
    fn streaming_the_recording_cuts_exactly_what_reading_it_whole_did() {
        let dir = std::env::temp_dir().join(format!("trace-stream-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("mic.wav");
        write_wav(
            &path,
            &[
                (0.7, false),
                (34.0, true), // past the hard ceiling
                (1.5, false),
                (3.0, true),
                (2.0, false),
                (22.0, true),  // past the soft ceiling…
                (0.06, false), // …where a breath will do
                (2.0, true),
                (0.4, false),
            ],
        );

        // The pass as it was: everything in memory at once.
        let whole = {
            let mut r = hound::WavReader::open(&path).unwrap();
            let samples: Vec<f32> = r
                .samples::<i32>()
                .filter_map(Result::ok)
                .map(|s| s as f32 / 32768.0)
                .collect();
            let samples = crate::audio::resample::to_16k(&samples, 48_000).unwrap();
            chunker::chunk_by_silence(&samples, &ChunkConfig::default())
        };

        let mut streamed = Vec::new();
        stream_chunks(&path, |c| {
            streamed.push(c);
            Ok(())
        })
        .unwrap();

        assert!(whole.len() >= 5, "every kind of cut is exercised");
        assert_eq!(streamed, whole);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_empty_recording_has_no_chunks() {
        let dir = std::env::temp_dir().join(format!("trace-stream-empty-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("mic.wav");
        write_wav(&path, &[]);
        let mut n = 0;
        stream_chunks(&path, |_| {
            n += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!(n, 0);
        std::fs::remove_dir_all(&dir).ok();
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
