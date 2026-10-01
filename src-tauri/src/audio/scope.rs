//! The last moment of each stream's waveform, for the live scope.
//!
//! Written from the audio callback, so it takes no lock: a reader holding a
//! mutex at the wrong instant would make the microphone drop a buffer, and a
//! dropped buffer is a hole in the recording for the sake of a picture. Each
//! sample is an `AtomicU32` holding an `f32`'s bits. A reader can see a
//! frame the writer is half-way through replacing; for a waveform drawn
//! thirty times a second that is invisible, and it is the price of never
//! blocking the writer.

use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};

/// Samples kept. At the decimated rate below, about 85ms of a 48kHz stream —
/// a few cycles of a speaking voice, which is what a scope shows.
pub const SCOPE_LEN: usize = 1024;

/// Keep one sample in this many. 12kHz still shows everything in speech worth
/// seeing, and quarters the work done on the audio thread.
const DECIMATE: u64 = 4;

pub struct Scope {
    samples: Box<[AtomicU32]>,
    /// Samples ever kept; the newest sits at `(written - 1) % SCOPE_LEN`.
    written: AtomicU64,
    /// Samples ever offered, decimated or not, so decimation is continuous
    /// across callbacks of any size.
    offered: AtomicU64,
}

impl Default for Scope {
    fn default() -> Self {
        Self {
            samples: (0..SCOPE_LEN).map(|_| AtomicU32::new(0)).collect(),
            written: AtomicU64::new(0),
            offered: AtomicU64::new(0),
        }
    }
}

impl std::fmt::Debug for Scope {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Scope")
            .field("written", &self.written.load(Ordering::Relaxed))
            .finish()
    }
}

impl Scope {
    /// One writer per stream: its audio callback or capture thread.
    pub fn push(&self, samples: &[f32]) {
        let mut offered = self.offered.load(Ordering::Relaxed);
        let mut written = self.written.load(Ordering::Relaxed);
        for &s in samples {
            if offered % DECIMATE == 0 {
                self.samples[(written as usize) % SCOPE_LEN].store(s.to_bits(), Ordering::Relaxed);
                written += 1;
            }
            offered += 1;
        }
        self.offered.store(offered, Ordering::Relaxed);
        // Release, so a reader that sees the new count sees the samples too.
        self.written.store(written, Ordering::Release);
    }

    /// The newest `n` samples, oldest first. Fewer if fewer exist.
    pub fn latest(&self, n: usize) -> Vec<f32> {
        let written = self.written.load(Ordering::Acquire) as usize;
        let n = n.min(SCOPE_LEN).min(written);
        (written - n..written)
            .map(|i| f32::from_bits(self.samples[i % SCOPE_LEN].load(Ordering::Relaxed)))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_every_fourth_sample_across_callbacks_of_any_size() {
        let scope = Scope::default();
        let ramp: Vec<f32> = (0..16).map(|i| i as f32).collect();
        // Split unevenly: decimation must not restart at each callback.
        scope.push(&ramp[..3]);
        scope.push(&ramp[3..11]);
        scope.push(&ramp[11..]);
        assert_eq!(scope.latest(10), vec![0.0, 4.0, 8.0, 12.0]);
    }

    #[test]
    fn wraps_and_returns_the_newest_in_order() {
        let scope = Scope::default();
        let many: Vec<f32> = (0..(SCOPE_LEN * 4 * 3)).map(|i| i as f32).collect();
        scope.push(&many);
        let latest = scope.latest(3);
        let last = (many.len() - DECIMATE as usize) as f32;
        assert_eq!(latest, vec![last - 8.0, last - 4.0, last]);
    }

    #[test]
    fn never_returns_more_than_it_holds() {
        let scope = Scope::default();
        assert!(scope.latest(64).is_empty());
        scope.push(&[0.5; 8]);
        assert_eq!(scope.latest(64).len(), 2);
        assert_eq!(scope.latest(usize::MAX).len(), 2);
    }
}
