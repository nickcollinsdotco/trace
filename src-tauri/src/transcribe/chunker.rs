//! Splitting audio into transcribable chunks at silence boundaries.
//!
//! Parakeet is a batch engine with no streaming mode, so something has to
//! decide where one unit of transcription ends and the next begins. That is
//! this module.
//!
//! # Why silence alone is not enough
//!
//! M2 transcribed a 30-second system stream into a *single* segment — an
//! unbroken wall of text — because the speaker never paused. A purely
//! silence-driven splitter would do the same thing on an hour-long meeting
//! and produce one unreadable block that no evidence citation could point
//! into usefully.
//!
//! So there are two independent bounds:
//!
//! * **Silence** ends a chunk when someone stops talking. This is the
//!   preferred boundary — it falls between utterances.
//! * **Length** ends a chunk regardless. Beyond `soft_max` we take the next
//!   silence we can find; beyond `hard_max` we cut anyway, accepting a
//!   possible mid-word split rather than emitting an unbounded segment.
//!
//! # Why chunks retain leading and trailing silence
//!
//! Speech onset is gradual and VAD detects it slightly late. Trimming exactly
//! to the detected boundary reliably clips the first consonant of a chunk
//! ("s" from "so", "t" from "the"). A short pad on each side costs nothing and
//! avoids that.

use transcribe_rs::vad::{EnergyVad, Vad};

use crate::audio::resample::TARGET_SAMPLE_RATE;

/// One unit of audio to transcribe.
#[derive(Debug, Clone, PartialEq)]
pub struct Chunk {
    /// Offset of this chunk's first sample within the source stream. Used to
    /// place the resulting segment timestamps back on the session timeline.
    pub start_sample: usize,
    pub samples: Vec<f32>,
}

impl Chunk {
    pub fn start_ms(&self, sample_rate: u32) -> u64 {
        if sample_rate == 0 {
            return 0;
        }
        (self.start_sample as u64 * 1000) / u64::from(sample_rate)
    }

    pub fn duration_ms(&self, sample_rate: u32) -> u64 {
        if sample_rate == 0 {
            return 0;
        }
        (self.samples.len() as u64 * 1000) / u64::from(sample_rate)
    }
}

#[derive(Debug, Clone, Copy)]
pub struct ChunkConfig {
    pub sample_rate: u32,
    /// Samples per VAD frame. 480 = 30 ms at 16 kHz.
    pub frame_size: usize,
    /// RMS above which a frame counts as speech.
    pub energy_threshold: f32,
    /// Consecutive silent frames that close a chunk. ~500 ms is long enough to
    /// sit between sentences without cutting mid-phrase at a natural breath.
    pub silence_frames: usize,
    /// Below this, a chunk is not worth emitting on its own.
    pub min_samples: usize,
    /// Past this, take the next silence available.
    pub soft_max_samples: usize,
    /// Past this, cut regardless.
    pub hard_max_samples: usize,
    /// Silence retained either side of speech, so onsets are not clipped.
    pub pad_samples: usize,
}

impl Default for ChunkConfig {
    fn default() -> Self {
        let rate = TARGET_SAMPLE_RATE as usize;
        Self {
            sample_rate: TARGET_SAMPLE_RATE,
            frame_size: 480, // 30 ms
            // Chosen against the M1 recordings, where speech sat around
            // 0.03-0.06 RMS and silence well below 0.005.
            energy_threshold: 0.012,
            silence_frames: 17, // ~510 ms
            min_samples: rate / 2,
            soft_max_samples: rate * 20,
            hard_max_samples: rate * 30,
            pad_samples: rate / 5, // 200 ms
        }
    }
}

/// Split `samples` into chunks at silence boundaries.
///
/// Returns chunks in order. Audio containing no speech at all yields none —
/// transcribing pure silence wastes time and invites hallucinated output.
pub fn chunk_by_silence(samples: &[f32], config: &ChunkConfig) -> Vec<Chunk> {
    if samples.is_empty() || config.frame_size == 0 {
        return Vec::new();
    }

    let mut vad = EnergyVad::new(config.frame_size, config.energy_threshold);
    let flags = classify_frames(samples, config.frame_size, &mut vad);
    if flags.iter().all(|speech| !speech) {
        return Vec::new();
    }

    let mut chunks = Vec::new();
    let mut chunk_start = 0usize; // sample index
    let mut silence_run = 0usize; // consecutive silent frames
    let mut saw_speech = false;

    // Bounds of actual speech within the current chunk. Chunks are trimmed to
    // these rather than to the split points, so a long pause is not carried
    // into the following chunk as dead audio the engine still has to process.
    let mut speech_start = 0usize;
    let mut speech_end = 0usize;

    for (i, &is_speech) in flags.iter().enumerate() {
        let frame_start = i * config.frame_size;
        let frame_end = ((i + 1) * config.frame_size).min(samples.len());
        let len = frame_end - chunk_start;

        if is_speech {
            if !saw_speech {
                speech_start = frame_start;
            }
            speech_end = frame_end;
            saw_speech = true;
            silence_run = 0;
        } else {
            silence_run += 1;
        }

        // A silence gap closes the chunk, but only once it holds real speech
        // and enough of it to be worth transcribing.
        let ends_on_silence =
            saw_speech && silence_run >= config.silence_frames && len >= config.min_samples;

        // Past the soft ceiling, any silence at all is a good enough boundary.
        let ends_on_soft_max = saw_speech && len >= config.soft_max_samples && !is_speech;

        // Past the hard ceiling, cut regardless of what is being said.
        let ends_on_hard_max = len >= config.hard_max_samples;

        if ends_on_silence || ends_on_soft_max || ends_on_hard_max {
            // A hard cut can land mid-speech, in which case the speech runs to
            // the cut point rather than to the last silent frame.
            let end = if ends_on_hard_max && is_speech {
                frame_end
            } else {
                speech_end
            };
            push_chunk(&mut chunks, samples, speech_start, end, config);
            chunk_start = frame_end;
            silence_run = 0;
            saw_speech = false;
        }
    }

    // Whatever remains at the end, provided it contains speech.
    if saw_speech {
        push_chunk(&mut chunks, samples, speech_start, speech_end, config);
    }

    chunks
}

/// Classify every frame, treating a short trailing remainder as silence.
fn classify_frames(samples: &[f32], frame_size: usize, vad: &mut EnergyVad) -> Vec<bool> {
    samples
        .chunks(frame_size)
        .map(|frame| {
            if frame.len() != frame_size {
                // EnergyVad rejects short frames. A partial frame at the very
                // end is not enough to call speech either way.
                return false;
            }
            vad.is_speech(frame).unwrap_or(false)
        })
        .collect()
}

/// Emit a chunk covering `start..end`, padded outward and clamped.
fn push_chunk(
    chunks: &mut Vec<Chunk>,
    samples: &[f32],
    start: usize,
    end: usize,
    config: &ChunkConfig,
) {
    let padded_start = start.saturating_sub(config.pad_samples);
    let padded_end = (end + config.pad_samples).min(samples.len());

    if padded_end <= padded_start {
        return;
    }

    chunks.push(Chunk {
        start_sample: padded_start,
        samples: samples[padded_start..padded_end].to_vec(),
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: usize = TARGET_SAMPLE_RATE as usize;

    fn speech(secs: f32) -> Vec<f32> {
        // 200 Hz tone at an amplitude comfortably above the threshold.
        let n = (RATE as f32 * secs) as usize;
        (0..n)
            .map(|i| 0.3 * (2.0 * std::f32::consts::PI * 200.0 * i as f32 / RATE as f32).sin())
            .collect()
    }

    fn silence(secs: f32) -> Vec<f32> {
        vec![0.0; (RATE as f32 * secs) as usize]
    }

    #[test]
    fn pure_silence_produces_no_chunks() {
        // Transcribing silence wastes time and invites hallucination.
        assert!(chunk_by_silence(&silence(5.0), &ChunkConfig::default()).is_empty());
    }

    #[test]
    fn empty_input_produces_no_chunks() {
        assert!(chunk_by_silence(&[], &ChunkConfig::default()).is_empty());
    }

    #[test]
    fn continuous_speech_splits_at_the_length_ceiling() {
        // THE M2 REGRESSION. A 90s unbroken monologue previously became one
        // segment. It must now be bounded even with no silence to split on.
        let audio = speech(90.0);
        let chunks = chunk_by_silence(&audio, &ChunkConfig::default());

        assert!(
            chunks.len() >= 3,
            "expected several chunks, got {}",
            chunks.len()
        );
        for c in &chunks {
            let secs = c.samples.len() as f32 / RATE as f32;
            assert!(
                secs <= 31.0,
                "no chunk may exceed the hard ceiling; got {secs:.1}s"
            );
        }
    }

    #[test]
    fn a_pause_splits_two_utterances() {
        let mut audio = speech(2.0);
        audio.extend(silence(1.5));
        audio.extend(speech(2.0));

        let chunks = chunk_by_silence(&audio, &ChunkConfig::default());
        assert_eq!(chunks.len(), 2, "a 1.5s pause should separate utterances");
    }

    #[test]
    fn a_brief_pause_does_not_split_mid_sentence() {
        // 200 ms is a breath, not a sentence boundary.
        let mut audio = speech(2.0);
        audio.extend(silence(0.2));
        audio.extend(speech(2.0));

        let chunks = chunk_by_silence(&audio, &ChunkConfig::default());
        assert_eq!(chunks.len(), 1, "a breath must not split an utterance");
    }

    #[test]
    fn chunks_are_ordered_and_carry_their_offset() {
        let mut audio = speech(1.5);
        audio.extend(silence(1.5));
        audio.extend(speech(1.5));

        let chunks = chunk_by_silence(&audio, &ChunkConfig::default());
        assert!(chunks.len() >= 2);

        // Offsets must increase, or segment timestamps would go backwards.
        for pair in chunks.windows(2) {
            assert!(
                pair[1].start_sample > pair[0].start_sample,
                "chunk offsets must be strictly increasing"
            );
        }

        // The second chunk starts after the pause, not at zero.
        assert!(chunks[1].start_ms(TARGET_SAMPLE_RATE) > 2000);
    }

    #[test]
    fn padding_does_not_run_past_the_buffer() {
        // Speech right at both edges: padding must clamp, not panic.
        let audio = speech(1.0);
        let chunks = chunk_by_silence(&audio, &ChunkConfig::default());

        for c in &chunks {
            assert!(c.start_sample + c.samples.len() <= audio.len());
        }
    }

    #[test]
    fn leading_silence_is_not_emitted_as_its_own_chunk() {
        let mut audio = silence(3.0);
        audio.extend(speech(2.0));

        let chunks = chunk_by_silence(&audio, &ChunkConfig::default());
        assert_eq!(chunks.len(), 1, "silence before speech is not a chunk");
    }

    #[test]
    fn a_very_short_utterance_is_still_captured() {
        // "Yes." must not be swallowed by the minimum-length rule.
        let mut audio = silence(1.0);
        audio.extend(speech(0.4));
        audio.extend(silence(1.0));

        let chunks = chunk_by_silence(&audio, &ChunkConfig::default());
        assert_eq!(chunks.len(), 1, "a short reply must still be transcribed");
    }

    #[test]
    fn timing_helpers_handle_a_zero_sample_rate() {
        let c = Chunk {
            start_sample: 16_000,
            samples: vec![0.0; 8_000],
        };
        assert_eq!(c.start_ms(TARGET_SAMPLE_RATE), 1000);
        assert_eq!(c.duration_ms(TARGET_SAMPLE_RATE), 500);
        assert_eq!(c.start_ms(0), 0);
        assert_eq!(c.duration_ms(0), 0);
    }
}
