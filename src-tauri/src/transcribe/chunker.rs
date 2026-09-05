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
    ///
    /// `None` derives it from the recording's own noise floor, which is the
    /// default and what should normally be used. `Some` pins it, for tests
    /// and for the diagnostic in `examples/chunk_check.rs`.
    pub energy_threshold: Option<f32>,
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

impl ChunkConfig {
    /// Policy for the live transcript, which optimises for latency.
    ///
    /// Nothing in a chunk can be shown until the whole chunk closes, so the
    /// length ceiling *is* the worst-case lag. Measured with the offline
    /// defaults: a 13.4 s chunk took 648 ms to transcribe but its first
    /// segment was already ~12 s stale by the time it appeared. Inference was
    /// never the bottleneck — it runs at roughly 20x realtime — the ceiling
    /// was.
    ///
    /// Shorter chunks cost the model some surrounding context, which is a real
    /// but acceptable accuracy trade for a *provisional* transcript. The final
    /// pass re-runs with the offline defaults and supersedes it.
    pub fn live(sample_rate: u32) -> Self {
        let base = Self::for_rate(sample_rate);
        let scale = |seconds: usize| seconds * sample_rate.max(1) as usize;
        Self {
            soft_max_samples: scale(4),
            hard_max_samples: scale(7),
            ..base
        }
    }

    /// The default policy expressed at an arbitrary sample rate.
    ///
    /// Live chunking runs on the capture stream at its native rate, so that
    /// only bounded chunks — never the whole stream — need resampling. Doing
    /// it the other way round would require a resampler that holds state
    /// across callbacks, and any discontinuity at a block boundary would land
    /// directly in the audio the model sees.
    pub fn for_rate(sample_rate: u32) -> Self {
        let d = Self::default();
        if sample_rate == 0 || sample_rate == TARGET_SAMPLE_RATE {
            return d;
        }

        let scale = |n: usize| n * sample_rate as usize / TARGET_SAMPLE_RATE as usize;
        Self {
            sample_rate,
            // Frame size scales so a frame is still 30 ms of audio.
            frame_size: scale(d.frame_size).max(1),
            min_samples: scale(d.min_samples),
            soft_max_samples: scale(d.soft_max_samples),
            hard_max_samples: scale(d.hard_max_samples),
            pad_samples: scale(d.pad_samples),
            // Thresholds are rate-independent: silence_frames counts frames,
            // and RMS does not change with sample rate.
            ..d
        }
    }
}

impl Default for ChunkConfig {
    fn default() -> Self {
        let rate = TARGET_SAMPLE_RATE as usize;
        Self {
            sample_rate: TARGET_SAMPLE_RATE,
            frame_size: 480, // 30 ms
            // Derived per recording. A fixed value cannot work: 0.012 was
            // chosen against the M1 recordings and silently swallowed half of
            // the speech on a quieter microphone.
            energy_threshold: None,
            // ~810 ms. 510 ms split mid-sentence at an ordinary breath, and
            // Parakeet ends a fragment that stops mid-clause with a word
            // nobody said.
            silence_frames: 27,
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

    let threshold = match config.energy_threshold {
        Some(fixed) => fixed,
        None => adaptive_threshold(samples, config.frame_size),
    };
    let mut vad = EnergyVad::new(config.frame_size, threshold);
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

/// The threshold used before a recording's noise floor can be measured.
///
/// Deliberately at the sensitive end: hearing silence as speech wastes a
/// little inference, whereas hearing speech as silence loses it permanently.
pub const SENSITIVE_THRESHOLD: f32 = 0.0025;

/// Derive the speech threshold from the recording's own noise floor.
///
/// A fixed absolute threshold cannot work across microphones, and the failure
/// is silent and severe. 0.012 was chosen against the M1 recordings, where
/// speech sat at 0.03-0.06 RMS. On a quieter microphone, measured
/// 2026-09-06, speech sat at 0.005-0.029 and *half of it fell below the
/// threshold* — classified as silence, never transcribed, and simply absent
/// from the note. The recording opened with five seconds of speech that never
/// reached the model at all.
///
/// The signal that makes this tractable: within one recording, silence and
/// speech separate cleanly. So read both — a low percentile for the noise
/// floor, a high one for the speech level — and put the threshold a short way
/// up from the floor towards the speech.
///
/// Both clamps matter. A recording that is *all* speech has no floor to find,
/// and the percentile would land on speech itself — the upper clamp stops
/// that from muting everything. A digital-silence stream would drive the
/// threshold to zero and call its own dither speech; the lower clamp stops
/// that.
pub fn adaptive_threshold(samples: &[f32], frame_size: usize) -> f32 {
    /// How far from the noise floor towards the speech level to sit.
    ///
    /// Low, because the two errors are not equal: a threshold slightly too
    /// sensitive puts some room tone inside a chunk, costing a little
    /// inference on audio that says nothing. A threshold slightly too deaf
    /// deletes words, and nothing anywhere reports that it happened.
    const TOWARDS_SPEECH: f32 = 0.25;
    /// Never quieter than this, or a silent stream's dither reads as speech.
    const MIN: f32 = 0.0015;
    /// Never louder than this — the point at which a threshold starts
    /// discarding ordinary speech. It is the old fixed value.
    const MAX: f32 = 0.012;

    let mut energies: Vec<f32> = samples
        .chunks(frame_size)
        .filter(|f| f.len() == frame_size)
        .map(|f| (f.iter().map(|s| s * s).sum::<f32>() / f.len() as f32).sqrt())
        .collect();

    if energies.is_empty() {
        return MAX;
    }

    energies.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let at = |q: f32| energies[((energies.len() - 1) as f32 * q) as usize];

    // Two points on the distribution rather than one. An earlier version took
    // a fixed multiple of the floor alone, which assumes the gap between
    // silence and speech is always the same size — it is not, and when the
    // gap is narrow that version put the threshold *above* the speech and
    // deleted it. Reading both ends adapts to the recording instead of to an
    // assumption about it.
    let floor = at(0.10);
    let speech = at(0.75);

    (floor + (speech - floor).max(0.0) * TOWARDS_SPEECH).clamp(MIN, MAX)
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
    /// Speech at the level a quiet microphone actually produces.
    ///
    /// Measured from a real recording on 2026-09-06: speech 0.005-0.029 RMS,
    /// room tone 0.0008-0.0024. The old fixed threshold of 0.012 sat above
    /// half of that speech.
    fn quiet_speech(samples: usize, rms: f32) -> Vec<f32> {
        (0..samples)
            .map(|i| {
                // A tone rather than noise, so the RMS is exactly known.
                let t = i as f32 / TARGET_SAMPLE_RATE as f32;
                (t * 220.0 * std::f32::consts::TAU).sin() * rms * std::f32::consts::SQRT_2
            })
            .collect()
    }

    fn room_tone(samples: usize) -> Vec<f32> {
        quiet_speech(samples, 0.0015)
    }

    #[test]
    fn quiet_speech_is_not_mistaken_for_silence() {
        // The bug this exists to prevent: a quiet speaker's opening seconds
        // were classified as silence, never transcribed, and simply absent
        // from the note. Nothing warned; the words were just gone.
        let rate = TARGET_SAMPLE_RATE as usize;
        let mut audio = room_tone(rate);
        audio.extend(quiet_speech(rate * 3, 0.006));
        audio.extend(room_tone(rate));

        let chunks = chunk_by_silence(&audio, &ChunkConfig::default());

        assert!(!chunks.is_empty(), "quiet speech produced no chunks at all");
        let covered: usize = chunks.iter().map(|c| c.samples.len()).sum();
        assert!(
            covered >= rate * 2,
            "only {:.2}s of 3s of quiet speech survived",
            covered as f32 / rate as f32
        );
    }

    #[test]
    fn the_threshold_follows_the_noise_floor() {
        let rate = TARGET_SAMPLE_RATE as usize;
        let frame = ChunkConfig::default().frame_size;

        let quiet = {
            let mut a = quiet_speech(rate, 0.0008);
            a.extend(quiet_speech(rate, 0.006));
            adaptive_threshold(&a, frame)
        };
        let loud = {
            let mut a = quiet_speech(rate, 0.004);
            a.extend(quiet_speech(rate, 0.05));
            adaptive_threshold(&a, frame)
        };

        assert!(
            quiet < loud,
            "a noisier recording must demand more energy to count as speech ({quiet} vs {loud})"
        );
    }

    #[test]
    fn the_threshold_stays_within_its_clamps() {
        let frame = ChunkConfig::default().frame_size;
        let rate = TARGET_SAMPLE_RATE as usize;

        // Digital silence: without the lower clamp the threshold goes to zero
        // and the stream's own dither reads as speech.
        let silent = adaptive_threshold(&vec![0.0; rate], frame);
        assert!(silent >= 0.0015, "threshold collapsed to {silent}");

        // Wall-to-wall speech: there is no floor to find, and without the
        // upper clamp the percentile lands on speech and mutes everything.
        let loud = adaptive_threshold(&quiet_speech(rate, 0.2), frame);
        assert!(loud <= 0.012, "threshold ran away to {loud}");
    }

    #[test]
    fn an_ordinary_breath_does_not_split_a_sentence() {
        // 600ms: longer than a fast breath, shorter than a sentence gap. The
        // old 510ms ceiling split here, and Parakeet ended the fragment with
        // a word nobody said.
        let rate = TARGET_SAMPLE_RATE as usize;
        let mut audio = quiet_speech(rate * 2, 0.02);
        audio.extend(room_tone(rate * 6 / 10));
        audio.extend(quiet_speech(rate * 2, 0.02));

        let chunks = chunk_by_silence(&audio, &ChunkConfig::default());
        assert_eq!(chunks.len(), 1, "a 600ms breath split the sentence");
    }

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
