import { describe, expect, it } from "vitest";
import type { DiagnosticsReport, LoadedModel } from "../../lib/ipc";
import { describeLoaded, formatReport } from "./report";

const FULLY_ON_GPU: LoadedModel = {
  name: "qwen3:14b",
  sizeBytes: 10_000,
  vramBytes: 10_000,
  contextLength: 8192,
};
const PARTLY_ON_CPU: LoadedModel = {
  name: "gemma3:12b",
  sizeBytes: 10_000,
  vramBytes: 6_000,
  contextLength: null,
};

const REPORT: DiagnosticsReport = {
  appVersion: "0.1.0",
  devBuild: true,
  os: "Windows 11 Home (26100)",
  cpu: "AMD Ryzen 7 7800X3D 8-Core Processor",
  threads: 16,
  memoryBytes: 34_359_738_368,
  accelerator: "CPU · ONNX Runtime (int8)",
  speechModel: "Parakeet TDT 0.6B v3 (int8)",
  speechInstalled: true,
  llm: { state: "ready", model: "qwen3:14b" },
  ollamaVersion: "0.12.3",
  preferredModels: ["qwen3:14b", "qwen3:8b"],
  loadedModels: [FULLY_ON_GPU, PARTLY_ON_CPU],
  contextTokens: 8192,
  audioRetention: { mode: "keep_latest", count: 5 },
  summaryMemory: "during_meetings",
  notesRoot: "C:\\Users\\you\\Documents\\TRACE",
  logDir: "C:\\Users\\you\\AppData\\Local\\TRACE\\logs",
  recent: ["2026-09-23 10:00:00 summary failed: Ollama is not running"],
};

describe("diagnostics report", () => {
  it("says the things a bug report needs, in plain text", () => {
    const text = formatReport(REPORT);
    expect(text).toContain("0.1.0 (dev build)");
    expect(text).toContain("ready, using qwen3:14b");
    expect(text).toContain("Ollama        0.12.3");
    expect(text).toContain("kept for the latest 5 meetings");
    expect(text).toContain("summary failed: Ollama is not running");
  });

  it("gives every loaded model its own line, labelled once", () => {
    const lines = formatReport(REPORT).split("\n");
    expect(lines.filter((l) => l.startsWith("Loaded"))).toHaveLength(1);
    expect(lines.some((l) => l.trimStart().startsWith("gemma3:12b"))).toBe(true);
  });

  it("shows how much of a model is on the GPU, since that decides speed", () => {
    expect(describeLoaded(PARTLY_ON_CPU)).toContain("60% on GPU");
    expect(describeLoaded(FULLY_ON_GPU)).toContain("8192 context");
  });

  it("says when Ollama cannot be reached rather than leaving a blank", () => {
    const text = formatReport({
      ...REPORT,
      ollamaVersion: null,
      llm: { state: "not_running" },
      loadedModels: [],
      recent: [],
    });
    expect(text).toContain("not reachable");
    expect(text).toContain("Loaded        none");
    expect(text).toContain("none recorded");
  });
});
