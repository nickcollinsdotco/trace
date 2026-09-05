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
