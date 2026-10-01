import { describe, expect, it } from "vitest";
import { bands, followGain, magnitudes, SAMPLE_RATE } from "./spectrum";

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

describe("the gain", () => {
  it("rises at once for a loud voice and falls slowly after", () => {
    const loud = followGain(0.04, tone(200, 512, 0.8));
    expect(loud).toBeCloseTo(0.8, 1);
    const after = followGain(loud, tone(200, 512, 0.05));
    expect(after).toBeLessThan(loud);
    expect(after).toBeGreaterThan(0.5);
  });

  it("never amplifies silence past its floor", () => {
    expect(followGain(0.04, new Array(512).fill(0))).toBeCloseTo(0.04);
  });
});
