# Plan — from working pipeline to a product with a face

**Written 2026-09-05.** Supersedes the sequencing in `03-ROADMAP.md` from M7 onward;
everything before M7 is built.

> **Status, checked against the code on 2026-10-10.** Phases A and B and M7
> are done. Phases C and D became `13-DESIGN-UPGRADES.md`, which is where the
> visual work is now planned. M8 is done except code signing, which is still
> an open decision, and a true clean-machine install. Each section below says
> what changed. The original text is kept as the record of why things were
> ordered this way.

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
| ~~**A**~~ | ~~Prototyping infrastructure~~ — **done 2026-09-05** | — |
| ~~**B**~~ | ~~Three candidate themes~~ — **done 2026-09-05** (`472ecbd`) | — |
| **C** | Live with them — absorbed into `13-DESIGN-UPGRADES.md` | Yours, ~2 weeks |
| **D** | Commit, then the full visual pass — absorbed into `13-DESIGN-UPGRADES.md` | ~2 sessions |
| ~~**M7**~~ | ~~Search, command palette, shortcuts~~ — **done**: search 2026-09-06, palette 2026-10-01 | — |
| **M8** | First-run download, packaging, signing — **done except signing and a clean-machine install** | ~2 sessions |

---

## Phase A — Prototyping infrastructure ✅ done 2026-09-05

> **Built.** `#gallery` in dev renders 15 named states across the three
> screens, from fixtures, under any theme. The token layer is swappable and
> `terminal` is a no-op by construction. 41 TypeScript tests, four of which
> mount every scenario and fail on any console error.
>
> The original text follows, as the record of why it was built this way.

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

> **Built 2026-09-05** (`472ecbd`), though not as planned below. `futurist`
> and `quiet` were replaced by three other looks in that same commit. The
> themes since then are covered in `13-DESIGN-UPGRADES.md`.

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

Split, because only half of it is theme-expressive.

**Search: done 2026-09-06.** A field in the library, matching titles and
transcripts, showing the line that matched so a hit says *why* it is a hit.

**The planned SQLite FTS5 index was not built, on measurement.** Scanning
1,200 notes — about 5.4 MB, a daily meeting for five years — takes 106 ms in
release, and it is I/O-bound, so a debug build is barely slower. A realistic
first-year library lands near 25 ms. An index would have bought nothing at
that size and cost a dependency, a C build, and the oldest bug in search: an
index that disagrees with the thing it indexes.
`search_is_fast_enough_without_an_index` holds the measurement and is what
will say when that stops being true.

**Command palette and shortcuts: done 2026-10-01** (`d73fd7d`), as Stage 4 of
`13-DESIGN-UPGRADES.md`. Ctrl+K opens it, and it searches meetings through the
same scan as the library. The reasoning that held it back until then is kept
here: a palette is among the most theme-expressive components in any app, and
building it before the language is settled means building it twice.

---

## M8 — First run, packaging, signing

**Started 2026-09-05, out of plan order.** M7 is parked behind the visual
decision by design — a command palette is the most theme-expressive component
in the app. But that decision needs Phase C, and Phase C needs TRACE used for
real meetings, which until now meant keeping a dev server alive. M8 is what
unblocks the thing that unblocks the themes.

| Item | Status |
|---|---|
| Windows installers | **Done.** `pnpm tauri build` produces `TRACE_<version>_x64-setup.exe` (NSIS) and `TRACE_<version>_x64_en-US.msi`. At v0.27.0 (built 2026-10-07) they are 17.0 MB and 20.6 MB. The first build on 2026-09-05 was 11.9 MB and 25.7 MB. That one shipped a 21 MB dev harness and left out the runtime DLLs (`5884273`, `065c7a1`), so its sizes mean nothing now |
| Failure guidance | **Done.** `ModelError::guidance` — no network, damaged archive, interrupted install, full disk. Technical detail retained |
| CSP tightened | **Done.** Dropped the Ollama allowance; the WebView makes no network calls at all |
| Boot sequence | **Done 2026-09-05, in a different form** (`7407819`): first run is a full-window machine report (`src/features/firstrun`) of measured rows, rather than the `[ OK ]` sequence imagined in Phase D |
| **Code signing** | **Blocked on a decision only you can make.** See below |
| Clean-machine install | **Not done on a clean machine; mostly covered another way.** No second Windows machine was available, and Windows 10 Home has no Sandbox or Hyper-V. Instead, `dumpbin /DEPENDENTS`, the MSI file table, and the loaded modules of the *installed* process found and fixed the missing runtime DLLs (`src-tauri/redist/README.md`). Still untested: anything a clean machine lacks that this one has, apart from those DLLs and WebView2 (see *Install layout* below) |
| Fully-offline run | **Done 2026-09-05.** Wi-Fi off, a real meeting through capture, the full-quality re-pass and synthesis. That run turned up the doubled "Transcript" heading (`601ccee`). It was checked by hand once and no test repeats it |
| Updating an install | **Done.** `pnpm update-app -Check` previews; `pnpm update-app` asks, then pulls, builds and launches the installer; `pnpm bump` versions each build. In-app updates wait on signing — see `10-BACKLOG.md` |

### Code signing needs a purchase, so it is your call

The installers are **unsigned**. On Windows that means SmartScreen shows
"Windows protected your PC" on first run, and the user has to click through
*More info → Run anyway*.

For personal use that is a one-time annoyance and arguably not worth paying to
remove. For anything distributed it is close to unacceptable — most people
will not click through.

Three options, in rough order of cost:

1. **Ship unsigned.** Free. Fine while TRACE is yours alone.
2. **OV certificate**, roughly £200–400/year. Removes the warning only after
   the binary builds enough download reputation, which can take weeks.
3. **EV certificate**, roughly £300–600/year, usually on a hardware token.
   SmartScreen trusts it immediately.

Nothing in the build blocks on this: Tauri signs via
`bundle.windows.certificateThumbprint` whenever a certificate exists, so
adding one later is configuration, not rework.

**Verification still to do:** install on a clean machine. The offline half
of this was done on 2026-09-05; see the table above.

### Install layout, uninstall, and WebView2

Checked 2026-10-10 against the NSIS script Tauri generated for v0.27.0
(`src-tauri/target/release/nsis/x64/installer.nsi`) and the installed copy.
This is the NSIS installer, which `pnpm update-app` uses. The MSI was not
inspected and may differ.

**The install directory and the data directory are the same folder.** NSIS
installs per user (`INSTALLMODE "currentUser"`) to `%LOCALAPPDATA%\TRACE`.
The code keeps its data there too: models (`models::models_root`),
`settings.json` and `logs\`. So `trace.exe`, the runtime DLLs, `models\` and
`settings.json` all sit side by side. Notes and sessions live elsewhere, in
`Documents\TRACE` (`store/paths.rs`).

**Uninstalling keeps the models, settings and logs, by accident rather than
design.** The uninstaller deletes the files it installed by name, then calls
`RMDir "$INSTDIR"`, which is not recursive. That fails while `models\` is
there, so the folder and everything TRACE wrote in it survive. Its "delete
app data" checkbox removes `%APPDATA%\computer.trace.app` and
`%LOCALAPPDATA%\computer.trace.app`, the bundle identifier's folders, which
hold only WebView2's `EBWebView` profile. It never touches
`%LOCALAPPDATA%\TRACE`, so ticking it still leaves the ~0.5 GB model behind.
Worth fixing before TRACE goes to anyone else. A real fix means either
moving data out of the install directory or adding an uninstall hook, which
is a code change, not a doc one.

**WebView2 is fetched at install time if it is missing.** The installer uses
Tauri's default `downloadBootstrapper` mode. If a machine has no WebView2
runtime, it downloads Microsoft's bootstrapper, and with no network the
install aborts. That breaks the "no network after setup" promise only at
setup itself, and only on machines without WebView2. Recent Windows 10 and
11 builds normally ship it. That is an assumption from Microsoft's
distribution policy, not something checked here. `offlineInstaller` mode
would embed the runtime instead, at roughly +130 MB (Tauri's estimate, not
measured).

---

## Carried, unresolved

Things I know are open. None block the above; all deserve to be written down
rather than remembered.

| Item | Status |
|---|---|
| **Decision vs deferred conversation** | Prompt rule tightened 2026-09-05 with the exact failure as a counter-example. **Untested against a real conversation** — the fixture that produced it is not a regression test. The only real meeting recorded as checked (the offline run, 2026-09-05) had no decisions in it, so the rule had nothing to get wrong. Whether later meetings exercised it is not recorded. |
| ~~Regenerate on pre-2026-09-05 notes~~ | **Fixed 2026-09-05.** `can_regenerate` is asked up front and the control is disabled with a reason. |
| ~~VAD threshold drift~~ | **Observed and fixed 2026-09-06** (`7ecac6c`). The fixed 0.012 RMS muted about half of a quieter speaker's speech. The threshold now comes from each recording's own noise floor and speech level, and 0.012 survives only as the upper clamp (`transcribe/chunker.rs`). Detail in `10-BACKLOG.md`. |
| **Uncertainty affordances** | Squiggly underlines for low-confidence words. Needs `transcribe-rs` to expose logits it already computes — an upstream PR. Detail in `10-BACKLOG.md`. |
| **Speaker memory** | heed's voice-embedding approach, for splitting the remote side into named people. Phase 3 territory, after M7. |

---

## Recommended next session

> **Superseded.** Written before Phase B was built, and `futurist` and
> `quiet` no longer exist. For what is open now, see `10-BACKLOG.md` and the
> *Open* section of `13-DESIGN-UPGRADES.md`.

**Phase B.** Open `#gallery`, look at `futurist` and `quiet` — both are
deliberately crude sketches — and say what is wrong with them. That reaction
is the input Phase B needs; designing three themes without it would be
guessing.

Two structural switches remain in the budget of three. Spending them is the
main design decision of Phase B, and worth making deliberately rather than
reaching for one the moment a theme feels flat.
