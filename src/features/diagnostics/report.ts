import { formatBytes } from "../../lib/format";
import type { AudioRetention, DiagnosticsReport, LlmStatus, LoadedModel } from "../../lib/ipc";

/** One line for the summary model's state, as a person would say it. */
export function describeLlm(llm: LlmStatus): string {
  switch (llm.state) {
    case "ready":
      return `ready, using ${llm.model}`;
    case "no_model":
      return `running, no model installed (suggested: ${llm.suggested})`;
    case "not_running":
      return "not running";
  }
}

export function describeRetention(r: AudioRetention): string {
  switch (r.mode) {
    case "delete":
      return "deleted once notes are written";
    case "keep_latest":
      return `kept for the latest ${r.count} meeting${r.count === 1 ? "" : "s"}`;
    case "keep_all":
      return "kept for every meeting";
  }
}

/**
 * How much of a loaded model sits in video memory.
 *
 * The number that says whether notes will be quick: partly on the CPU is the
 * usual cause of slow summaries, and nothing else on screen would show it.
 */
export function describeLoaded(m: LoadedModel): string {
  const onGpu = m.sizeBytes > 0 ? Math.round((m.vramBytes / m.sizeBytes) * 100) : 0;
  const context = m.contextLength ? `, ${m.contextLength} context` : "";
  return `${m.name}: ${formatBytes(m.sizeBytes)}, ${onGpu}% on GPU${context}`;
}

/**
 * The report as plain text, for pasting into a message.
 *
 * Plain rather than Markdown or JSON: it is read by a person first, and has
 * to survive being pasted into anything.
 */
export function formatReport(r: DiagnosticsReport): string {
  const lines = [
    "TRACE diagnostics",
    "",
    `Version       ${r.appVersion}${r.devBuild ? " (dev build)" : ""}`,
    `OS            ${r.os}`,
    `CPU           ${r.cpu}, ${r.threads} threads`,
    `Memory        ${formatBytes(r.memoryBytes)}`,
    `Speech        ${r.speechModel}, ${r.speechInstalled ? "installed" : "NOT installed"}`,
    `Inference     ${r.accelerator}`,
    `Ollama        ${r.ollamaVersion ?? "not reachable"}`,
    `Summaries     ${describeLlm(r.llm)}`,
    `Preference    ${r.preferredModels.join(", ")}`,
    `Context       ${r.contextTokens} tokens`,
    ...(r.loadedModels.length === 0
      ? ["Loaded        none"]
      : r.loadedModels.map((m, i) => `${i === 0 ? "Loaded" : ""}`.padEnd(14) + describeLoaded(m))),
    `Audio         ${describeRetention(r.audioRetention)}`,
    `LLM memory    ${r.summaryMemory === "while_writing" ? "only while writing" : "during meetings"}`,
    `Notes         ${r.notesRoot}`,
    `Log           ${r.logDir}`,
    "",
    `Recent events (${r.recent.length})`,
    ...(r.recent.length === 0 ? ["  none recorded"] : r.recent.map((l) => `  ${l}`)),
  ];
  return lines.join("\n");
}
