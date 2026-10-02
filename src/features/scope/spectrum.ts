/**
 * The arithmetic behind the live scope, apart from any canvas.
 *
 * Samples arrive at about 12kHz (src-tauri/src/audio/scope.rs), 512 at a
 * time per stream: roughly 43ms of each voice.
 */

export const SAMPLE_RATE = 12_000;

export const SCOPE_MODES = ["wave", "spectrum", "spectrograph"] as const;

export type ScopeMode = (typeof SCOPE_MODES)[number];

export const SCOPE_MODE_NOTES: Record<ScopeMode, string> = {
  wave: "How loud each voice is, rolling past: you above, them below.",
  spectrum: "Where each voice's energy sits, low to high: you up, them down.",
  spectrograph: "Each voice's pitch over time, rolling past: you above, them below.",
};

export function isScopeMode(value: unknown): value is ScopeMode {
  return typeof value === "string" && (SCOPE_MODES as readonly string[]).includes(value);
}

/**
 * Magnitudes of a real signal's spectrum, bins 0…n/2. Radix-2, in place;
 * `samples.length` must be a power of two. Windowed with a Hann window, so a
 * voice's harmonics show as peaks rather than smears.
 */
export function magnitudes(samples: number[]): number[] {
  const n = samples.length;
  if (n === 0 || (n & (n - 1)) !== 0) return [];
  const re = samples.map((s, i) => s * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))));
  const im = new Array<number>(n).fill(0);

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] ?? 0, re[i] ?? 0];
      [im[i], im[j]] = [im[j] ?? 0, im[i] ?? 0];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const a = start + k;
        const b = a + size / 2;
        const cos = Math.cos(step * k);
        const sin = Math.sin(step * k);
        const bre = re[b] ?? 0;
        const bim = im[b] ?? 0;
        const tre = bre * cos - bim * sin;
        const tim = bre * sin + bim * cos;
        re[b] = (re[a] ?? 0) - tre;
        im[b] = (im[a] ?? 0) - tim;
        re[a] = (re[a] ?? 0) + tre;
        im[a] = (im[a] ?? 0) + tim;
      }
    }
  }
  return Array.from({ length: n / 2 + 1 }, (_, i) => Math.hypot(re[i] ?? 0, im[i] ?? 0) / n);
}

/**
 * The spectrum folded into `count` bands, spaced logarithmically from 80Hz
 * to 6kHz — the range a voice lives in, and the way an ear hears pitch —
 * each as 0–1 on a 60dB scale.
 */
export function bands(samples: number[], count: number): number[] {
  const mags = magnitudes(samples);
  if (mags.length === 0) return new Array<number>(count).fill(0);
  const hzPerBin = SAMPLE_RATE / samples.length;
  const low = Math.log(80);
  const high = Math.log(SAMPLE_RATE / 2);
  return Array.from({ length: count }, (_, b) => {
    const from = Math.exp(low + ((high - low) * b) / count) / hzPerBin;
    const to = Math.exp(low + ((high - low) * (b + 1)) / count) / hzPerBin;
    let peak = 0;
    for (let i = Math.floor(from); i <= Math.max(Math.floor(from), Math.ceil(to) - 1); i++) {
      peak = Math.max(peak, mags[i] ?? 0);
    }
    const db = 20 * Math.log10(peak + 1e-9);
    return Math.max(0, Math.min(1, (db + 70) / 60));
  });
}

/**
 * How loud a stretch of samples is, 0–1, on a 54dB scale from −60dB.
 *
 * Decibels rather than a gain that follows the signal: a following gain
 * blows room noise up to full height in a pause and shrinks everything
 * after a laugh, which is the jitter the raw waveform had. On this scale
 * silence is flat, conversation sits around half, a shout near the top —
 * headroom, so loud speech still has a shape — and nothing pumps.
 */
export function loudness(samples: number[]): number {
  if (samples.length === 0) return 0;
  const rms = Math.sqrt(samples.reduce((sum, s) => sum + s * s, 0) / samples.length);
  const db = 20 * Math.log10(rms + 1e-9);
  return Math.max(0, Math.min(1, (db + 60) / 54));
}

/**
 * One step towards `target`: quickly up, slowly down, as a VU meter's
 * needle moves — so a syllable registers at once and then settles rather
 * than flickering with every 50ms window.
 */
export function ease(previous: number, target: number, up = 0.55, down = 0.14): number {
  return previous + (target - previous) * (target > previous ? up : down);
}
