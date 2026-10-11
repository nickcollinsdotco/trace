//! Sample-rate conversion to the 16 kHz the ASR models require.
//!
//! Capture runs at whatever rate the device dictates — measured on this
//! machine, every input endpoint is locked to 48000 Hz in WASAPI shared mode,
//! and `cpal` offers no other rate. Conversion therefore happens here, in the
//! offline path, rather than inside a realtime callback.
//!
//! Uses `rubato`'s FFT resampler rather than a hand-rolled decimator. Naive
//! decimation without an anti-aliasing filter folds everything above 8 kHz
//! back into the speech band as inharmonic noise; it sounds "fine" to a casual
//! listen and quietly degrades word error rate, which is the worst kind of
//! bug — invisible until the transcripts are subtly wrong.

use audioadapter_buffers::direct::InterleavedSlice;
use rubato::{Fft, FixedSync, Resampler};

use super::AudioError;

/// Sample rate every supported ASR model expects.
pub const TARGET_SAMPLE_RATE: u32 = 16_000;

/// Frames fed per FFT block. Large enough to amortise the transform, small
/// enough to keep peak memory modest on a long meeting.
const CHUNK_SIZE: usize = 4096;
const SUB_CHUNKS: usize = 2;

/// Resample mono `input` from `from_rate` to 16 kHz.
///
/// Returns the input untouched when it is already at the target rate, so the
/// common "already 16 kHz" path costs nothing.
pub fn to_16k(input: &[f32], from_rate: u32) -> Result<Vec<f32>, AudioError> {
    if from_rate == TARGET_SAMPLE_RATE {
        return Ok(input.to_vec());
    }
    let mut resampler = To16k::new(from_rate)?;
    if input.is_empty() {
        return Ok(Vec::new());
    }
    let expected = input.len() * TARGET_SAMPLE_RATE as usize / from_rate as usize;
    let mut output = Vec::with_capacity(expected + CHUNK_SIZE);
    resampler.push(input, &mut output)?;
    resampler.finish(&mut output)?;
    Ok(output)
}

/// Resampling to 16 kHz a piece at a time, for audio too long to hold.
///
/// An hour at 48 kHz is ~690 MB as `f32`; this holds one block. Fed the same
/// samples in any number of pieces, it produces exactly what `to_16k` does
/// on the whole — which is `to_16k`, so the two cannot drift.
pub struct To16k {
    /// `None` when the input is already at 16 kHz.
    resampler: Option<Fft<f32>>,
    from_rate: u32,
    /// Input not yet making a whole block.
    pending: Vec<f32>,
}

impl To16k {
    pub fn new(from_rate: u32) -> Result<Self, AudioError> {
        if from_rate == 0 {
            return Err(AudioError::Config("source sample rate is zero".into()));
        }
        let resampler = if from_rate == TARGET_SAMPLE_RATE {
            None
        } else {
            Some(
                Fft::<f32>::new(
                    from_rate as usize,
                    TARGET_SAMPLE_RATE as usize,
                    CHUNK_SIZE,
                    SUB_CHUNKS,
                    1, // mono
                    FixedSync::Input,
                )
                .map_err(|e| AudioError::Config(format!("resampler construction failed: {e}")))?,
            )
        };
        Ok(Self {
            resampler,
            from_rate,
            pending: Vec::new(),
        })
    }

    /// Resample whatever whole blocks `input` completes, appending to `out`.
    pub fn push(&mut self, input: &[f32], out: &mut Vec<f32>) -> Result<(), AudioError> {
        let Some(resampler) = self.resampler.as_mut() else {
            out.extend_from_slice(input);
            return Ok(());
        };
        self.pending.extend_from_slice(input);

        let mut pos = 0;
        loop {
            let needed = resampler.input_frames_next();
            if pos + needed > self.pending.len() {
                break;
            }
            let adapter = InterleavedSlice::new(&self.pending[pos..pos + needed], 1, needed)
                .map_err(|e| AudioError::Config(format!("input adapter: {e}")))?;
            let block = resampler
                .process(&adapter, 0, None)
                .map_err(|e| AudioError::Config(format!("resample failed: {e}")))?;
            append_mono(out, &block);
            pos += needed;
        }
        self.pending.drain(..pos);
        Ok(())
    }

    /// Resample the remainder, appending to `out`.
    ///
    /// Zero-padded up to a full block rather than discarded. Dropping the tail
    /// would silently truncate up to ~85 ms from the end of every recording —
    /// and the end of a meeting is where the decisions are.
    pub fn finish(mut self, out: &mut Vec<f32>) -> Result<(), AudioError> {
        let Some(resampler) = self.resampler.as_mut() else {
            return Ok(());
        };
        if self.pending.is_empty() {
            return Ok(());
        }

        let needed = resampler.input_frames_next();
        let remaining = self.pending.len();
        self.pending.resize(needed, 0.0);

        let adapter = InterleavedSlice::new(&self.pending, 1, needed)
            .map_err(|e| AudioError::Config(format!("tail adapter: {e}")))?;
        let block = resampler
            .process(&adapter, 0, None)
            .map_err(|e| AudioError::Config(format!("resample tail failed: {e}")))?;

        let before = out.len();
        append_mono(out, &block);

        // Keep only the samples corresponding to real input, not the padding.
        let real = remaining * TARGET_SAMPLE_RATE as usize / self.from_rate as usize;
        out.truncate(before + real.min(out.len() - before));
        Ok(())
    }
}

/// Copy channel 0 out of a resampler output block.
fn append_mono<'a>(out: &mut Vec<f32>, block: &impl audioadapter::Adapter<'a, f32>) {
    let frames = block.frames();
    out.reserve(frames);
    for frame in 0..frames {
        // Mono: channel 0 is the only channel, and the index is in range.
        out.push(block.read_sample(0, frame).unwrap_or(0.0));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Generate `secs` of a sine at `freq` Hz.
    fn sine(freq: f32, rate: u32, secs: f32) -> Vec<f32> {
        let n = (rate as f32 * secs) as usize;
        (0..n)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / rate as f32).sin())
            .collect()
    }

    /// Estimate the dominant frequency by counting zero crossings.
    fn dominant_freq(samples: &[f32], rate: u32) -> f32 {
        // Skip the filter's settling region at each end.
        let skip = samples.len() / 10;
        let body = &samples[skip..samples.len() - skip];
        let crossings = body
            .windows(2)
            .filter(|w| (w[0] < 0.0) != (w[1] < 0.0))
            .count();
        crossings as f32 * rate as f32 / (2.0 * body.len() as f32)
    }

    #[test]
    fn already_at_target_rate_is_a_passthrough() {
        let input = vec![0.1, -0.2, 0.3];
        assert_eq!(to_16k(&input, 16_000).unwrap(), input);
    }

    #[test]
    fn empty_input_yields_empty_output() {
        assert!(to_16k(&[], 48_000).unwrap().is_empty());
    }

    #[test]
    fn zero_source_rate_errors_rather_than_dividing_by_zero() {
        assert!(to_16k(&[0.1, 0.2], 0).is_err());
    }

    #[test]
    fn output_length_matches_the_rate_ratio() {
        let input = sine(440.0, 48_000, 1.0);
        let out = to_16k(&input, 48_000).unwrap();
        // 1 second in, 1 second out, within one block of slack.
        let diff = (out.len() as i64 - 16_000).abs();
        assert!(diff < 1024, "expected ~16000 samples, got {}", out.len());
    }

    #[test]
    fn preserves_a_speech_band_tone() {
        // 440 Hz sits well inside the band both rates represent, so it must
        // survive the conversion essentially unchanged.
        let input = sine(440.0, 48_000, 0.5);
        let out = to_16k(&input, 48_000).unwrap();

        let freq = dominant_freq(&out, TARGET_SAMPLE_RATE);
        assert!(
            (freq - 440.0).abs() < 20.0,
            "expected ~440 Hz after resampling, measured {freq:.1} Hz"
        );
    }

    #[test]
    fn attenuates_content_above_the_new_nyquist() {
        // 12 kHz cannot be represented at 16 kHz (Nyquist 8 kHz). A correct
        // resampler filters it out. A naive decimator would alias it down to
        // 4 kHz — right in the middle of the speech band — at full amplitude.
        let input = sine(12_000.0, 48_000, 0.5);
        let out = to_16k(&input, 48_000).unwrap();

        let skip = out.len() / 10;
        let body = &out[skip..out.len() - skip];
        let peak = body.iter().fold(0.0f32, |m, s| m.max(s.abs()));

        assert!(
            peak < 0.1,
            "above-Nyquist content must be filtered, not aliased; peak was {peak:.3}"
        );
    }

    #[test]
    fn handles_a_non_integer_ratio() {
        // 44100 -> 16000 is 2.75625:1. Integer-decimation shortcuts break here.
        let input = sine(440.0, 44_100, 0.5);
        let out = to_16k(&input, 44_100).unwrap();

        let expected = 8_000; // 0.5s at 16 kHz
        assert!(
            (out.len() as i64 - expected).abs() < 1024,
            "expected ~{expected} samples, got {}",
            out.len()
        );

        let freq = dominant_freq(&out, TARGET_SAMPLE_RATE);
        assert!(
            (freq - 440.0).abs() < 20.0,
            "expected ~440 Hz, measured {freq:.1} Hz"
        );
    }

    #[test]
    fn resampling_in_pieces_matches_resampling_the_whole() {
        // The full-quality pass streams a recording through `To16k` rather
        // than holding it; the transcript must not change for that.
        let input = sine(440.0, 48_000, 2.3);
        let whole = to_16k(&input, 48_000).unwrap();

        for piece in [480, 4096, 12_345] {
            let mut r = To16k::new(48_000).unwrap();
            let mut out = Vec::new();
            for slice in input.chunks(piece) {
                r.push(slice, &mut out).unwrap();
            }
            r.finish(&mut out).unwrap();
            assert_eq!(out, whole, "pieces of {piece}");
        }
    }

    #[test]
    fn a_stream_already_at_16k_passes_through() {
        let mut r = To16k::new(16_000).unwrap();
        let mut out = Vec::new();
        r.push(&[0.1, 0.2], &mut out).unwrap();
        r.push(&[0.3], &mut out).unwrap();
        r.finish(&mut out).unwrap();
        assert_eq!(out, vec![0.1, 0.2, 0.3]);
    }

    #[test]
    fn short_input_shorter_than_one_block_is_not_dropped() {
        // Regression guard: a naive implementation that only emits whole
        // blocks would return nothing at all here.
        let input = sine(440.0, 48_000, 0.02); // 960 samples, well under CHUNK_SIZE
        let out = to_16k(&input, 48_000).unwrap();
        assert!(!out.is_empty(), "sub-block input must still produce output");
    }
}
