// Aggregate only the diagnostic's anonymous counters. Configurations and
// transcript/audio files are never read. Usage: node scripts/summarise-contention.mjs <results-dir>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
if (!root) throw new Error("usage: summarise-contention.mjs <results-dir>");
const max = (values) => Math.max(...values);
const median = (values) => {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};
const rows = [];
for (const name of readdirSync(root).filter((n) => n.endsWith(".jsonl"))) {
  const events = readFileSync(join(root, name), "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const start = events.find((e) => e.event === "start");
  const begin = events.find((e) => e.event === "replay_start");
  const end = events.find((e) => e.event === "live_end");
  if (!events.some((e) => e.event === "complete") || !start || !begin || !end) {
    rows.push({ run: name, incomplete: true });
    continue;
  }
  const live = events.filter((e) => e.event === "live_chunk");
  const background = events.filter((e) => e.event === "repass_chunk");
  const samples = events.filter((e) => e.event === "sample");
  const replay = samples.filter((e) => e.at_s >= begin.at_s && e.at_s <= end.at_s);
  if (replay.length < 2) throw new Error(`${name}: too few samples to estimate CPU use`);
  const first = replay[0];
  const last = replay.at(-1);
  const cpuCores = (last.cpu_ms - first.cpu_ms) / ((last.at_s - first.at_s) * 1000);
  // PowerShell Export-Csv quotes numeric cells. Only this fixed numeric schema
  // is accepted here, not arbitrary CSV supplied by a user.
  const csv = readFileSync(join(root, name.replace(/\.jsonl$/, ".process.csv")), "utf8")
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(",").map((cell) => cell.replaceAll('"', "")));
  const keys = csv.shift();
  const process = csv.map((cells) =>
    Object.fromEntries(keys.map((key, i) => [key, Number(cells[i])])),
  );
  rows.push({
    run: name.replace(/\.jsonl$/, ""),
    mode: start.mode,
    pool: start.pool,
    synthetic: start.synthetic,
    live_chunks: live.length,
    live_nonempty: live.filter((e) => e.nonempty).length,
    inference_median_ms: median(live.map((e) => e.inference_ms)),
    inference_max_ms: max(live.map((e) => e.inference_ms)),
    response_median_ms: median(live.map((e) => e.response_ms)),
    response_max_ms: max(live.map((e) => e.response_ms)),
    mean_cpu_cores: cpuCores,
    mean_cpu_percent_machine: (cpuCores / start.logical_cpus) * 100,
    cpu_sample_window_s: last.at_s - first.at_s,
    mean_system_cpu_percent:
      replay.reduce((sum, e) => sum + e.system_cpu_percent, 0) / replay.length,
    peak_rss_mib: max(process.map((e) => e.peak_working_set_bytes)) / 2 ** 20,
    peak_private_mib: max(process.map((e) => e.private_bytes)) / 2 ** 20,
    peak_threads: max(process.map((e) => e.threads)),
    minimum_available_gib: Math.min(...samples.map((e) => e.ram_available)) / 2 ** 30,
    repass_chunks: background.length,
    // Only completed chunks ending inside the live window count as throughput.
    repass_audio_s_in_window: background
      .filter((e) => e.started_s + e.inference_ms / 1000 <= end.elapsed_s)
      .reduce((sum, e) => sum + e.audio_ms / 1000, 0),
    live_window_s: end.elapsed_s,
  });
}
console.log(JSON.stringify(rows, null, 2));
