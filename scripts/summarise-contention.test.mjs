import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("summarises replay CPU and latency without counting warm-up or unfinished work", () => {
  const root = mkdtempSync(join(tmpdir(), "trace-contention-summary-"));
  try {
    const sample = (at_s, cpu_ms) => ({
      event: "sample",
      at_s,
      cpu_ms,
      system_cpu_percent: 25,
      ram_available: 8 * 2 ** 30,
    });
    const events = [
      { event: "start", mode: "overlap", pool: null, synthetic: true, logical_cpus: 16 },
      sample(0.5, 50),
      { event: "replay_start", at_s: 1 },
      sample(1.1, 100),
      sample(2.1, 2100),
      { event: "live_chunk", inference_ms: 8, response_ms: 10, nonempty: true },
      { event: "live_chunk", inference_ms: 12, response_ms: 30, nonempty: false },
      { event: "repass_chunk", started_s: 0.5, inference_ms: 1000, audio_ms: 20_000 },
      { event: "repass_chunk", started_s: 1.5, inference_ms: 1000, audio_ms: 40_000 },
      { event: "live_end", at_s: 3, elapsed_s: 2 },
      sample(4, 50_000),
      { event: "complete" },
    ];
    writeFileSync(join(root, "fixture.jsonl"), events.map((e) => JSON.stringify(e)).join("\n"));
    writeFileSync(
      join(root, "fixture.process.csv"),
      '"threads","peak_working_set_bytes","private_bytes"\n"9","1073741824","536870912"\n',
    );
    writeFileSync(join(root, "stopped.jsonl"), JSON.stringify({ event: "aborted" }));
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./summarise-contention.mjs", import.meta.url)), root],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const [summary, stopped] = JSON.parse(result.stdout);
    assert.equal(summary.mean_cpu_cores, 2);
    assert.equal(summary.mean_cpu_percent_machine, 12.5);
    assert.equal(summary.inference_median_ms, 10);
    assert.equal(summary.response_median_ms, 20);
    assert.equal(summary.response_max_ms, 30);
    assert.equal(summary.repass_audio_s_in_window, 20);
    assert.equal(summary.peak_rss_mib, 1024);
    assert.equal(summary.peak_private_mib, 512);
    assert.equal(summary.live_nonempty, 1);
    assert.equal(stopped.incomplete, true);
  } finally {
    assert.equal(dirname(root), tmpdir());
    assert.ok(basename(root).startsWith("trace-contention-summary-"));
    rmSync(root, { recursive: true, force: true });
  }
});
