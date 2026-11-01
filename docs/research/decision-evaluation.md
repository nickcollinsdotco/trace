# Decision versus discussion: synthetic evaluation

This is a repeatable synthetic baseline, **not validation on real meetings**.
No private transcript, journal, recording or note was used. Production behaviour
and prompts are unchanged; this research does not require a version bump.

## Protocol fixed before inference

Baseline: `5db9fdcfa4f4edbdec4e50d5bce1870bff6a5143` (v0.41.0), prepared checkout
`C:\Users\nfbco\Documents\GITHUB\TRACE\t3-a34fa253`, branch
`t3/decision-synthesis-evaluation`. The corpus and this protocol are committed
before any inference. `decision-evaluation/corpus.json` contains 8 development
and 6 held-out cases. Its `repeat` flags select five cases for exactly one
additional run, including a positive, a negative and both cross-window reversal
forms. The split, labels and repeats will not change in response to model output.
No prompt tuning will be performed on either split in this experiment.

Every case defines expected meaning, acceptable supporting evidence sets,
forbidden interpretations and relevant actions/questions. Evidence alternatives
are examples of sufficient support, not an exact-string grading algorithm:
additional relevant citations are acceptable; an irrelevant or contradictory
citation needs manual judgement. The optional withdrawal decision in
`held_cross_reopen` is explicitly allowed before inference. A settled conditional
policy counts as a decision only with its condition and fallback intact; a
tentative conditional proposal does not.

Manual rubric, applied to raw per-window extraction and final validated output:

1. Read every substantive source turn and typed note in order. Determine whether
   the final choice is closed, still open, superseded or conditional.
2. For each decision, compare its **meaning**, scope, polarity and conditions to
   the label. A fabricated decision is a false positive even with valid ids.
   A true choice missing from decisions is a false negative. Historical wording
   is acceptable only if it clearly marks an earlier choice as superseded.
3. Resolve each cited id and read the cited words. Check whether those words
   actually support closure, rather than merely mentioning the topic. Separate
   unsupported citation meaning from a nonexistent citation id. A bare agreement
   may need the preceding proposal to identify what was agreed.
4. Check that action-only cases retain real commitments as actions and that
   unresolved discussion remains visibly unresolved. Record uncertainty and
   secondary classification defects separately from decision errors.
5. Compare repeat runs for changes in meaning/citations, not just counts. This
   small convenience sample supports case findings, not a population accuracy
   estimate. A single researcher (the coding agent) performs this assessment;
   there is no independent human adjudicator or inter-rater agreement statistic.

Mechanical checks are limited to corpus integrity, actual window boundaries,
counts, id resolution, prompt visibility, validation drops, request errors and
timings. There is deliberately **no automatic semantic accuracy score**.

## Production path and capture boundary

`src-tauri/examples/decision_eval.rs` constructs real `Meeting` and `Segment`
values, preserving microphone/system source and stable ids. It calls production
`synthesis::generate` with a recording wrapper around `OllamaProvider`, hence
uses the actual prompt, schema, windows, exact-text merge, combine and validation.
Labels never enter the model prompt. Three cases insert explicitly synthetic
inventory padding to fill the first production window to 9,950 bytes. Full
expanded meetings and prompts are saved; this is an artificial boundary stress
test, not a realistic long conversation.

The wrapper records **parsed raw provider outputs before validation**, including
combine results, and the final validated meeting. It does not capture raw HTTP
bytes or hidden thinking. A malformed response may be retried internally by the
production provider; terminal diagnostics preserve failures, token/runtime stats
and grammar fallbacks, but cannot reconstruct an entire malformed response.
This limitation must not be mistaken for an absence of model failures.

The production combine pass receives summaries and key points, **not decisions**.
Decisions are unioned with case-insensitive exact-text deduplication. Validation
checks id existence across the whole meeting, not semantic entailment or whether
an id appeared in the extracting window. The evaluator audits prompt visibility
separately. The experiment will determine whether these limits matter in the
selected cases; the source alone does not establish observed model behaviour.

## Reproduction and safety

From the checkout root, install the pinned dependencies and build frontend
assets (required by Tauri's `generate_context!`). Then in `src-tauri`:

```powershell
pnpm install --offline --frozen-lockfile
pnpm build
cd src-tauri
cargo test --example decision_eval
cargo run --example decision_eval -- --check
cargo run --example decision_eval -- qwen3:8b ../docs/research/decision-evaluation/run-01
```

The output directory must not exist. The compiled-in corpus is intentional:
rebuild after changing it. Use an already installed model and a local Ollama
service listening on `127.0.0.1:11434`. The evaluator refuses any initially
loaded model, any running `trace.exe`, and insufficient production memory
headroom; it repeats process and memory checks before each call. This conservative
process guard avoids reading private sessions to guess whether TRACE is busy.
It cannot rule out unrelated clients starting work in between checks.

Calls are sequential. Each provider call has a 180-second total deadline,
including its internal retry, enforced through production `stop_when` socket
cancellation. To stop during inference, create an empty `CANCEL` file in the
output directory. A stopped run saves the current result and exits. The native
600-second idle timeout remains but is bounded by this deadline. No model pull,
unload, user setting write or service management occurs inside the evaluator.
The operator must inspect processes, GPU/RAM and local busy state first and
clean up only a service/process they started. Existing user services are never
stopped. CLI diagnostics go to the terminal, not the user's TRACE log.

Selected settings: `think: true` (explicitly enables the current thinking choice;
production otherwise leaves it to model default), production temperature `0.2`,
context `8192`, output budget `3072`; no seed sent. The selected model/tag/digest,
Ollama version, safety snapshot, source SHA, exact corpus, system prompts and
schemas are recorded in `manifest.json`. Retention follows the existing
settings-derived production policy, with no override.

## Results

Pending the pre-registered run. Failures and blocked evidence will be recorded
here even if inference cannot safely complete.
