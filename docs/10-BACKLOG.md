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
