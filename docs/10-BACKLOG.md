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

## The scope, a second visit — ideas from 2026-10-01

The live scope (Stage 6, `docs/13`) is liked but wants refining. Four ideas
from the user, to design together rather than build piecemeal:

1. **Beside the meters, not above the notes.** The user's mockup (teletext
   theme) puts it in the Signal section: MIC and SYSTEM as segmented bars
   with their dB on the left, and on the right a graticule — a squared grid
   in the theme's line colour — with a single trace rolling across it. That
   trace reads as loudness over the last minute or so, not a waveform: the
   meters say *now*, the trace says *lately*. It would free the space the
   strip takes above the notes.
2. **Large ASCII waveforms in the background.** Behind the panels on box and
   card themes (the "behind" placement the screen effects already have), or
   faded far back on rule themes. An Appearance control for how much, and
   off.
3. **Quiet activity while the app is open, not only while recording.**
   Subtle, always there, because early on nobody spends long in the app and
   the life should be visible at once. Never real audio outside a meeting —
   that would feel like listening, and Q30 rules it out: synthetic, or drawn
   from past meetings' stored envelopes.
4. **WE ARE LIVE, unmistakably but not annoyingly.** Something across the
   whole window while recording, visible from any page: a coloured edge or
   frame, a tinted status bar, a slow pattern. It should be readable from
   across a room and still be calm to work beside for an hour. Pairs with
   the mini window (Stage 7), which carries the same signal when the main
   window is not in view.

Rules carried over: nothing changes a control's size; motion respects
reduced motion; anything ambient has an Appearance control and an off.

5. **The xy mode reads as a scribble.** Even on the gallery's synthetic
   voices it is a flat band of jagged loops in the strip, which says little
   about the meeting. Judge it on real audio first; then either replace it
   or add something more traditional beside it: a classic line waveform, or
   a spectrograph — a scrolling waterfall of the spectrum over time, which
   shows speech as recognisable striped shapes and the two voices taking
   turns.

## The mini window's width — parked 2026-10-01

The mini window widens to fit its content (Stage 7a): a theme in capitals
or a wide typeface would otherwise wrap a line inside its 56px bar. But
people pin it in a corner, and a bar that changes width as it moves from
idle to recording to saved — or as the menu or details open — can look off
there. The idea to try: one width per theme, set by that theme's widest
state, so the bar stays the same size whatever it is showing. Worth
measuring every state in every theme first (the gallery has them all) and
seeing how far apart the widths really are.

## Hover and press motion — parked 2026-10-01

Asked for in the design upgrades: something better than the 0.97 push-in,
and hovers with character. A first cut was built and dropped (PR #18,
branch `archive/stage-5a-motion` on origin, kept for reference): a scramble that redrew labels
through block characters on hover, a flash and a glyph burst on press for
Retro, and an ink ripple for Modern.

**Why it was dropped.** The scramble broke fields and buttons. It pinned a
label's width while it ran so a proportional font could not jitter, but
controls whose width follows their content resized around the pin. And the
whole set was too much: motion on every control, every time, is noise.

**What to do instead — a prototype pass, not a build.** Try candidates on
the real controls, side by side in the gallery, before any of it ships:
nav items, buttons, cards and fields each get their own answer rather than
one effect everywhere. Judge them by feel, at real speed, in the app.

**Reference: arkiiitekt.com**, which is close in spirit though not exactly
it. Its stylesheet is mostly restraint:

- colour does nearly all the work — text and borders brighten over
  150–250ms, nothing moves or resizes;
- `[ ]` brackets around a label each step 3px outwards and brighten;
- links draw a 1px underline from left to right (`background-size` from 0
  to 100%);
- an arrow beside a label nudges 4px right;
- a frame's border brightens when anything inside it is hovered
  (`:has(a:hover)`).

**Rules the first cut taught:**

- Never change a control's size or its text's width. Draw over it, or
  change colour.
- Motion is per kind of control, and quiet by default; louder belongs to
  Fun mode, not the everyday setting.
- Check mid-animation in a real browser with real input: the first press
  burst was clipped out of sight, and the first ripple too faint to see,
  and neither showed in a still screenshot.

## Command palette (Cmd+K)

**Built 2026-10-01** as Stage 4 of `docs/13-DESIGN-UPGRADES.md`
(`src/features/palette`). It searches meetings with the existing search
command, not an FTS5 index; that index is still worth building when the
library is large enough for the plain search to feel slow.

The history below is from before it was built, and is kept for the reasoning.

Raised 2026-09-05 as "a future feature addition", and it already had a home:
**M7** in `docs/11-PLAN.md`, alongside search and keyboard shortcuts.

It was held back during the visual phase. A command palette is among the
most theme-expressive components in any app — termcn's own shot of one is in
the reference set — so building it before the visual language was settled
would have meant building it twice.

What it was expected to need, as listed then: `themeForKey`'s typing-target
guard, the fill and framing switches, and an SQLite FTS5 index. That index
was never built (see `store/search.rs` and the Search entry below); the
palette uses the plain scan.

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
answer rather than a better-tuned guess. Not built as of 2026-10-10.

**A real-audio fixture.** The plan above was to make the failing recording a
fixture. It never was. The two kept sessions (`sess-1788645404091` and
`sess-1788646471691`) are gone from `.sessions`, and no WAV was committed.
The chunker's regression tests use synthetic audio only (`quiet_speech` in
`transcribe/chunker.rs`). The next time a recording reproduces a
transcription fault, keep it as a fixture.

## transcribe.cpp — spiked 2026-09-06, **not adopted**

This entry was written in stages on one day, and its verdict changed twice.
**The current position is "Verdict, after building it properly" below.** The
sections after it — "Spike result" and "The order to do things in" — were
written *before* that verdict, and are kept as the record of how the wrong
conclusion was reached.

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

Items 1 and 2 still stand and neither was built as of 2026-10-10. Item 3 is
reversed by the verdict above.

1. **A glossary first.** Handy ships "Custom Words" and it is
   engine-independent. It fixes the failure actually observed — proper nouns —
   and costs a fraction of a migration.
2. **Try `ort-directml` before any of this.** It is a feature flag on the
   current stack and buys GPU acceleration with none of the C++ build cost.
   ASR runs on CPU today. In `transcribe-rs` 0.3.11 the DirectML provider
   sits behind `ort-directml`, which TRACE does not enable, and auto-selection
   leaves it out. The plan once claimed otherwise and has been corrected.
   `DirectML.dll` ships anyway: the installed v0.27.0 `trace.exe` lists
   `directml.dll`, `d3d12.dll` and `dxgi.dll` among its load-time imports
   (`dumpbin /DEPENDENTS`, 2026-10-10), so it cannot be dropped without
   changing how `ort` is linked. Before enabling it, weigh the video memory
   ASR would take against what the summary model needs on the same card.
3. ~~Revisit when the bindings reach 0.3.~~ ~~**Superseded by the spike
   above.** The quality difference on a real failing recording is large
   enough that waiting for a version number is the wrong call.~~ Written
   before the fair comparison. It turned out that the quality difference was
   the VAD bug, not the engine; see the verdict above.

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

As of 2026-10-10 neither is built, and the VAD toggle is not needed for
debugging. TRACE's VAD runs only at transcription: nothing in `src/audio`
uses the chunker, so the session WAVs are the whole stream. Settings →
Audio already keeps them, and `chunk_check` replays the VAD over them. A
filler-word toggle remains an idea. Synthesis already guards against a
runaway filler (`synthesis/prompt.rs`), but the transcript keeps them.

## In-app updates — later, after code signing

**Idea.** An "Update available" notice in the status bar, as Handy has, that
downloads and installs a new version from inside the app.

**Today.** `pnpm update-app -Check` shows what an update would bring, and
`pnpm update-app` pulls, builds and launches the installer locally
(`scripts/update.ps1`); `pnpm bump` gives each build its own version.
That is enough while TRACE has one user who builds it from source.

**What the real thing needs**, in order:

1. **The code-signing decision** (`docs/11-PLAN.md`, M8). Everything below
   depends on it. Windows SmartScreen warns on every unsigned download, and an
   updater that triggers that warning on each release is worse than no updater.
2. **Signed release builds published to GitHub Releases** — a CI workflow that
   builds on Windows, signs, and uploads the installer with a `latest.json`
   manifest.
3. **Tauri's updater plugin** (`tauri-plugin-updater`), configured with the
   manifest URL and an update-signing key pair. This key is separate from the
   Windows certificate: it proves an update came from us, and losing it means
   no installed copy can ever update again. It must live somewhere safer than
   a laptop.
4. **The UI**: a status-bar notice and an About entry, following the same
   "say it, do not hide it" rule as the Ollama notice.

**Why not now.** It is the one feature that would make TRACE contact the
network on its own. That has to be a visible, opt-out setting, not a default
added in passing — the product promise is that nothing needs a network after
setup.

## Library and meeting management

Raised 2026-09-06 after real use. **Discard, rename and delete are built**;
the rest is recorded here rather than guessed at.

### Done

- **Discard a recording in progress.** Starting a meeting used to commit you
  to it — the only exit wrote a note, re-transcribed and ran synthesis.
- **Rename a note**, moving the file so the filename keeps matching the title.
- **Delete a note**, taking its session with it.

### Not built, in the order I would do them

1. **Pause and resume a recording.** Now the largest thing left, and the one
   with real correctness risk — it touches the timeline every evidence
   citation depends on, so it deserves its own focused pass rather than being
   squeezed alongside other work.

   The hard part is not the button, it is the timeline: a paused stretch has to become a gap rather than a splice,
   or every timestamp after it is wrong. The loopback path already pads gaps
   with wall-clock time, so the machinery exists — but silence that is
   *absence* and silence that is *nobody talking* must stay distinguishable,
   because the second is evidence and the first is not.
2. ~~**Search.**~~ **Done 2026-09-06**, and without the planned index — a
   direct scan answers in 106 ms across 1,200 notes. See `store::search`.
3. ~~**Tags.**~~ **Done 2026-09-06**, immediately after search, which is what
   made them worth having — a tag you cannot search for is decoration. They
   live in the note's own frontmatter, so they travel with the file, and
   `tag:client` narrows search to them. Clicking a tag on a note searches for
   it.
4. ~~**Participants.**~~ **Asked of the user, 2026-09-23**, alongside free-text
   context ("this was an interview"). Both live in frontmatter and feed the
   next regeneration; context is never citable. One name replaces "them" in
   the transcript. Several are given to the model as a set but never pinned
   to lines, because the system stream cannot tell remote voices apart — that
   still needs the voice-embedding work in Phase 3.
5. **Folders and grouping.** Notes are already nested `YYYY/MM` on disk. A
   project or client grouping is a second axis, and worth resisting until
   search exists — folders are what people reach for when they cannot search,
   and building both means maintaining both forever.
6. **Hiding or archiving old meetings.** The library groups by date already.
   Worth waiting to see whether this is a real problem at a hundred meetings
   or an imagined one at ten.
7. **More library filters: length and type.** Newest/oldest and a tag filter
   are built, and each row shows its length. Filtering by type waits on type
   being something a meeting is given — nothing sets it yet, so every meeting
   is "general" and a type filter would always show everything. A length
   filter is cheap once someone asks for it; `NoteSummary.duration_ms` is
   already there.

### Pause: the design question, before any code

Three options, none obviously right, and picking wrong is expensive:

1. **Write silence while paused.** The WAV stays aligned to wall-clock time
   and nothing downstream changes. But it costs ~23 MB per minute per stream,
   and — worse — pure digital silence would drag the adaptive VAD's noise
   floor to zero, clamping the threshold to its minimum for the *whole*
   recording. A pause would quietly degrade the transcription around it.
2. **Excise the pause and shift timestamps.** Disk-efficient and correct, but
   sample position stops being a linear function of session time, and every
   timestamp becomes a piecewise mapping. Easy to get subtly wrong, and wrong
   here means citations point at the wrong words.
3. **One WAV part per unpaused stretch, each with its own offset.** Reuses
   `transcribe_stream(wav, source, start_offset_ms)`, which already exists to
   align the two streams against each other. Probably the right answer, and it
   touches the file layout, the session summary, recovery and `wav_check`.

Option 1 looks cheapest and is the trap: it is the only one that silently
damages the transcript.

## Appearance: families, more modern themes, the sidebar

Raised 2026-09-23. **Built:** a Modern / Terminal split on the Appearance page,
with `graphite` as the first modern theme (shadcn's neutral dark, white as the
accent) and the five terminal themes unchanged; CRT mode as a switch over any
theme; the type scale one step up; the library's command-line search, signal
panel and Granola-style rows; the scroll breadcrumb.

**Not built yet:**

1. ~~**The collapsible sidebar.**~~ Built in Stage 0 of
   `docs/13-DESIGN-UPGRADES.md`: hidden by hand (Ctrl+\) or below 960px,
   folding to a strip with the toggle and the recording timer. CRT mode went
   the same week, replaced by screen filters.
2. **More modern themes.** One exists so the family could be judged against a
   real screen. A light theme is the obvious second — nothing in the modern
   family assumes a dark ground, but no theme has tested that.
3. **Syntax colour in the search line.** `tag:` and `len:` words would read
   better coloured as they are typed. It needs an overlay behind the input,
   which is fiddly to keep aligned; worth it only if the plain line confuses.

## Resource safety — audit of 2026-10-10

Raised after a one-hour meeting ended and the whole machine froze while the
summary model loaded: Figma, two browsers, coding agents and NVIDIA
Broadcast already held most of the memory and the card. **Built in 0.28.0:**
a memory check (RAM and video memory) before every summary-model load and
before each part, a visible wait with "write anyway" and "later", a
mid-meeting warning, the summary-memory default chosen from total RAM, a
journal marker so notes cut off by a freeze are offered on the next launch,
and a streaming full-quality pass — measured at 2.2 GiB peak per stream-hour
before, 8–10 MiB after, flat at three hours (`examples/repass_memory.rs`).

What the audit found besides, worst first. Evidence is `file:line` as of
0.28.0, or a measurement.

### Can lose data

1. ~~**Typed notes are wiped after leaving the recording screen.**~~
   **Fixed 2026-10-10** (`6ca5afc`): the backend holds the notes.
   `CaptureScreen.tsx` keeps them in local `useState("")`, and the journal
   stores notes as whole snapshots (`capture_manager.rs`, `update_notes`).
   Come back to the screen and the box is empty; the next keystroke journals
   a short snapshot over everything typed before. The debounce in
   `useCapture.ts` is not flushed on unmount either. Reported in the notes of
   the 2026-10-10 meeting itself: typing vanished on switching views, opening
   the mini window or the scope. *Fix:* the backend holds the notes
   (`capture_status` or a `capture_notes` command); the screen restores them
   on mount and flushes on unmount. Small to medium.
2. ~~**WAVs are unreadable after a power cut or a hard kill.**~~
   **Fixed in 0.28.1**: flushed every second, mended on read. `audio/wav.rs`
   rewrites the header only in `finalize`; hound's `Drop` would do it, but
   release builds are `panic = "abort"` and a power cut runs nothing. The
   header then claims zero samples, so the full-quality pass, `wav_check` and
   any re-run read nothing. *Fix:* `WavWriter::flush()` every few seconds —
   hound documents it as a checkpoint — and repair the header from the file
   length when one says zero. Small.
3. ~~**A Documents folder synced by OneDrive uploads the audio.**~~
   **Fixed in 0.29.0.** Sessions live in `%LOCALAPPDATA%\TRACE\sessions`
   and are moved there from `.sessions` on each launch; replay finds a WAV
   beside its journal, not at the path journalled. About warns when the
   notes folder is in OneDrive or Dropbox. Still not built: choosing the
   notes folder. What it was:
   `store/paths.rs` puts the notes root, `.sessions` included, under
   `dirs::document_dir()`, which Known Folder Move redirects into OneDrive.
   That is ~690 MB an hour of raw meeting audio leaving the machine, plus
   sync locks on the WAVs and journal mid-meeting. *Fix:* sessions under
   `%LOCALAPPDATA%\TRACE\sessions`, notes wherever the user likes; warn when
   the notes folder is in OneDrive or Dropbox. Medium, because existing
   sessions move.
4. **A full disk silently ends a stream.** `mic.rs` (`write_chunk(...)?`) and
   `loopback_win.rs` (`sink.write(&mono)?`) end their capture thread on the
   first write error; the pump ignores journal failures
   (`let _ = journal.append`). Nothing reaches the UI until the meeting is
   stopped. Free space is read only for the first-run report (`system.rs`).
   *Fix:* check at start (warn below a few hours of audio), every minute
   after, and say on the recording screen when a stream has died. Medium.
5. **Windows can sleep mid-recording.** Nothing calls
   `SetThreadExecutionState`. A call app usually keeps the machine awake; an
   in-person meeting with only TRACE running does not, least of all on
   battery. What wake does to the timeline is unmeasured. *Fix:*
   `ES_SYSTEM_REQUIRED | ES_CONTINUOUS` while recording and while notes are
   written; then test a sleep and wake. Small.
6. **Quitting or updating mid-meeting gives no warning.** No
   `CloseRequested` handling (`windows.rs` watches focus only), and
   `scripts/update.ps1` force-closes after ten seconds without knowing
   whether a meeting is recording. Notes cut off this way are now offered on
   the next launch, but the meeting itself ends where it was. *Fix:* confirm
   on close while recording or writing; a busy marker the update script
   reads. Small.
7. **Regenerating overwrites body edits made outside TRACE.**
   `store::rewrite_note` keeps the title, tags, context and names from the
   file and nothing else, by design — but nothing tells someone who edited
   the Markdown in another app. *Fix:* hash the body when written; if it
   changed, confirm, or keep a `.bak`. Small to medium.
8. **The journal is flushed, not synced.** `journal.rs` `append` flushes to
   the OS; a power cut can lose the last seconds. *Fix:* `sync_data` every
   few seconds. Small.

### Can stall the machine or the notes

9. **Two speech engines and the summary model at once.** Back-to-back
   meetings: the lane serialises the full-quality pass and summaries, not
   the live transcriber, so meeting two's live engine runs beside meeting
   one's re-pass engine, and under "ready during meetings" the summary model
   too. Each engine is three ONNX sessions on ORT's default thread pool
   (`transcribe-rs` `onnx/session.rs`: `create_session` passes no count), at
   normal priority. *Fix:* thread counts need `transcribe-rs` to pass
   `create_session_with_threads` through `ParakeetModel::load` (an upstream
   PR); then a capped, below-normal pool for the re-pass. Medium.
10. **No way to stop a slow summary or re-pass, and a slow Ollama fails at
    once.** `REQUEST_TIMEOUT` is ten minutes per request, nine parts an hour;
    nothing cancels. Ollama still starting after a reboot fails the 2 s
    readiness probe and the notes fail outright. *Fix:* a Stop on the job,
    checked between parts and chunks; retry readiness for a minute first.
    Medium.
11. **Lost devices are not followed.** `loopback_win.rs` opens the default
    output at the start and keeps it: switch to a headset mid-call and the
    system stream records silence; an invalidated device ends the stream. A
    mic unplugged only counts errors. *Fix:* per-stream health on the
    recording screen, reopen on invalidation or a default change, and warn
    after minutes of digital silence. Large.

### Surprising, or noise

12. **"1 stream errors" on every meeting.** `mic.rs` sends the error text to
    `eprintln!`, which goes nowhere installed. Exactly one per meeting, on
    NVIDIA Broadcast and the 96 kHz Razer alike, matches the benign startup
    underrun its own comment describes. *Fix:* keep the first error's text in
    `StreamStats` and log it; ignore the first half-second; tell the user
    only if errors continue. Small.
13. **"a window with label `mini` already exists".** `windows::open_mini`
    checks, then builds; the shortcut handler (an async task) and the
    meeting-start trigger under "always" can both pass the check. *Fix:*
    serialise it, or treat the label existing as success. Small.
14. **"Ctrl+Alt+R is taken".** The old default; last logged 2026-10-02,
    before it moved to Ctrl+Shift+Alt+M. It also fires when a dev build and
    the installed app run together and the second finds its own shortcut.
    Small, if worth anything.
15. **Lowering audio retention deletes nothing until later.**
    `set_audio_retention` only stores the choice; audio is released only for
    the meeting just ended, so switching to Delete keeps every kept recording
    indefinitely. *Fix:* apply it on change, saying how much goes. Small.
16. **A wrong process on port 11434, or Ollama mid-update,** reads as "not
    running". Small.

### Quality of life

17. A system notification when notes are ready and TRACE is minimised.
18. First run says whether the chosen summary model fits this machine;
    `memory::check` can answer it now.
19. Honest time estimates: the re-pass is ~4.5 min an hour on the reference
    machine, and the parts are known once a meeting is split.
20. Defer, or warn, before heavy work on battery.
21. The status bar naming what TRACE holds in memory while it works.

### Thinking: measured, keep it on

`examples/thinking_compare.rs` on the 2026-10-10 hour-long journal, qwen3:14b,
Ollama 0.40.2:

| | Time | Key points | Decisions | Actions | Open questions |
|---|---|---|---|---|---|
| Thinking on | 172 s | 6 | 12 | 5 | 12 |
| Thinking off | 167 s | 8 | 9 | 6 | 24 |

Off is barely faster, because one part ran away to the 3,072-token cap and
was retried (45 s); without that, ~120 s. It is clearly worse: it copies the
typed notes in as items — "NOTES:" and "TRACE FEEDBACK:" as open questions
— doubles the open questions with near-duplicates, and files decisions as
action items. On writes fewer, more synthesised items. **Keep it on.** The
cost to watch is the budget: thinking counts against `NUM_PREDICT`, and one
part on 2026-10-10 used 2,357 of 3,072 tokens; a part that runs past it gets
the length error and one retry.

