# Resource contention: successive meetings

Investigation date: 1 November 2026. Baseline: TRACE v0.41.0,
`5db9fdcfa4f4edbdec4e50d5bce1870bff6a5143`. This change adds diagnostics only;
it does not alter the app's pools, scheduling, settings or model defaults.

**Result:** these real-audio replays show modest extra live latency, not a
stall, but substantial avoidable CPU use. A shared 4-intra / 1-inter ORT pool
with spinning disabled uses about 45% less CPU in the repeated overlap trial.
The existing public ORT API can apply that configuration through unmodified
Parakeet. A dependency fork or a new capture/summary scheduling policy is not
the smallest next step justified by this evidence.

## What actually overlaps

- `capture_manager::start` loads the next meeting's live engine independently
  of `ACTIVITY.lane()`. `LiveTranscriber` has one worker for both streams and a
  4,000-message input queue (about 20 seconds at 100 blocks/second/stream).
  Capture does not wait for inference; overflowing this queue loses provisional
  transcription input, not the recorded WAV.
- `spawn_repass` holds the lane across a full-quality pass and its subsequent
  summary. Thus two background jobs do not run together, but one can overlap
  the next live engine. The comment in `repass` about keeping peak memory to
  one model is true for the preceding meeting's engine, not for a new meeting.
- A re-pass processes streams serially and drops its engine before synthesis.
  Ordinary lane work therefore does **not** run live ASR, re-pass inference
  and summary generation all at once. It can run two ASR engines alongside a
  **resident or loading** summary model. `ModelHold::for_meeting` preloads under
  “ready during meetings”, renews its lease every four minutes and checks memory
  every minute. Once the re-pass ends, summary generation can overlap live ASR
  under either summary-memory setting.
- `memory::check` guards LLM residency/loading and `wait_for_room` checks between
  summary requests. It is a RAM/VRAM admission policy, not a CPU scheduler.
  Speech-engine loading has no equivalent headroom admission check. A model
  already wholly on the GPU is retained; a RAM-spilling resident model is
  refused only below the critical RAM floor. `ModelHold` counts holders so
  ending one meeting need not unload a model another job uses.
- The idle upgrade watcher waits for no busy work and five minutes without
  input before starting. This is not a general pause/resume mechanism for
  ordinary re-passes or summaries.

## Dependency finding: a fork is not required for a shared pool

The installed and locked sources were inspected directly:

| Source | Finding |
| --- | --- |
| `transcribe-rs 0.3.11`, `src/onnx/parakeet/mod.rs` | `ParakeetModel::load` creates encoder, decoder/joint and preprocessor sessions. Fields are private; there is no constructor accepting session options or threads. |
| `transcribe-rs`, `src/onnx/session.rs` | `create_session` calls `build_session(path, None, true)`: default intra-op pool **and parallel execution**. `create_session_with_threads` exists but Parakeet does not use it. Merely exposing that count would leave inter-op threading and spinning unaddressed. |
| `ort 2.0.0-rc.12`, `src/environment.rs` | Public `GlobalThreadPoolOptions` accepts intra-op count, inter-op count, spin control and a custom `ThreadManager`. `ort::init().with_global_thread_pool(...).commit()` must precede all sessions. |
| `ort`, `src/session/builder/impl_commit.rs` | When the environment has a global pool, session commit calls `DisablePerSessionThreads` unless explicitly opted out. Parakeet does not opt out. |
| `ort`, `src/environment.rs` and session builder | A custom thread manager can set Windows worker priority. This is not a built-in Parakeet priority setter. Global workers serve **both** engines; lowering them would lower live inference too. |

The example adds an exact-version **dev dependency** on the same ORT already
used by `transcribe-rs`. Cargo resolves one ORT version. This exposes its public
environment API to the diagnostic without vendoring, changing production
initialisation or changing resolved package versions.

`cargo tree --offline -e features -i transcribe-rs` shows `onnx` and
`audio-features`, with no GPU execution-provider features. The model session
builder therefore selects CPU. The prebuilt runtime links DirectML as well;
the presence of `DirectML.dll` alone does not show which provider executes ASR.

No inspected Parakeet/session code reads an environment variable for these
counts. Setting `OMP_NUM_THREADS` is not an established fix for this build.
An upstream per-model options API remains useful **if different live and
re-pass pools or worker priorities are needed**. It is not a prerequisite for
testing shared thread limits and spin control now.

## Reproducing safely

Build in this checkout, without running TRACE:

```powershell
pnpm install --offline --frozen-lockfile
pnpm build
cd src-tauri
cargo build --offline --release --example resource_contention -j 4
cargo test --offline --example resource_contention -j 4
cd ..
```

Create a local JSON file **outside the repository**. Supply two retained WAVs
and an installed Parakeet directory; do not change retention settings or record
anything for this diagnostic. This is a template, not a committed session map:

```json
{
  "model_dir": "C:/local/models/parakeet-tdt-0.6b-v3-int8",
  "wavs": ["C:/local/session/mic.wav", "C:/local/session/system.wav"],
  "start_secs": 60,
  "duration_secs": 30,
  "timeout_secs": 150,
  "mode": "overlap",
  "pool": null,
  "cancel_file": "C:/local/contention/CANCEL"
}
```

```powershell
./scripts/resource-contention.ps1 -Config C:/local/contention/config.json `
  -OutputDirectory C:/local/contention/results -RunLabel A01
# Direct invocation also has its own watchdog:
./src-tauri/target/release/examples/resource_contention.exe C:/local/contention/config.json
# Cancel from another terminal (or Ctrl+C in the launcher):
New-Item -ItemType File C:/local/contention/CANCEL
```

Use a fresh process and run label for every condition. `mode` is `solo` (one
engine), `idle` (second warmed engine retained without inference), or `overlap`
(second engine continuously re-passes the short excerpt). `pool: null` preserves
the production defaults. To test the existing shared-pool API, use
`"pool": {"intra": 4, "inter": 1, "spin": false}`. Change `spin` alone for a
matched spin-control comparison. Empty `wavs: []` generates two tone streams;
that checks plumbing only, not speech performance.

The executable refuses to start below 8 GiB available RAM or with any TRACE
or Ollama process running. A 500 ms watchdog repeats process checks, aborts
below 4 GiB and honours the cancel file. The JSON timeout includes loading,
warm-up and inference and is limited to 180 seconds; the launcher adds a second
process deadline five seconds later. Aborting kills only this diagnostic.
These checks reduce risk but cannot make simultaneous user activity atomic.
Never run it alongside real recording or summary work.

WAVs are opened by `hound` read-only, **not** TRACE's repair-on-open reader.
Only the bounded excerpt is decoded; no session metadata, notes or journals are
opened. Paths remain in local configuration; stdout contains no recognised
words, titles, session IDs or audio. Results are discarded immediately after
recording whether they were empty. The program does not contact Ollama, load
an LLM, install models or alter application state.

## Workload and metric definitions

Each stream is downmixed and resampled to 16 kHz, then fed to the real
`StreamingChunker` with live settings in 10 ms blocks. Emission time, including
silence lookahead, becomes its replay deadline. Both streams' chunks share one
serial live inference worker. The re-pass uses `chunk_by_silence` with offline
settings and repeats those chunks continuously until live replay finishes.
Each engine is loaded and warmed **serially**, then allowed one second to
settle. Loading is reported separately from replay.

This reproduces the model calls, stream sharing and competing background
inference, not actual devices, native-rate live VAD, the tap queue, file writes,
the UI or the full application. No input chunks are dropped in the harness;
live backlog is visible as deadline-to-result latency. Reusing a short excerpt
keeps the workload bounded and comparable but is not a whole-meeting throughput
or transcript-quality evaluation. The second engine uses the same excerpts as
the live one; this controls content rather than modelling two distinct meetings.

Raw output per run:

- `.jsonl`: phase boundaries, load/warm-up duration, each chunk's audio and
  inference duration, live response latency, and 500 ms process/system samples.
- `.process.csv`: process thread count, CPU milliseconds, working set, peak
  working set and private committed bytes sampled by the PowerShell parent.
- `.stderr.txt` and `.status.json`: engine diagnostics and completion/abort.

`inference_ms` excludes waiting for release. `response_ms` is result time minus
the chunk's release deadline and includes queueing. Neither measures the wait
from speech onset until a chunk becomes available. CPU milliseconds are the
sum across cores. Dividing their change by wall milliseconds gives occupied
cores; divide again by 16 for this machine's fraction of total logical CPU
capacity. RSS/private-byte peaks are process totals, not model-weight sizes.
Available RAM is a machine-wide sample, not attributable solely to TRACE.
These counters do not distinguish hard paging, GPU utilisation, thermal limits
or user-perceived UI responsiveness.

## Measurements

Hardware: Ryzen 7 7800X3D, 8 physical / 16 logical CPUs, 32 GiB installed RAM
(31.1 GiB usable), Windows 10 Home build 19045. The GPU was an RTX 5070 Ti
with 16,303 MiB total and 9,146 MiB free when inspected; no GPU/LLM workload
was introduced. Rust 1.98.1; release profile from the repository (`opt-level=s`,
LTO). Both installed Parakeet exports were present; these trials explicitly
used **v3 int8**, not v2. No TRACE/Ollama process or busy marker was present
before testing. The desktop and its other applications were left running.

### Repeated 30-second excerpt

Two retained streams, offset 60 seconds, duration 30 seconds each. Each replay
produced 18 live chunks (35.002 combined seconds including padding), and the
background loop used 14 offline chunks (34.242 seconds per loop). The first
round ran A01–A06; the repeat ran B06–B01 in reverse order. The same local
configuration was used for each A/B pair. Compilation and test workloads
finished before inference measurements.

Ranges below are the **two observed runs**, not confidence intervals. CPU
means occupied cores from process CPU-time deltas between the first and last
samples inside the live window; it is not the sum of the per-chunk wall times.
The live window was about 30.1 seconds. All runs completed without a safety
abort. The full anonymous aggregates are in
[`resource-contention-results.json`](resource-contention-results.json).

| Runs | Condition | Live median response, ms | Worst response, ms | Mean occupied cores | Peak process threads | Peak RSS, MiB | Completed re-pass audio, s |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A01/B01 | Solo, current pools | 64.7–65.0 | 163.8–165.0 | 0.237–0.253 | 48 | 746–747 | — |
| A02/B02 | Second engine idle, current pools | 61.3–65.3 | 154.2–166.1 | 0.207–0.234 | 90 | 1418–1420 | — |
| A03/B03 | Overlap, current pools | 69.9–72.8 | 183.4–185.3 | 4.536–4.587 | 90 | 1470 | 639.0–660.2 |
| A04/B04 | Overlap, shared 4 intra / 1 inter, spin on | 67.9–74.2 | 194.4–221.7 | 4.106–4.107 | 9 | 1457–1459 | 689.1–720.2 |
| A05/B05 | Overlap, shared 4 / 1, spin off | 73.1–75.3 | 191.7–204.8 | 2.490–2.535 | 9 | 1455–1457 | 660.2 |
| A06/B06 | Solo, shared 4 / 1, spin off | 59.8–60.7 | 165.2–173.1 | 0.147–0.148 | 9 | 741 | — |

The practical findings from these repeats:

1. **No substantial live stall was demonstrated.** Active overlap adds about
   6.5 ms to the mean of the two per-run live medians versus solo defaults.
   Worst observed response stays below 186 ms with current pools. This is much
   smaller than the live chunker's own seconds-long release delay. It does
   not prove that a device queue cannot overflow on a different workload.
2. **The second engine has a real memory cost even when paused.** Keeping it
   idle adds about 672 MiB to peak RSS and 42 process threads, but no measured
   steady CPU/latency penalty in these controls. A pause that keeps the engine
   allocated is therefore a CPU policy, not a way to recover its RAM.
3. **Shared non-spinning pools remove measurable CPU overhead.** Compared with
   current overlapping pools, mean CPU consumption falls from 4.561 to 2.512
   occupied cores: **44.9% less**, with approximately the same completed
   re-pass work and a slightly higher live median/worst response. This is a
   resource-efficiency improvement, not a demonstrated live-latency fix.
4. Holding the shared pool counts constant and turning spinning off reduces
   CPU by **38.8%** (4.106 to 2.512 cores), while completed background work
   falls by about **6.3%**. Spinning has a throughput trade-off. The entire
   default-to-shared difference cannot be assigned solely to spinning: that
   comparison also changes sharing and both pool sizes.
5. The process thread count really changes from 90 to 9 in the running
   executable. This confirms the environment API applies through the
   unmodified Parakeet constructor; it is not just an option that compiles.

### Longer excerpt and plumbing checks

The second real excerpt uses the same retained pair at offset 180 seconds,
duration 60 seconds: 32 live chunks (73.197 combined seconds), 19 offline
chunks (69.167 seconds per loop). Order was C03, C01, C02; one run per
condition, with the same model and warm-up procedure as above.

| Run | Condition | Live median / worst response, ms | Mean occupied cores | Peak threads | Peak RSS / private commit, MiB | Completed re-pass audio, s |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| C03 | Solo, current pools | 79.0 / 184.5 | 0.250 | 48 | 765 / 740 | — |
| C01 | Overlap, current pools | 92.8 / 217.2 | 4.526 | 90 | 1509 / 1497 | 1427.8 |
| C02 | Overlap, shared 4 / 1, spin off | 92.1 / 204.6 | 2.498 | 9 | 1494 / 1482 | 1407.7 |

The longer excerpt gives **44.8% less CPU**, a 0.7 ms lower live median and
1.4% less completed re-pass audio versus overlapping current pools. This
corroborates the resource-efficiency finding without establishing a universal
latency improvement. Available RAM stayed above 11 GiB in every speech run;
these were not low-memory trials.

The generated five-second fixture S01 completed with two live chunks and zero
nonempty results, as expected for a tone. It validates replay/metrics plumbing
only and is excluded from speech-performance comparisons.

Regenerate the aggregate artefact from raw local outputs with:

```powershell
node scripts/summarise-contention.mjs C:/local/contention/results > C:/local/contention/summary.json
node --test scripts/summarise-contention.test.mjs
```

Do not place local configurations or input hashes in the repository. The
private input map and full WAV hashes were retained locally for repeatability,
alongside the anonymous counter files. Neither recognised words nor source
audio were written to the result files or committed.

## Verification

All six repository gates passed:

| Gate | Result |
| --- | --- |
| `pnpm lint` | Passed; rerun after adding the scripts and aggregate JSON. |
| `pnpm check` | Passed. |
| `pnpm test` | 32 files, 368 tests passed. Existing React `act(...)` warnings were emitted. |
| `cargo fmt --all --check` | Passed. |
| `cargo clippy --all-targets -- -D warnings` | Passed (`--offline -j 4` also supplied). |
| `cargo test` | 405 tests passed (`--offline -j 4` also supplied). |

Additional checks: three example tests, one Node aggregation test, the
synthetic run and all 15 real-audio runs. The example tests cover bounds,
release-time/stream ordering, read-only seeking/downmixing and short-read
rejection. The aggregation test proves warm-up CPU and background work ending
after the live window do not enter its reported replay metrics. Deliberately
breaking the Rust bounds, ordering and seek made all three tests fail; counting
late background work made the Node assertion fail (`60 !== 20`). Restored
sources pass. These were intentional mutation checks, not unresolved failures.

Cancellation was tested before loading (exit 1, `cancel file present`) and
during overlapping generated inference (exit 124, JSON event
`{"event":"aborted","reason":"cancel file present"}`). The launcher reported
`Diagnostic stopped (exit 124)` as intended; its external timeout did not fire.
The hard-timeout and low-memory branches were not deliberately forced. Whole
source WAV SHA-256 hashes matched before/after all measurements. Every completed
speech run's stderr was empty.

The first release build in the fresh checkout failed with:

```text
error: proc macro panicked
   --> src\lib.rs:181:14
    |
181 |         .run(tauri::generate_context!())
    |              ^^^^^^^^^^^^^^^^^^^^^^^^^^
    |
    = help: message: The `frontendDist` configuration is set to `"../dist"` but this path doesn't exist

error: could not compile `trace` (lib) due to 1 previous error
```

Running `pnpm build` supplied the required frontend artefact; the release
diagnostic then built successfully. No app installation, release, model
installation, settings change or production-behaviour change was performed.

## Recommendation and limits

The smallest concrete candidate for the parent to evaluate is one ORT
environment initialisation **before the first speech model loads**, with
shared pools, inter-op count 1, intra-op count capped at 4 and spinning off.
The example provides the exact working API call. This requires promoting the
existing ORT dependency to an app dependency, not a dependency fork or upgrade.
Keep the lane, memory admission, model choice and journal behaviour unchanged.
This is a proposed production change, **not shipped by this PR**.

Four intra-op threads are the measured setting on this 8-core machine, not a
universal optimum. Before shipping, compare transcript content locally on the
same retained material and test a smaller-core machine; the harness deliberately
discards words and cannot prove text equivalence. A count policy must handle
machines with fewer available CPUs. The measured non-spinning configuration
slightly increases some live latencies and gives up some throughput versus
the spinning shared pool, in exchange for much lower CPU consumption.

There is no evidence here for automatically deferring every previous meeting's
notes or for selective below-normal re-pass priority. If real diagnostics on a
constrained machine subsequently demonstrate live backlog, pausing at chunk
boundaries is the next scheduling experiment, with its retained-memory cost
made explicit. Do not treat the current success on this desktop as evidence
that arbitrary concurrent work is safe.

Material limits:

- One machine, two excerpts from one retained session, one speech model,
  two repetitions of the short experiment and one of the longer experiment.
  No thermal/power isolation, forced memory pressure or control over other
  desktop applications. Reported ranges are descriptive.
- Steady-state replay starts after serial model loads and warm-ups. It does
  **not** measure starting a new live engine during an already active re-pass,
  cold boot/file-cache effects, devices, capture loss or UI responsiveness.
- No LLM was loaded or used. Ollama was not running; no service was started,
  model downloaded, competing generation requested or resident model evicted.
  Active summary generation, preload spikes and LLM RAM spill remain
  unmeasured. Memory headroom and lane ordering alone do not settle them.
- The exact tap queue is not exercised. `response_ms` measures live deadline
  backlog, not capture drops, and includes no journal/UI delivery time.
- No word-error rate, transcript equivalence or synthesis-quality claim is
  supported by these timing-only results.

## Scheduling and priority alternatives

These are design options, not implemented fixes or claimed measured gains:

| Option | What it would address | Cost / unresolved point |
| --- | --- | --- |
| Defer a re-pass before loading while capture is active | Avoids the second engine's memory and CPU cost entirely | Delays the previous meeting's final transcript and summary; a check only at job start misses a meeting starting mid-pass. |
| Pause between re-pass chunks while capture is active | Removes ongoing background inference; keeps accumulated segments until the existing atomic replacement at the end | Cannot interrupt the current ORT call; a loaded engine still consumes memory. Needs visible waiting and cancellable waits. |
| Pause only while live inference is busy | Lets a re-pass use the gaps between utterances | A long re-pass chunk can run across the next live deadline. Requires coordination beyond the current background lane, and has not been benchmarked. |
| Lower the `trace-repass` caller thread's priority | Gives its caller less scheduling preference | Does not configure the existing ORT workers. It must not be represented as lowering the whole re-pass pool. |
| Use ORT's global thread manager for below-normal workers | Can lower worker priority without forking the dependency | The workers are shared with live inference; not selective re-pass priority. Priority has not been measured here. |
| Separate re-pass process with bounded pools / process priority | Makes resource policy and hard cancellation independent | More IPC, lifecycle, model loading and failure handling than a first intervention needs. |
| Gate summary generation while capture is active | Avoids active LLM competition with the next live engine | Separate from ASR contention. Memory admission already exists but does not guarantee CPU headroom. No active LLM trial was run. |

A pause gate must use **capture activity**, not `busy::is_busy()`: the re-pass
itself holds `Busy`, so waiting for that flag to clear would wait on its own
completion. It must preserve Stop and journal replay semantics and avoid
holding the capture manager's mutex during a wait. Nothing in this research
justifies changing retention, deleting evidence, replacing a transcript
part-way, or silently abandoning a queued summary.
