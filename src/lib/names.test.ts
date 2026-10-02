import { describe, expect, it } from "vitest";
import { shortMic, shortModel } from "./names";

describe("shortMic", () => {
  it("keeps the device and drops the role Windows puts first", () => {
    expect(shortMic("Microphone (Razer Seiren V3 Mini)")).toBe("Razer Seiren V3 Mini");
    expect(shortMic("Microphone (3- Razer Seiren V3 Mini)")).toBe("Razer Seiren V3 Mini");
    expect(shortMic("Microphone Array (Realtek(R) Audio)")).toBe("Realtek Audio");
    expect(shortMic("Headset Microphone (Jabra Evolve2 65)")).toBe("Jabra Evolve2 65");
  });

  it("leaves a name that is not role-then-device alone", () => {
    expect(shortMic("Yeti Stereo Microphone")).toBe("Yeti Stereo Microphone");
    expect(shortMic("Elgato Wave:3 (Main)")).toBe("Elgato Wave:3 (Main)");
  });
});

describe("shortModel", () => {
  it("keeps the family and version", () => {
    expect(shortModel("Parakeet TDT 0.6B v3 (int8)")).toBe("Parakeet v3");
    expect(shortModel("Parakeet TDT 0.6B v2 (int8)")).toBe("Parakeet v2");
  });

  it("never comes back empty", () => {
    expect(shortModel("(int8)")).toBe("(int8)");
  });
});
