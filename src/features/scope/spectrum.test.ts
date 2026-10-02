import { describe, expect, it } from "vitest";
import { bands, ease, isScopeMode, loudness, magnitudes, SAMPLE_RATE } from "./spectrum";

const tone = (hz: number, n = 512, amplitude = 0.5) =>
  Array.from({ length: n }, (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE));

describe("the spectrum", () => {
  it("puts a tone's energy in its own bin", () => {
    // 1031.25Hz is bin 44 exactly at 512 points and 12kHz.
    const mags = magnitudes(tone(1031.25));
    const loudest = mags.indexOf(Math.max(...mags));
    expect(loudest).toBe(44);
  });

  it("refuses a length that is not a power of two", () => {
    expect(magnitudes(new Array(300).fill(0))).toEqual([]);
  });

  it("lights a low band for a low voice and a high band for a high one", () => {
    const low = bands(tone(120), 24);
    const high = bands(tone(3000), 24);
    const peakOf = (b: number[]) => b.indexOf(Math.max(...b));
    expect(peakOf(low)).toBeLessThan(6);
    expect(peakOf(high)).toBeGreaterThan(16);
  });

  it("is dark for silence", () => {
    expect(Math.max(...bands(new Array(512).fill(0), 24))).toBe(0);
  });
});

describe("loudness", () => {
  it("is nothing for silence and most of the scale for speech", () => {
    expect(loudness(new Array(512).fill(0))).toBe(0);
    expect(loudness(tone(200, 512, 0.001))).toBe(0);
    const speech = loudness(tone(200, 512, 0.15));
    expect(speech).toBeGreaterThan(0.6);
    expect(speech).toBeLessThan(1);
  });

  it("does not shrink a quiet voice after a loud one", () => {
    // No memory: the same samples are the same height whatever came before.
    const quiet = tone(200, 512, 0.03);
    loudness(tone(200, 512, 0.9));
    expect(loudness(quiet)).toBe(loudness(tone(200, 512, 0.03)));
  });
});

describe("ease", () => {
  it("rises faster than it falls", () => {
    expect(ease(0, 1)).toBeGreaterThan(1 - ease(1, 0));
  });
});

describe("modes", () => {
  it("no longer knows xy, so a saved one falls back to the default", () => {
    expect(isScopeMode("xy")).toBe(false);
    expect(isScopeMode("spectrograph")).toBe(true);
  });
});
