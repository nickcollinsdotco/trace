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

The pipeline did **not reliably separate current decisions from other material**
in this synthetic run. It correctly left decisions empty for several hard
negatives, but retained a superseded Monday release alongside Wednesday, both
within one window and across windows. These are observed final-output defects,
not merely risks inferred from the source. Citation validation cannot repair
them: their ids exist and their cited words really were said earlier.

The evaluated model was installed `qwen3:8b`, Q4_K_M, digest
`500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41`, on Ollama
`0.40.12`, with thinking observed in the diagnostics. This is TRACE's supported
interim model, **not an evaluation of the preferred 14B** or a claim about the
user's selected default. The initial machine probe found no TRACE/Ollama process
or listening service, about 11.3 GiB free physical RAM and 10,540 MiB free on an
RTX 5070 Ti. I started only the installed Ollama service on loopback, with no
startup-setting changes. Immediately before inference the production memory
check reported 15.5 GiB RAM and 10.5 GiB GPU available and estimated 6.2 GiB for
the 8B. The loaded footprint was subsequently measured at 5.9 GiB, all on GPU.
The smaller model was deliberately chosen to leave room for other applications.

Protocol/corpus were first committed at `d7ce899`; formatting and minimum-Rust
compatibility corrections were committed before inference at
`a18f2a700249da69a2ab6fc0b208dad8e5b3a35a`. Formatted corpus SHA-256:
`6b87eaabfa0ab5c2fea6cead0da08569c559a865bfd4e9439d56d53c49ef9bf6`.
There were no subsequent changes to examples, labels, model settings or prompts
in response to the held-out results.

The run started at 03:31:40 UTC on 2026-11-01. It completed 19 case executions
(14 first runs plus five repeats) in 296.94 seconds of summed case wall time.
There were 29 provider calls: 24 extraction and five combine calls. Production
made 31 model attempts because two extraction calls retried internally. Eighteen
case executions produced validated output; one returned an error. Three attempts
hit the 3,072-token output cap. The largest recorded prompt was 2,661 tokens;
no provider context-overflow error, grammar fallback, transport error or deadline
cancellation occurred. Thinking was reported for every completed attempt. First
case wall time included a 13.4-second cold model load. This is a debug diagnostic
binary, not an installed-app performance benchmark.

Mechanical results: **zero nonexistent decision citations, zero decision
citations absent from their extracting prompt, and zero final validation drops**
across the available parsed outputs. These zeros do not cover the unparseable
attempts and do not mean semantic correctness. The stale decisions and category
errors survived validation intact. No expected final choice was missing among
the successfully parsed positive cases; the typed-note failure is excluded from
that semantic observation, not counted as a pass.

All expanded synthetic inputs, parsed outputs, errors, settings and per-call
timings are in [run-01](decision-evaluation/run-01); token/runtime diagnostics
are in [diagnostics.txt](decision-evaluation/run-01/diagnostics.txt), and the
mechanical totals in [mechanical-summary.json](decision-evaluation/run-01/mechanical-summary.json).
The absolute local output directory is
`C:\Users\nfbco\Documents\GITHUB\TRACE\t3-a34fa253\docs\research\decision-evaluation\run-01`.
These JSON files were pretty-formatted after capture; output strings and values
were not edited. The evaluator's successful exit means the bounded run finished,
not that every case succeeded or met its semantic label.

The owned Ollama PID was 59428, launched at 04:25:40 local time and stopped at
04:37:07 after inference. The immediate process enumeration still saw the
exiting process; a subsequent check confirmed zero Ollama processes and zero
listeners on 11434. [cleanup.json](decision-evaluation/run-01/cleanup.json)
retains both observations. No existing user service/model was stopped, no other
app was closed, and no service startup policy or user setting was changed.

### Manual case assessment

These are judgements against the pre-registered meanings, not scores computed
from keywords or item counts. `run-01/<case>-1.json` contains the full first
result; suffix `-2` is the preselected repeat. Each includes source turns,
expected interpretation, raw parsed window/combine output and final validation.

| Case | Assessment of first run | Evidence and qualification |
|---|---|---|
| `dev_closed` | Correct positive | Thursday selected, supported by `sys_0001`. |
| `dev_pricing_discussion` | Correct empty decisions; secondary action defect | Unassigned “We should start discussion…” became an action, despite no personal commitment. Pricing remained open. |
| `dev_action_only` | Category false positive | “Nothing is selected today” was filed as a decision, citing `mic_0001`. This is a true statement in the wrong category, not an invented vendor selection. Mira's research survived as an action, but owner was null and wording retained “I”. |
| `dev_tentative_objection` | Correct negative | No host selection or definitive rejection; backup policy/regions remained open. |
| `dev_conditional` | Correct negative | Friday migration remained a proposal, load test became an action, eventual migration remained open. |
| `dev_rejection` | Correct positive, duplicated | Two paraphrases of the same rejection, supported separately by `sys_0001` and `mic_0002`. Extra count is redundancy, not a second semantic decision. |
| `dev_reversal` | Stale-decision false positive | “Launch on Monday” survived beside “Launch on Wednesday”. The summary understood the reversal, but Monday was not marked historical in decisions. |
| `dev_cross_reversal` | Stale-decision false positive | First-window “Monday… final choice” survived alongside the second-window cancellation/move to Wednesday. The final summary got the chronology right. “Confirmed Wednesday…” was also incorrectly classified as an action. |
| `held_decide_later` | Correct empty decisions after internal retry; secondary action defect | Future pricing workshop was not a decision, but the unassigned suggestion became an action. First attempt used the entire output budget before the retry returned parseable output. |
| `held_misleading_notes` | Correct negative | Neither heading, question-shaped notes nor after-meeting preference became a decision. The model retained open questions. Whether “to discuss” warrants the key point's “under discussion” is a smaller temporal ambiguity. |
| `held_conditional_policy` | Correct conditional meaning; partial evidence coverage | Condition and fallback intact; no invented security approval. Decision cited only `mic_0000`, omitting the preregistered confirming `sys_0001`. The first line itself declares a policy, so this is a moderate-confidence evidence-coverage concern, not an invented outcome or a false negative. |
| `held_typed_decision` | Request failure, not semantically scorable | Both attempts exhausted 3,072 output tokens. No raw parsed or final output exists; this cannot count as a successful empty decision list. It failed to deliver the expected Cedar decision, but semantic false-negative attribution is not possible. |
| `held_cross_closure` | Correct final choice; stale open question | West selected with `sys_0001`; first-window proposal was not promoted into decisions. However, the earlier pending-inspection question survived after closure. The summary's “temporary decision” wording also overstated the original proposal. |
| `held_cross_reopen` | Stale-decision false positive | “Swift… choice is closed” survived alongside explicit withdrawal. The cancellation-only item is allowed by the preregistered rubric; the stale Swift selection is not. Summary correctly described withdrawal and research remained an action. |

### Repeats and ancillary observations

The five repeats kept the same main decision interpretations: Thursday remained
correct, both pricing-discussion cases retained empty decisions, and both
cross-window reversal forms retained obsolete selections. This is only two
samples of each, not evidence of deterministic or general behaviour.

There was meaningful variation outside that main judgement. `held_decide_later`
lost its unassigned action on the second run and returned without a retry
(42.06 seconds first run, 6.98 seconds second). `dev_cross_reversal` changed from
two decisions plus a spurious confirmation action to three decisions and no
actions; the obsolete Monday choice remained. `held_cross_reopen` changed from
a research action plus open question to an action combining research with future
selection, with no separate open question. Its second summary also attributed
withdrawing the offer to the meeting rather than Swift, an additional attribution
error. These changes are why counts alone would misdescribe quality.

All five combine responses supplied out-of-range key-point indices: four calls
had no input key points at all; the last had only the inventory point at index
zero but also returned indices 1 and 2. The production path ignored these
returned key points because the existing list was below its reduction threshold.
They therefore did not appear as new final key points or validation drops. The
raw combine responses remain in the artefacts. One repeat summary leaked
“point 1”/“point 2” references; the summary is not citation-validated. This is a
separate combine-quality observation, not counted as a decision false positive.

### Candidate follow-up, not implemented

1. Prioritise a decision reconciliation design that can see earlier decisions,
   later reversals and their original evidence. The existing summary/key-point
   combine pass lacks these inputs and never rewrites decisions. Preserve
   supersession explicitly or display only still-effective choices; do not
   infer “latest wins” from dates or keywords alone.
2. On development data, compare an explicit final-state rule with the baseline:
   revoked choices are not current decisions; stating that nothing was chosen
   is an open state; confirming a choice is not an assigned task. No prompt
   variant was tested here, and this report provides no evidence that these
   words alone would fix the failures.
3. Preserve agreed conditional policies without promoting tentative proposals.
   Ask for evidence supporting both the chosen policy and closure where separate
   turns establish them. Treat typed questions/headings as typed evidence, not
   necessarily agreements. The held-out cases are now exposed and should become
   regression examples, with a **new** untouched holdout for future comparisons.
4. Add deterministic data-flow regressions for a cited Monday choice followed by
   an explicit cancellation, and for a withdrawn supplier with no replacement.
   Add semantic review cases for action-only output, conditional-policy evidence,
   rejection duplication and the notes-only naming outcome. Stub tests can prove
   handling of supplied outputs; they cannot prove model semantic competence.
5. Investigate output-budget exhaustion separately, keeping thinking enabled
   for any controlled baseline. Do not raise budgets or change production
   defaults on these few examples. Capture malformed wire output through a
   deliberately designed diagnostic tap if that investigation needs it; the
   present wrapper cannot reconstruct it.

### Limits

All content is invented, clean English with explicit verbal cues and clean
source attribution. There is no ASR noise, real conversational overlap, audio,
real meeting replay, realistic speaker ambiguity, long substantive context or
installed-app UI test. Inventory padding is especially artificial. The small
non-random corpus and one local model/digest are insufficient to estimate real
meeting error rates. The same agent wrote the labels and judged results; another
reviewer should adjudicate the stated ambiguities. No held-out failure was used
to tune a prompt. The unresolved real-conversation evaluation remains open.

### Checks

All six commands were run separately. Final results: `pnpm lint` passed,
`pnpm check` passed, `pnpm test` passed (368 tests in 32 files), Rust formatting
passed, clippy with `-D warnings` passed, `cargo test` passed (405 tests).
Frontend build also passed to supply Tauri assets; this is not visual UI testing.
The three focused example tests passed. Mutation checks independently shortened
the boundary filler, accepted a nonexistent expected citation, and changed
all-citations resolution to any-citation resolution: each corresponding test
failed, then all passed after restoration.

Full gate outputs are in [decision-evaluation/checks](decision-evaluation/checks).
Initial failures are retained there too: Biome required corpus JSON formatting;
clippy rejected two `is_none_or` calls because the repository MSRV is 1.77.2 and
that API arrived in 1.82. Both were fixed before inference. Existing React
`act(...)` warnings appeared in the passing frontend tests. No app source,
settings, version, changelog, session data or installed copy was changed.
