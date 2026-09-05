# Plan — from working pipeline to a product with a face

**Written 2026-09-05.** Supersedes the sequencing in `03-ROADMAP.md` from M7 onward;
everything before M7 is built.

## Where we are

The whole pipeline works end to end:

```
mic + system audio → live transcript → typed notes → full-quality re-pass → grounded synthesis → Markdown
```

M0–M6 are done. 175 Rust tests, 21 TypeScript tests. What remains is search
(M7), first-run and packaging (M8) — and the visual identity, which has been
deliberately deferred since M0 and is now the thing most worth spending time on.

**The honest gap: almost no real meetings have been through this.** Fixtures and
my own test recordings are not the same as a 45-minute call with three people
talking over each other. Several things below can only be settled by use.

---

## The shape of the next stretch

Four prototyping phases, then the two remaining engineering milestones. The
ordering is deliberate: **A and B are cheap infrastructure that make everything
after them faster**, C is your time rather than mine, and M7 lands *after* the
visual decision so its new surfaces get built in the chosen language instead of
retrofitted into it.

| Phase | What | Whose time |
|---|---|---|
| **A** | Prototyping infrastructure | ~1 session |
| **B** | Three candidate themes | ~1–2 sessions |
| **C** | Live with them | Yours, ~2 weeks |
| **D** | Commit, then the full visual pass | ~2 sessions |
| **M7** | Search, command palette, shortcuts | ~1–2 sessions |
| **M8** | First-run download, packaging, signing | ~2 sessions |

---

## Phase A — Prototyping infrastructure

Two things currently make visual iteration slow, and neither is about taste.

**1. Every screen needs real state to look at.** To see reading mode you need a
recorded meeting. To see the processing indicator you have to catch it mid-gap.
To see how a 90-minute transcript reads you have to talk for 90 minutes. This
is why the visual pass keeps getting deferred — the cost of *looking* at the
thing is too high.

→ **A fixture set and a `/gallery` route.** Every screen in every state —
empty library, first run, recording, processing, synthesis failed, a note with
no enhanced half, a 90-minute transcript, a meeting where the model found
nothing — rendered from static fixtures, reachable without recording anything.
Half a day, and it pays for itself the same afternoon. It also becomes the
surface for visual regression later.

**2. There is exactly one theme, and it lives in `@theme`.** Trying a second
one means destructively editing `tokens.css` and losing the first.

→ **Make the token layer swappable.** `@theme` keeps generating the utilities
(that part must stay), but the *values* move to `:root` and each theme becomes
a `[data-theme="…"]` override block. Components do not change at all — they
already reference tokens throughout. Add a switcher in the gallery, and a dev
keybind in the real app.

**Verification for this phase is precise: with `data-theme="terminal"` applied,
the app must be pixel-identical to today.** If it isn't, the token layer had a
gap worth knowing about.

### What a theme has to cover

Colour alone will not distinguish terminal from futurist. The theme layer needs:

- surfaces, lines, ink, accent, state colours (already tokens)
- **type family and scale** — currently Geist/Geist Mono, hardcoded in two tokens
- **radii and border weight** — instrument-tight vs soft vs perfectly sharp
- **a small number of structural switches** — chiefly: is a section heading an
  uppercase mono label with a hairline rule, or a large sans heading? That one
  choice carries more of the terminal feeling than any colour does.

Structural switches are the risky part. Each one is a fork in every component
that uses it, so the budget is **three, total**. More than that and themes stop
being cheap, which defeats the point.

---

## Phase B — Three candidates, not two

You framed it as terminal vs futuristic. I want to build a third as a control,
because the real question isn't which of two aesthetics you like in a
screenshot — it's **how much of either survives twenty minutes of reading a
document you actually need.** A neutral third option is what makes that legible.

| Theme | The idea | Distinguishing moves |
|---|---|---|
| **`terminal`** | Today's direction, sharpened. An instrument from an alternate 1987. | Mono-forward, uppercase tracked labels, hairline rules, 2–4px radii, flat surfaces, phosphor green as the only accent, ASCII glyphs |
| **`futurist`** | Precision instrument, present tense. Cool, high-contrast, more air. | Geometric display face for headings, sharper corners or none, a wider surface ladder, cooler accent, motion doing more work, thin high-contrast type |
| **`quiet`** | The control. Near-zero chrome — a document, not an interface. | Reading-optimised face, accent used almost nowhere, no system labels, chrome recedes entirely in reading mode |

Each is *only* a token block plus at most the three structural switches. If a
candidate needs more than that to make its point, that is worth knowing — it
means it is a different product, not a different theme, and it should be said
out loud rather than absorbed as complexity.

### Layout is not a theme

One caveat worth setting now. Tokens handle colour, type, radius and weight.
They do not handle *layout* — if `futurist` wants a persistent sidebar where
`terminal` has a header bar, that is a second copy of the screen, not a theme.

So: **layout variants get explored on the note screen only**, because that is
where you spend the time and it is the screen with the most content to
arrange. Capture and library keep one layout across all three themes.

---

## Phase C — Live with them

This is the part that actually decides it, and it is not my time.

**Use each theme for real meetings, several days each, switching on a schedule
rather than on impulse.** You cannot pick a theme from a screenshot, and the
failure modes that matter do not show up in the first minute:

- Does mono transcript type stay readable at minute 40, or start to grind?
- Does the accent still mean "live" when you've seen it a hundred times, or has
  it faded into decoration?
- Is the uppercase system language charming on day one and tiring on day four?
- When you go back to a note a week later to find one thing, which theme finds
  it fastest?

Keep a note per meeting — in TRACE, which is the point. What irritated at
minute 20 is the useful signal.

This phase also gets the pipeline the real-world exercise it hasn't had. Expect
it to surface product bugs that outrank the visual question entirely; if it
does, those come first.

---

## Phase D — Commit, then the full visual pass

Pick one. The others get deleted, or kept deliberately: a second theme that
survives as an unlockable is a much better easter egg than most of what's in
`09-EASTER-EGGS.md`, and it costs nothing once the layer exists.

Then the pass that has been waiting since M0:

- **Fragment Mono** evaluated properly against Geist Mono for system language
- **The boot sequence** — first-run model download rendered as the
  `[ OK ] TRANSCRIPTION ENGINE` sequence. This is the M8 setup UI and the best
  easter egg simultaneously, which is why it earns its place
- **The processing indicator** refined against the chosen language
- **Empty and failure states** given the same care as the happy path — a tool
  whose job is not losing things should look most trustworthy when something
  has gone wrong
- Easter eggs from `09-EASTER-EGGS.md`, chosen sparingly against the 5% budget

---

## M7 — Search, command palette, shortcuts

Built *after* the visual decision, deliberately. A command palette is one of
the most theme-expressive components in any app; building it before the
language is settled means building it twice.

- SQLite FTS5 index over the Markdown, rebuildable and never canonical
- Command palette, keyboard shortcuts
- **Verification:** delete `index.sqlite`, relaunch, confirm it rebuilds

---

## M8 — First run, packaging, signing

- Model download as the boot sequence (built in Phase D)
- Every failure state: no network, corrupt download, no disk, Ollama absent
- Packaging, code signing
- **Verification:** install on a clean machine, then disable networking
  entirely and complete a meeting end to end

---

## Carried, unresolved

Things I know are open. None block the above; all deserve to be written down
rather than remembered.

| Item | Status |
|---|---|
| **Decision vs deferred conversation** | Prompt rule tightened 2026-09-05 with the exact failure as a counter-example. **Untested against a real conversation** — the fixture that produced it is not a regression test. Phase C is the check. |
| **Regenerate on pre-2026-09-05 notes** | Will fail. Their journals were deleted at finalisation under the old cleanup. Needs either a clear error or a disabled button — currently it just errors. |
| **VAD threshold drift** | 0.012 RMS, tuned only on my recordings. May drift over a long meeting or a quiet speaker. Deliberately not fixed: unobserved, and guessing at a fix would be worse than waiting for a real case. |
| **Uncertainty affordances** | Squiggly underlines for low-confidence words. Needs `transcribe-rs` to expose logits it already computes — an upstream PR. Detail in `10-BACKLOG.md`. |
| **Speaker memory** | heed's voice-embedding approach, for splitting the remote side into named people. Phase 3 territory, after M7. |

---

## Recommended next session

Phase A, whole. It is self-contained, it is the cheapest thing on this list,
and everything else gets faster once it exists.
