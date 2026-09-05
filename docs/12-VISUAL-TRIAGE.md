# Visual reference triage

**2026-09-05.** Sorting the reference set into what Phase B can build, what costs
one of the two remaining structural-switch slots, what is a layout variant, and
what is its own project. Input to Phase B in [11-PLAN.md](11-PLAN.md).

---

## First, termcn

**termcn cannot be used in TRACE.** Its components render to a terminal TTY via
[Ink](https://github.com/vadimdemedes/ink) or
[OpenTUI](https://github.com/anomalyco/opentui) — the installation docs require a
project with one of those set up. TRACE is a Tauri app drawing into a WebView.
There is no DOM renderer.

The shadcn connection is a distribution mechanism, not a rendering one: termcn
publishes through the `shadcn` CLI registry, which is just a way of copying
source files into a project. Those files import from `ink`. They are not the
DOM components shadcn/ui ships.

That is a real disappointment, so it is worth being precise about what *is*
usable, because it is more than nothing:

| From termcn | Usable? | How |
|---|---|---|
| Components (80+) | **No** | Terminal-only rendering |
| Themes (40+ palettes) | **Yes** | A palette is a list of hex values. Porting one to a `[data-theme]` block is a copy-paste job |
| The component *catalogue* | **Yes, and this is the valuable part** | It is a well-considered specification of what a terminal design system contains |

That catalogue is worth reading as a checklist rather than a dependency. It
names things TRACE has no answer for yet and probably needs — `Command Palette`
(M7), `Log Viewer`, `Banner`, `Alert`, `Diff View`, `Sparkline`, and a `Box`
with an inline title, which turns out to be the single most common move in the
whole reference set (see below).

**Verdict: reference, not dependency.** No licence check needed, because nothing
is being taken.

---

## The tension worth naming first

Fourteen of these sixteen references are **dashboards, posters or dev tools**.
Almost none of them ask anyone to read a paragraph.

TRACE does. A meeting note is prose that someone reads for twenty minutes, a
week after the meeting, looking for one thing. `tokens.css` states the ratio
target as **80% modern premium / 15% terminal / 5% strange**, and
[05-DESIGN-DIRECTION.md](05-DESIGN-DIRECTION.md) explicitly rules out "fake
terminal cosplay". Most of this set is 100% terminal.

Only two references in the whole set are *reading* surfaces: **Buena** and
**Pierre Computer Company**. Those two are the ones that tell us what a terminal
aesthetic does to a page of text. The rest tell us what it does to numbers.

That is not an argument against the direction. It is an argument for where each
reference gets applied: **capture mode can be as dense and instrument-like as
btop. Reading mode cannot.** The existing capture-vs-reading split in the tokens
already anticipates this, and it is about to earn its keep.

---

## The triage

### Bucket 1 — Token changes. Free, land in Phase B

| Reference | What to take |
|---|---|
| **Buena** (hex dump hero) | Near-black ground, off-white ink, greyscale discipline. Large sans headline over mono body — exactly TRACE's type split, done well |
| **TR-100 machine report** | Pure monochrome. No accent at all. A serious candidate for `quiet` |
| **Databases deployed** (green grid) | Phosphor green on near-black — close to today's `terminal`, and a useful check on whether ours is too saturated |
| **bagels** (purple) / **btop** (multi-hue) | Accent options. bagels' single purple is the more disciplined of the two |
| **"The perfect dark shadow"** | **Six stacked shadows.** Directly actionable — `tokens.css` already says "depth from layered shadows, never glow" but only defines three simple ones. This is the recipe for doing what the doc already asks for |

### Bucket 2 — Structural switches. Two slots left, and this is what to spend them on

**Slot 2: section framing.** Does a section render as a label with a hairline
rule, or as a **box with its title inlaid in the border**?

```
current:   NOTES ──────────────────────       switch:  ┌─Notes────────────────┐
                                                       │                      │
```

This is the single most common move in the entire reference set — lazygit,
bagels, bpytop, btop, TR-100 and termcn's `Box` all do it — and it transforms
every screen at once. It is also how "focused panel" gets expressed in all of
them (bright border), which TRACE will need for M7's command palette anyway.

**Slot 3: fill treatment.** Are meters, progress and empty states **solid**, or
**dithered / hatched**?

```
solid:   ████████░░░░░░░░        dithered:  ███▓▒░░░░░░░░░░░
empty:   (nothing)               hatched:   //////  No data  //////
```

TR-100's checkerboard bars, bagels' hatched empty state, btop's dotted graphs
and the green dot-matrix are all the same idea. It costs one switch and it
reaches the level meters, the model download, the synthesis progress and every
empty state — which is a lot of surface for one decision.

**Not spending a slot on:** the bracketed keybinding chips (`[?] HELP`,
`[^+L] CLEAR`) from Buena and the bottom keybinding bars in lazygit/bagels/btop.
They are excellent and TRACE should have them — but they are a *new component
plus a layout change*, not a switch. See bucket 3.

### Bucket 3 — Layout. Note screen only, one variant

Per [11-PLAN.md](11-PLAN.md): tokens do not handle layout, so layout variants get
explored on the note screen alone.

| Reference | The variant |
|---|---|
| **TR-100 machine report** | The strongest idea in the set. Render a note *as a machine report* — boxed, uppercase label column left, values right, heavy rules. A TRACE note genuinely is a machine report about a meeting, so the form fits the content rather than being applied to it |
| **lazygit / bpytop / btop** | Multi-pane: notes, transcript and generated output as three focusable panels rather than one scrolling column |
| **Bottom keybinding bar** | A persistent footer showing what the focused region responds to. Pairs with M7's shortcuts, and is most of the way to a command palette |
| **Pierre Computer Company** | Renders Markdown *as visible source* — `##`, `[text](url)` left intact. Odd, and worth one prototype: TRACE notes really are Markdown files, and showing that honestly is a defensible position rather than a gimmick |

### Bucket 4 — Not a theme. Backlog, costed separately

| Reference | Why it is out of scope for Phase B |
|---|---|
| **Tron CRT** (cyan chrome, yellow modal) | This is the cliché `05-DESIGN-DIRECTION.md` explicitly rules out. Included here so the ruling is on the record rather than silent |
| **HOLOMAP TERRAIN**, **Fairlight CMI** | Same, plus pixel display faces — a font decision with real legibility consequences for a reading tool |
| **KNNY posters**, **Video Walkman** | ASCII-art illustration. Beautiful, and a genuine project: it needs either an artist or a generator, and it is where an easter egg or a boot screen would live, not a theme |
| **btop / bpytop graphs** | Braille and dither plotting needs a charting primitive TRACE does not have and has no data for yet |
| **humbleteam fitness mockups** | Useful as proof the aesthetic survives contact with a consumer product. No specific move to lift |

---

## What Phase B builds

1. Three themes as planned — `terminal`, `futurist`, `quiet` — with the palettes
   above and the layered-shadow recipe.
2. Two structural switches: **section framing** and **fill treatment**.
3. One layout variant on the note screen: **the TR-100 machine report**.

Everything else in bucket 3 and all of bucket 4 goes to
[10-BACKLOG.md](10-BACKLOG.md) with this triage as the reason.

## The thing to watch

The reference set pulls hard toward density, and reading mode cannot absorb it.
If Phase B produces three themes that all look superb in the gallery's capture
scenarios and tiring in `note-long`, the honest conclusion is that the terminal
language belongs in capture mode and the chrome, and reading mode should stay
quiet. That would be a real finding, not a failure — and the 320-turn fixture
exists precisely so it shows up before it ships.
