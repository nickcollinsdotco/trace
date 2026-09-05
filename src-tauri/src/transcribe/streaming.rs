//! Incremental chunking for live transcription.
//!
//! The offline chunker in [`super::chunker`] sees the whole recording at once.
//! During a meeting we only ever have the audio so far, so boundaries must be
//! decided from a prefix of the stream and never revised.
//!
//! The decision rules are identical to the offline chunker — silence closes a
//! chunk, length closes one regardless — and for a given `ChunkConfig` the two
//! produce identical boundaries, which is held by test.
//!
//! In practice the live path runs `ChunkConfig::live`, whose ceiling is much
//! shorter, so the final pass genuinely does re-cut the transcript. That is
//! why live segments are provisional. Sharing the algorithm still matters:
//! boundaries differ only where the ceiling forces them to, not because two
//! implementations disagree.
//!
//! # Memory
//!
//! Only audio that could still form part of the current chunk is retained;
//! everything older is dropped as it is consumed. A two-hour meeting holds at
//! most one chunk's worth of samples, not two hours' worth.

use transcribe_rs::vad::{EnergyVad, Vad};

use super::chunker::{Chunk, ChunkConfig};

/// Feeds samples in, gets bounded chunks out.
pub struct StreamingChunker {
    config: ChunkConfig,
    vad: EnergyVad,

    /// Retained samples. `buffer[0]` is absolute sample `buffer_origin`.
    buffer: Vec<f32>,
    buffer_origin: usize,

    /// Samples not yet forming a whole VAD frame.
    pending: usize,

    // Absolute sample positions, so they stay valid as the buffer is trimmed.
    chunk_start: usize,
    speech_start: usize,
    speech_end: usize,

    silence_run: usize,
    saw_speech: bool,
    total_seen: usize,
}

impl StreamingChunker {
    pub fn new(config: ChunkConfig) -> Self {
        let vad = EnergyVad::new(config.frame_size, config.energy_threshold);
        Self {
            config,
            vad,
            buffer: Vec::new(),
            buffer_origin: 0,
            pending: 0,
            chunk_start: 0,
            speech_start: 0,
            speech_end: 0,
            silence_run: 0,
            saw_speech: false,
            total_seen: 0,
        }
    }

    /// Append audio and return any chunks that became complete.
    ///
    /// Samples must already be at the chunker's configured rate.
    pub fn push(&mut self, samples: &[f32]) -> Vec<Chunk> {
        self.buffer.extend_from_slice(samples);
        self.total_seen += samples.len();
        self.pending += samples.len();

        let mut out = Vec::new();
        let frame = self.config.frame_size;
        if frame == 0 {
            return out;
        }

        while self.pending >= frame {
            // Absolute bounds of the frame about to be classified.
            let frame_start = self.total_seen - self.pending;
            let frame_end = frame_start + frame;
            self.pending -= frame;

            let rel = frame_start - self.buffer_origin;
            let is_speech = self
                .vad
                .is_speech(&self.buffer[rel..rel + frame])
                .unwrap_or(false);

            if is_speech {
                if !self.saw_speech {
                    self.speech_start = frame_start;
                }
                self.speech_end = frame_end;
                self.saw_speech = true;
                self.silence_run = 0;
            } else {
                self.silence_run += 1;
            }

            let len = frame_end - self.chunk_start;
            let ends_on_silence = self.saw_speech
                && self.silence_run >= self.config.silence_frames
                && len >= self.config.min_samples;
            let ends_on_soft_max =
                self.saw_speech && len >= self.config.soft_max_samples && !is_speech;
            let ends_on_hard_max = len >= self.config.hard_max_samples;

            if ends_on_silence || ends_on_soft_max || ends_on_hard_max {
                let end = if ends_on_hard_max && is_speech {
                    frame_end
                } else {
                    self.speech_end
                };
                if let Some(chunk) = self.take_chunk(self.speech_start, end) {
                    out.push(chunk);
                }
                self.chunk_start = frame_end;
                self.silence_run = 0;
                self.saw_speech = false;
                self.trim_to(frame_end);
            }
        }

        out
    }

    /// Advance by `frames` of silence that were never materialised.
    ///
    /// WASAPI loopback pads quiet spans rather than emitting them, and sending
    /// that padding through the tap as real samples floods the channel — it
    /// measurably pushed the worker into dropping audio. The gap arrives as a
    /// count instead and the zeros are generated here, which costs one local
    /// allocation and no cross-thread traffic.
    pub fn push_silence(&mut self, frames: u64) -> Vec<Chunk> {
        let mut out = Vec::new();
        let mut remaining = frames as usize;

        // Fed in blocks so a multi-minute gap never becomes one huge Vec.
        let block = self.config.frame_size.max(1) * 32;
        let zeros = vec![0.0f32; block];

        while remaining > 0 {
            let n = remaining.min(block);
            out.extend(self.push(&zeros[..n]));
            remaining -= n;
        }

        out
    }

    /// Emit whatever speech remains. Call once, when capture stops.
    ///
    /// Without this the final utterance of a meeting — often the part that
    /// matters most — would be stranded in the buffer.
    pub fn flush(&mut self) -> Option<Chunk> {
        if !self.saw_speech {
            return None;
        }
        let chunk = self.take_chunk(self.speech_start, self.speech_end);
        self.saw_speech = false;
        chunk
    }

    /// Build a chunk from absolute bounds, padded and clamped to the buffer.
    fn take_chunk(&self, speech_start: usize, speech_end: usize) -> Option<Chunk> {
        let start = speech_start
            .saturating_sub(self.config.pad_samples)
            .max(self.buffer_origin);
        let end =
            (speech_end + self.config.pad_samples).min(self.buffer_origin + self.buffer.len());

        if end <= start {
            return None;
        }

        let rel_start = start - self.buffer_origin;
        let rel_end = end - self.buffer_origin;

        Some(Chunk {
            start_sample: start,
            samples: self.buffer[rel_start..rel_end].to_vec(),
        })
    }

    /// Drop audio that no future chunk can need.
    ///
    /// Keeps `pad_samples` behind the cut so the next chunk's leading pad is
    /// still available.
    fn trim_to(&mut self, absolute: usize) {
        let keep_from = absolute.saturating_sub(self.config.pad_samples);
        if keep_from <= self.buffer_origin {
            return;
        }
        let drop = keep_from - self.buffer_origin;
        if drop >= self.buffer.len() {
            self.buffer.clear();
        } else {
            self.buffer.drain(..drop);
        }
        self.buffer_origin = keep_from;
    }

    /// Retained sample count, for asserting the buffer stays bounded.
    pub fn buffered_samples(&self) -> usize {
        self.buffer.len()
    }

    /// Speech held back waiting for the current chunk to close.
    ///
    /// This is the latency the user actually feels: words already spoken that
    /// cannot be shown until a boundary is found. Surfacing it lets the UI say
    /// "still listening" honestly rather than implying nothing is happening.
    pub fn pending_speech_samples(&self) -> usize {
        if !self.saw_speech {
            return 0;
        }
        self.speech_end.saturating_sub(self.speech_start)
    }
}

#[cfg(test)]
mod tests {
    use super::super::chunker::chunk_by_silence;
    use super::*;
    use crate::audio::resample::TARGET_SAMPLE_RATE;

    const RATE: usize = TARGET_SAMPLE_RATE as usize;

    fn speech(secs: f32) -> Vec<f32> {
        let n = (RATE as f32 * secs) as usize;
        (0..n)
            .map(|i| 0.3 * (2.0 * std::f32::consts::PI * 200.0 * i as f32 / RATE as f32).sin())
            .collect()
    }

    fn silence(secs: f32) -> Vec<f32> {
        vec![0.0; (RATE as f32 * secs) as usize]
    }

    /// Feed `audio` in fixed-size pieces and collect every chunk produced.
    fn run_streaming(audio: &[f32], piece: usize) -> Vec<Chunk> {
        let mut chunker = StreamingChunker::new(ChunkConfig::default());
        let mut out = Vec::new();
        for slice in audio.chunks(piece) {
            out.extend(chunker.push(slice));
        }
        out.extend(chunker.flush());
        out
    }

    #[test]
    fn agrees_with_the_offline_chunker() {
        // The property that matters: the live transcript and the accurate
        // re-pass must not disagree about utterance boundaries, or segments
        // would visibly reshuffle when the meeting ends.
        let mut audio = speech(2.0);
        audio.extend(silence(1.5));
        audio.extend(speech(2.0));
        audio.extend(silence(1.5));
        audio.extend(speech(1.0));

        let offline = chunk_by_silence(&audio, &ChunkConfig::default());
        let streamed = run_streaming(&audio, 4096);

        assert_eq!(
            offline.len(),
            streamed.len(),
            "offline and streaming must find the same number of chunks"
        );
        for (o, s) in offline.iter().zip(&streamed) {
            assert_eq!(o.start_sample, s.start_sample, "chunk offsets must match");
            assert_eq!(o.samples.len(), s.samples.len(), "chunk lengths must match");
        }
    }

    #[test]
    fn result_is_independent_of_how_audio_is_delivered() {
        // Real callbacks deliver irregular sizes; boundaries must not depend
        // on them.
        let mut audio = speech(1.5);
        audio.extend(silence(1.5));
        audio.extend(speech(1.5));

        let a = run_streaming(&audio, 480);
        let b = run_streaming(&audio, 4096);
        let c = run_streaming(&audio, 12_345);

        let bounds = |v: &Vec<Chunk>| -> Vec<(usize, usize)> {
            v.iter()
                .map(|c| (c.start_sample, c.samples.len()))
                .collect()
        };
        assert_eq!(bounds(&a), bounds(&b));
        assert_eq!(bounds(&b), bounds(&c));
    }

    #[test]
    fn emits_during_the_stream_not_only_at_the_end() {
        // The whole point of streaming: a chunk must appear as soon as its
        // trailing silence does, not when capture stops.
        let mut chunker = StreamingChunker::new(ChunkConfig::default());
        let mut audio = speech(2.0);
        audio.extend(silence(1.5));

        let mut emitted = 0;
        for slice in audio.chunks(4096) {
            emitted += chunker.push(slice).len();
        }
        assert_eq!(emitted, 1, "chunk should be emitted before any flush");
    }

    #[test]
    fn flush_recovers_the_final_utterance() {
        // A meeting ends mid-sentence more often than not.
        let mut chunker = StreamingChunker::new(ChunkConfig::default());
        for slice in speech(2.0).chunks(4096) {
            assert!(chunker.push(slice).is_empty(), "no trailing silence yet");
        }
        assert!(chunker.flush().is_some(), "final speech must not be lost");
    }

    #[test]
    fn flush_on_silence_only_yields_nothing() {
        let mut chunker = StreamingChunker::new(ChunkConfig::default());
        for slice in silence(3.0).chunks(4096) {
            chunker.push(slice);
        }
        assert!(chunker.flush().is_none());
    }

    #[test]
    fn buffer_stays_bounded_over_a_long_stream() {
        // Two hours of alternating speech and silence must not accumulate.
        // This is the property that makes live transcription viable at all.
        let mut chunker = StreamingChunker::new(ChunkConfig::default());
        let mut peak = 0usize;

        for _ in 0..60 {
            for slice in speech(2.0).chunks(4096) {
                chunker.push(slice);
                peak = peak.max(chunker.buffered_samples());
            }
            for slice in silence(1.5).chunks(4096) {
                chunker.push(slice);
                peak = peak.max(chunker.buffered_samples());
            }
        }

        // Comfortably under the hard ceiling plus padding.
        let ceiling = ChunkConfig::default().hard_max_samples + RATE;
        assert!(
            peak < ceiling,
            "buffer grew to {peak} samples, ceiling is {ceiling}"
        );
    }

    #[test]
    fn continuous_speech_is_still_bounded() {
        // The M2 failure, in streaming form.
        let chunks = run_streaming(&speech(90.0), 4096);
        assert!(chunks.len() >= 3);
        for c in &chunks {
            let secs = c.samples.len() as f32 / RATE as f32;
            assert!(secs <= 31.0, "chunk exceeded the ceiling at {secs:.1}s");
        }
    }

    #[test]
    fn chunk_offsets_increase_monotonically() {
        let mut audio = speech(1.5);
        audio.extend(silence(1.5));
        audio.extend(speech(1.5));
        audio.extend(silence(1.5));
        audio.extend(speech(1.5));

        let chunks = run_streaming(&audio, 4096);
        for pair in chunks.windows(2) {
            assert!(
                pair[1].start_sample > pair[0].start_sample,
                "timestamps would go backwards"
            );
        }
    }

    #[test]
    fn silence_gaps_split_chunks_exactly_like_real_silence() {
        // The loopback path reports quiet spans as a count instead of
        // samples. A gap must therefore close a chunk exactly as materialised
        // silence would, or system audio would only ever split at the ceiling
        // — which is precisely the bug that made live segments arrive 16s
        // late.
        let mut with_samples = StreamingChunker::new(ChunkConfig::default());
        let mut with_gap = StreamingChunker::new(ChunkConfig::default());

        let mut a = Vec::new();
        a.extend(with_samples.push(&speech(2.0)));
        a.extend(with_samples.push(&silence(1.5)));
        a.extend(with_samples.push(&speech(2.0)));

        let mut b = Vec::new();
        b.extend(with_gap.push(&speech(2.0)));
        b.extend(with_gap.push_silence((RATE as f64 * 1.5) as u64));
        b.extend(with_gap.push(&speech(2.0)));

        assert_eq!(a.len(), b.len(), "a gap must split like real silence");
        for (x, y) in a.iter().zip(&b) {
            assert_eq!(x.start_sample, y.start_sample);
            assert_eq!(x.samples.len(), y.samples.len());
        }
    }

    #[test]
    fn a_zero_length_gap_is_harmless() {
        let mut chunker = StreamingChunker::new(ChunkConfig::default());
        assert!(chunker.push_silence(0).is_empty());
    }

    #[test]
    fn an_empty_push_is_harmless() {
        let mut chunker = StreamingChunker::new(ChunkConfig::default());
        assert!(chunker.push(&[]).is_empty());
        assert!(chunker.flush().is_none());
    }
}
