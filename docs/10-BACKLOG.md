# Backlog

Ideas captured with enough technical detail to act on later, and an honest
note on what is actually feasible.

## Uncertainty affordances in the transcript

**Idea.** Mark words the model is unsure about with a squiggly underline, like
a spellcheck. Clicking one offers: replay that word's audio, pick from likely
alternatives, or type a correction.

**Why it fits.** `docs/00-README.md` requires that AI must not present
uncertain guesses as established fact. Right now a mistranscription is
indistinguishable from a correct one, which is precisely the failure that rule
exists to prevent.

**Motivating case.** Repeatedly saying "bus wanker" transcribed as "a swanker";
"Big Clanger" only landed on the second attempt.

**Why it happens.** Parakeet is a subword model with a very small vocabulary —
8,193 tokens covering 25 languages, of which 262 are language/special tokens.
Neither "wanker" nor "bus" nor "clang" exists as a token; words are assembled
from fragments like `ank` and `ker`. With no surrounding context, "a swanker"
scores higher than "bus wanker". The English-only v2 model is *not* the answer:
its vocabulary is 1,025 tokens, smaller still.

### Feasibility, by part

| Part | Status |
|---|---|
| **Replay a word's audio** | Feasible now. Segment timestamps plus the session WAV are all that is needed — as long as audio retention is on. |
| **Per-word confidence** | Computable, not exposed. `transcribe-rs` `onnx/parakeet/mod.rs` takes `max_by` over `vocab_logits`, then discards the score with `.map(\|(idx, _)\| idx)`. A softmax over the same slice gives the confidence. |
| **Alternative words** | Computable, not exposed. Top-k over the same `vocab_logits`, though results are *subword* pieces and would need reassembling into words before display. |
| **Inline correction** | Feasible now, but needs a decision on where a correction is stored, given the note body is deliberately never re-parsed (`store/markdown.rs`). |

Confidence and alternatives both need `transcribe-rs` to surface data it
already computes — an upstream PR, or a vendored decoder loop. Worth doing
upstream: the crate's other engines would benefit equally.

**Watch out for:** subword confidence is per-token, not per-word. A word
assembled from four fragments has four scores that must be combined before
anything is underlined, or the underlining will land mid-word.

## UI and theme prototyping

Explore alternative layouts and visual treatments before committing. Pairs
with the full visual pass — terminal/ASCII aesthetic, easter eggs, the
Fragment Mono direction.

The design system already supports this: `src/design/tokens.css` holds every
colour, type and spacing decision, and capture-vs-reading mode is expressed as
two token overrides rather than two stylesheets. A theme is a token set.

## Terminal-aesthetic ideas parked by the visual triage

From `docs/12-VISUAL-TRIAGE.md`, bucket 4 and the unbuilt half of bucket 3.
Each is a real project rather than a theme, and each needs costing on its own.

- **Bracketed keybinding chips and a persistent footer bar** — `[?] HELP`,
  `[^+L] CLEAR`. A new component plus a layout change, not a token switch.
  Pairs naturally with M7's shortcuts and is most of the way to a command
  palette, so it should probably land there rather than in the visual pass.
- **Multi-pane note screen** — notes, transcript and generated output as three
  focusable panels (lazygit / btop). Layout, so note screen only, and only if
  the single-column read is found wanting.
- **Markdown shown as source** — Pierre Computer Company renders `##` and
  `[text](url)` intact. Worth one prototype: TRACE notes really are Markdown
  files, so showing it is honest rather than decorative.
- **ASCII illustration** — the KNNY posters and the Video Walkman piece. Needs
  an artist or a generator. This is where a boot screen or an easter egg would
  live, not where a theme would.
- **Braille / dither charting** — btop-style plots need a charting primitive
  TRACE does not have and, today, has no data to put in it.
- **Pixel and bitmap display faces** — HOLOMAP, Fairlight, the fitness
  mockups. A font decision with real legibility consequences for a tool people
  read prose in; not to be taken lightly on a whim.

**Ruled out, on the record:** the Tron-style cyan CRT chrome. It is precisely
the "fake terminal cosplay" `docs/05-DESIGN-DIRECTION.md` rules out, and the
ruling is written down here so it is a decision rather than a silent omission.

## Command palette (Cmd+K)

Raised 2026-09-05 as "a future feature addition", and it already has a home:
it is **M7** in `docs/11-PLAN.md`, alongside search and keyboard shortcuts.

Deliberately not built during the visual phase. A command palette is among
the most theme-expressive components in any app — termcn's own shot of one is
in the reference set — so building it before the visual language is settled
means building it twice. That is the stated reason M7 sits after the theme
decision rather than before it.

What already exists that it will want:

- `themeForKey` in `src/design/theme.ts` — the typing-target guard a global
  hotkey needs, already isolated and tested
- the SQLite FTS5 index (M7) for anything that searches notes
- the fill and framing switches, so a palette inherits the chosen look rather
  than needing its own styling pass

## ~~Chunk boundaries split sentences~~ — fixed 2026-09-06

**Observed 2026-09-05**, first real meeting. The speaker said "this is where
designers never stop learning" as one sentence. TRACE split it mid-sentence
and produced:

```
00:21  THEM   My name is Ridd, and this is where designers know.
00:24  THEM   Never stop learning.
```

"know" was never spoken. Handed a fragment that does not end at a sentence
boundary, Parakeet terminates it with something plausible.

This is *not* the vocabulary problem above. It is a chunking problem, and the
invented word is the symptom.

Two candidates in `transcribe/chunker.rs`, both unverified:

- `silence_frames: 17` (~510 ms) closes a chunk. A mid-sentence breath can
  exceed that.
- `energy_threshold: 0.012` was tuned only against the M1 recordings. If a
  voice trails off below it, real speech counts as silence, so a short pause
  plus quiet delivery reaches 510 ms and the chunk closes early.

**Blocked on evidence, now unblocked.** The audio was deleted at finalisation,
so there was nothing to test a fix against. The keep-audio setting exists for
exactly this. The order is: record a clip that reproduces it, keep the audio,
make it a fixture, then tune — so the threshold stops being folklore.

### What it actually was

Measured with `cargo run --release --example chunk_check` against the kept
audio. The recording's speech sat at **0.005–0.029 RMS** and the threshold was
**0.012** — so roughly half the speech was classified as silence and never
sent to the model. The first five seconds of the recording were simply
missing from the note, with nothing anywhere reporting it.

Chunking on that recording: **13 chunks**, many under a second. Parakeet given
half-second fragments produced "2", "Mm.", "Line." — words nobody said.

The threshold is now derived per recording from two points on its own energy
distribution: a low percentile for the noise floor, a high one for the speech
level, threshold a quarter of the way between. An earlier attempt used a
fixed multiple of the floor alone; a unit test caught that it assumes the
silence-to-speech gap is always the same size, and mutes speech when the gap
is narrow. Same recording now yields **5 chunks** of 8.1s, 4.5s, 10.4s, 4.8s,
0.5s, starting at 1.03s where the speech starts.

The live pass cannot measure a floor before audio arrives, so it errs
sensitive for the first two seconds and calibrates once it has enough. The
two errors are not symmetric: too sensitive wastes a little inference, too
deaf deletes words permanently.

Silence needed to close a chunk went from ~510 ms to ~810 ms, since 510 ms
split at an ordinary breath.

### Still worth doing

**Overlapping chunks**, so a split has context on both sides. Splits will
sometimes land badly whatever the threshold, and overlap is the structural
answer rather than a better-tuned guess.

## transcribe.cpp — spiked 2026-09-06, **not adopted**

Handy v0.9.0 replaced `transcribe-rs` with
[`transcribe.cpp`](https://github.com/handy-computer/transcribe.cpp) as its
engine. TRACE uses `transcribe-rs`, so this is the foundation of our
transcription stack moving underneath us. Worth a real look; the conclusion
is *not yet*.

**What it is.** MIT, C/C++17 on GGML, 16 model families and 60+ variants,
official Rust bindings published as `transcribe-cpp` (0.2.3). Models are
`.gguf`. Backends: CUDA, Vulkan, Metal, ROCm, OpenMP.

**`transcribe-rs` is not deprecated** — no archive notice, still taking
issues and PRs. So there is no forced migration, only an opportunity.

### What we would gain

| | |
|---|---|
| **Native streaming** | The big one. `feed()` plus `stream.text().committed` — a *stable prefix* with a volatile tail. TRACE's entire live-chunking apparatus exists only because Parakeet is batch-only: the streaming chunker, the VAD threshold work, the 4-second ceiling, and the processing indicator that exists to explain the resulting lag. Streaming would make most of that unnecessary rather than better-tuned. |
| **GPU** | We run on CPU today. A `cuda` feature exists |
| **Model choice** | Qwen3-ASR, Cohere Transcribe, Canary. Might handle proper nouns better than Parakeet's 8,193-token vocabulary — the `Vercel → Verzelle` problem |

### What it would cost

- **A C++ toolchain and CMake in the build.** `transcribe-cpp-sys` compiles
  the native library from source. That lands on CI and on anyone cloning the
  repo. The original audit chose Rust + ONNX specifically to avoid a
  packaging tax; CMake is far lighter than Voicebox's PyTorch and PyInstaller,
  but it is not nothing.
- **Bindings at 0.2.0**, self-described as "in development". Handy's own
  release notes say "there likely will be issues".
- **Model re-download** — GGUF is a different format, so every user fetches
  ~700 MB again.
- **`parakeet-unified-en-0.6b` is English only.** It is the sole
  streaming-capable Parakeet. We would trade 25 languages for streaming.

### Verdict, after building it properly

**The spike's headline was wrong, and the error was mine.** The first
comparison ran transcribe.cpp against a transcript produced *before* the
adaptive-VAD fix landed the same day — new engine against our broken
configuration. Rerun against the fixed one, through TRACE's own pipeline,
both engines on the same file:

| | Words | Segments | Time |
|---|---|---|---|
| ONNX (shipping, post-VAD-fix) | 38 | **5, punctuated, per-sentence timings** | 1.34 s |
| transcribe.cpp batch | 38 | **1, unpunctuated** | 2.01 s |

Identical words. The shipping engine is better structured and faster.

Punctuation is not a settings problem: asking for it makes the library say so
itself — `parakeet unified-en-0.6b does not support pnc control`. Requesting
word-level timestamps still returned a single segment. TRACE cites segments
as evidence, so segment boundaries are load-bearing, not cosmetic.

So for the offline pass the candidate is **strictly worse**: no punctuation,
no segmentation, slower, 731 MB against 456 MB, and English-only.

The dependency was added to the crate, measured, and then removed. Carrying a
C++ and CMake requirement for every build and every contributor, to run code
nothing selects, is a cost with nothing on the other side of it.

### What would still justify revisiting

1. **Live latency, if it actually bothers anyone in real use.** Native
   streaming remains real and remains the one thing the current stack cannot
   do. But the streaming model produces unpunctuated, unsegmented text —
   acceptable for a provisional live transcript, useless for the final pass —
   so it would mean two models and roughly 1.2 GB, not one.
2. **The model picker.** If users are to choose models the way Handy allows,
   transcribe.cpp is the only realistic route: 16 families through one engine
   against our one. That is a product decision, not a quality one.

Restoring the spike is one `cargo add transcribe-cpp` plus the engine module,
and the API notes below are enough to rewrite it in an hour.

### Spike result

Built and measured, not guessed. Isolated cargo project, `transcribe-cpp`
0.2.3, `parakeet-unified-en-0.6b` Q8_0, run against **the exact recording
TRACE got wrong**.

**It builds.** 1m37s from cold in an isolated project, 2m03s inside the real
crate, using the CMake, `cl.exe` and ninja that ship with VS Build Tools.
CMake is not on PATH by default and had to be added — a real friction point
for contributors, though GitHub's windows runners have it.

**API notes, so a future attempt starts further along.** `Model::load(path)`
→ `model.session()` → `session.run(&pcm_16k_mono_f32, &RunOptions)`.
Streaming is `session.stream(&RunOptions, &StreamOptions)` then `feed()`,
with `stream.text().committed` as the stable prefix. Segments carry `t0_ms`
and `t1_ms`, not `start_ms`/`end_ms`. `finalize()` returns a `StreamUpdate`,
not the text — read the text from `stream.text()` afterwards.

**The output, compared against the pre-fix transcript** — an unfair
comparison, corrected above, kept here as the record of how the wrong
conclusion was reached:

```
current (Parakeet TDT v3, ONNX):
  "This is" / "Hello, can you hear this or not?" / "I was saying." /
  "This is where designers never stop learning." / "Never stop."

transcribe.cpp (parakeet-unified-en-0.6b, streaming):
  "This is where designers keep on learning. This is where designers never
   stop learning. Hello, can you hear this or not? I was saying this is where
   designers never stop learning. This is where designers never stop
   learning."
```

Complete sentences with punctuation, no truncation, and none of the invented
fragments — no "2", no "Mm.", no "Line.", no "know." Content the current
pipeline dropped is present.

**Speed**, all on CPU:

| | |
|---|---|
| Model load | 0.65 s |
| Batch | 1.80 s for 35.3 s of audio — 19.6x realtime |
| Streaming | 11.3 s wall for 35.3 s of audio — roughly 3x realtime, so ample headroom |

**Latency measured conservatively.** Only `committed` text was printed — the
stable prefix — which ran 2–4 s behind. `StreamText` also carries a volatile
tail, and a real UI would show both, so the perceived lag is better than
these figures. Worth measuring properly before promising anything.

### The order to do things in

1. **A glossary first.** Handy ships "Custom Words" and it is
   engine-independent. It fixes the failure actually observed — proper nouns —
   and costs a fraction of a migration.
2. **Try `ort-directml` before any of this.** It is a feature flag on the
   current stack and buys GPU acceleration with none of the C++ build cost.
   `docs/11-PLAN.md` already claims DirectML is in use; it is not.
3. ~~Revisit when the bindings reach 0.3.~~ **Superseded by the spike above.**
   The quality difference on a real failing recording is large enough that
   waiting for a version number is the wrong call. `Transcriber` in
   `transcribe/mod.rs` is a thin seam, so the code swap is contained; the
   build and packaging change is the real work.

### Caveats worth holding on to

- **One 35-second sample.** It is the most informative one available — the
  exact case that failed — but it is one sample.
- **CUDA is a heavier dependency than CMake.** The `cuda` feature needs the
  CUDA toolkit at build time and would break the build for anyone without it.
  Default to CPU; treat GPU as opt-in, if at all. 19.6x realtime on CPU is
  already fast enough that this is not urgent.
- **731 MB against the current 456 MB**, and English-only.

### Also worth stealing, independent of any engine

From Handy's settings: **remove filler words** as a toggle, and **VAD on/off**
so raw audio can be recorded when someone is debugging. Both are small and
neither depends on transcribe.cpp.

## Library and meeting management

Raised 2026-09-06 after real use. **Discard, rename and delete are built**;
the rest is recorded here rather than guessed at.

### Done

- **Discard a recording in progress.** Starting a meeting used to commit you
  to it — the only exit wrote a note, re-transcribed and ran synthesis.
- **Rename a note**, moving the file so the filename keeps matching the title.
- **Delete a note**, taking its session with it.

### Not built, in the order I would do them

1. **Pause and resume a recording.** The hard part is not the button, it is
   the timeline: a paused stretch has to become a gap rather than a splice,
   or every timestamp after it is wrong. The loopback path already pads gaps
   with wall-clock time, so the machinery exists — but silence that is
   *absence* and silence that is *nobody talking* must stay distinguishable,
   because the second is evidence and the first is not.
2. **Search.** Already M7 in `docs/11-PLAN.md`, over a rebuildable SQLite
   FTS5 index. It is the feature that makes a library of a hundred meetings
   usable at all, and everything else here is cosmetic beside it.
3. **Tags.** `Meeting.tags` already exists in the data model and in
   frontmatter, and nothing writes to it. Cheap once search exists, and much
   less useful before — a tag you cannot search for is decoration.
4. **Participants.** Also already in the model, also unwritten. Note that
   speaker attribution comes from audio topology, so TRACE knows "you" and
   "them" but not *who* them is; filling this in means either asking the user
   or the voice-embedding work in Phase 3.
5. **Folders and grouping.** Notes are already nested `YYYY/MM` on disk. A
   project or client grouping is a second axis, and worth resisting until
   search exists — folders are what people reach for when they cannot search,
   and building both means maintaining both forever.
6. **Hiding or archiving old meetings.** The library groups by date already.
   Worth waiting to see whether this is a real problem at a hundred meetings
   or an imagined one at ten.
