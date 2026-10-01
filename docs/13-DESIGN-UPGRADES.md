# Design upgrades — themes, motion, visualisation, and joy

**Written 2026-09-30.** A batch of design requests raised in one go, ranked by
cost and sequenced into stages. Nothing here is built yet. Each stage is one
PR, bumps the version (`minor` for features), and passes `/verify` before it
is called done.

## Decisions already made

- **Keep all six existing themes for now.** Whittling down waits until the
  gallery is reachable from the installed app and the new themes exist to
  compare against. That makes ten themes: keys `1`–`9` reach nine, `0` takes
  the tenth, and **Ctrl+Shift+T stays** as the cycle.
- **Vertical alignment is undecided.** It gets prototyped before anything is
  chosen — see Stage 0.
- **This document is reviewed before any code.**

### From the grilling session (Q1–Q26, 2026-09-30)

The words are fixed in `CONTEXT.md`; this is what was decided with them.

**Themes**
- One word, **theme**, in UI, code and docs; *look*, *style* and *skin* go.
- A built-in theme can be **adjusted** (frame, type, mono font, case, and
  later the builder's settings). Adjustments stay with that theme, show an
  "adjusted" mark, and **Reset** undoes them. Today's global overrides become
  adjustments on whichever theme is current when the update lands, and only
  that one.
- **Save as new theme** makes a custom theme. Custom themes are JSON in
  `~/Documents/TRACE/themes/`. Fonts: the bundled list plus any installed
  Windows font; a missing font falls back to the family default and the
  builder says so.
- Number keys follow the theme list's order, which is editable; hiding a
  theme frees its key.
- The builder UI (Stage 2b) comes after the four new themes; the schema and
  migration (Stage 2a) come before them.

**Families**
- The families are **Modern** and **Retro**. Family is a setting inside each
  theme; `council` is Retro.
- A **Modern | Retro** switch sits above the theme list, and under it each
  family's settings, remembered per family:

  | Setting | Retro default | Modern default |
  |---|---|---|
  | Screen filter | Subtle scanlines | None |
  | Motion | Scramble, ASCII press | Fade, ripple |
  | UI sounds | Mechanical: relay clicks, soft keys | Soft taps |
  | Density | Tight | Roomy |

  Density is fine-tuned under an **Advanced** section. It may change between
  families, because the content column no longer does.
- Fun mode, Sounds on/off and volume stay app-wide.

**Fun mode and the narrator**
- Called **Fun mode**, not hacker mode. On: the narrator takes over the
  status bar's text (anything that matters, like a failing job or a missing
  model, still wins), eggs are frequent, and the boot sequence plays on launch.
  In Fun mode, Retro motion appears on Modern themes too, as a deliberate surprise.
- The narrator is deadpan machine output (`> 214 segments. two voices. one of
  them is you.`), speaks at most about once a minute when idle, and drops the
  `>` on Modern themes.
- During a recording, only eggs about the meeting itself, and only in the
  narrator. Anything big waits until the meeting ends.

**Sound**
- No sound ever plays while a meeting is recording, because the system stream
  would record it as *them*. (Windows can exclude an app's own audio from
  loopback, but only from build 20348; this machine is 19045.)
- Outside meetings: presses, toggles, page changes, opening and closing the
  palette, theme switches. Never on hover or while typing. One Sounds setting
  with volume, on and quiet by default.
- Sounds are synthesised, then rendered once into buffers at launch, so playing one costs
  the same as playing a tiny file. The audio context is suspended when idle,
  so TRACE does not hold the output device open.

**Capture**
- A **start sequence** runs wherever a meeting starts: well under a second
  of flavour text, animation and sound, skippable, with a setting to turn it
  off. Its sound finishes before capture opens.
- **Scope strip** above the notes while recording; **scope view** full
  screen on demand, with a one-line notes prompt so writing never stops.

**Mini window**
- Opened from a sidebar button, Ctrl+K, or the global shortcut
  **Ctrl+Alt+R** (configurable; opens it expanded with the cursor in the name
  field when idle; never stops a recording by itself).
- Offered once, inline on the mini window, the first time you minimise during
  a meeting. Then a setting: **Off / When minimised / When I switch away /
  Always during meetings**. "Yes" defaults to *When I switch away*.
  Returning to TRACE hides it again.
- Hidden from screen shares by default, with a setting to show it. Tauri has
  a reported black-rectangle bug on build 19045 when a hidden window is shown
  again, so the window is recreated rather than re-shown, and this is tested
  against a real Teams share.
- Right edge, lower third by default. Two fixed sizes, **bar** (dot, timer,
  waveform, Stop) and **expanded** (adds the name field and Start). Snaps to
  edges and remembers its position per monitor.
- **Hold to stop** (~0.6s, the button filling). A click alone says "hold to
  stop". Afterwards: the stop sound once capture has closed, `✓ saved ·
  writing notes… [open]` for a few seconds, the taskbar icon flashes, and
  returning lands on that note with the summary arriving.
- Closing it only hides it; it never stops a recording.

### From the grilling session (Q27–Q33)

- **Content column, Granola-shaped.** One `rem` cap for every theme and
  family, centred. Narrower windows: the column fills the space with fixed
  gutters. Wider or maximised: it stays at its cap, with empty space either
  side. Granola's column, measured in real pixels (its screenshots were at
  0.78×), is about 820px, roughly 51rem, against TRACE's 672px sans and
  ~500px in mono themes. So the cap goes up to around 52rem, with long reading text
  in notes and transcripts capped nearer 42rem, left-aligned inside it,
  so no edge moves between themes. Exact values are chosen in the Stage 0
  prototypes alongside the alignment rule.
- **Family flip** restores that family's last theme and its filter, motion,
  sounds and density. Number keys and Ctrl+Shift+T still span the whole list.
- **Appearance vs build mode.** The Appearance page holds the family switch,
  family settings, the theme list, quick adjustments with Reset, and an
  **Open in build mode** link. Build mode is the gallery with the full theme
  editor beside its fixture preview, so every edge case and failure state can
  be judged while editing. What it saves reaches the main window live.
- **Ambient visuals** never open the mic. They draw on past meetings' stored
  envelopes or a synthetic idle trace: atmosphere, not audio.
- **Ctrl+K** is one box: commands, then matching meetings. `>` restricts it
  to commands. The `trace --why`-style commands respond only to exact input
  and never appear as suggestions.
- **Rename is inline** (menu, F2 or double-click; Enter saves, Esc cancels).
  The themed dialog is for confirmations only.
- **The gallery ships in every build**, through Ctrl+Shift+G and Ctrl+K,
  never in the sidebar, and lazy-loaded.

### From the grilling session (Q34–Q39)

- **Narrow windows hide the sidebar.** Below a breakpoint it becomes a
  toggle icon, top-left, that opens the sidebar as an overlay over dimmed
  content, as Granola does. It can also be collapsed by hand at any width.
  The breakpoint must sit below TRACE's default window width, or the app
  opens collapsed; Granola's is about 1000px, TRACE opens at 1000px.
- **The window opens centred, at its default size, every time.** No
  window-state memory. The default grows to about **1200×840**, Granola's,
  clamped to roughly 85% of the screen's work area so a small laptop display
  never gets a window larger than itself. That lets the sidebar breakpoint
  sit near Granola's 1000px while the app still opens with its sidebar, and
  shows the wider column from the first launch.
- **The gallery's chrome stays neutral and unthemed**, but gets a proper
  design pass now that it ships.
- **Atmosphere**: ambient touches always (off with Motion); the screensaver
  only in Fun mode, after 5 idle minutes, never during a meeting or the
  start sequence, dismissed by any input without that input acting.
- **The four new themes** keep their names and directions. `vault` borrows
  the Pip-Boy style but no characters, logos or names; any figure is an
  original TRACE pixel mascot.
- **Press effects and eggs are a starting set**, each with a gallery
  scenario so it can be judged and cut there. The 100th meeting unlocks a
  hidden theme.
- **More ideas wanted.** Each stage proposes new moments of delight and
  Fun-mode madness for the surfaces it builds, rather than this list being
  final.

## What the code says, before the plan

These change how the requests are built, so they come first.

- **The gallery only exists in dev builds.** `main.tsx` gates it on
  `import.meta.env.DEV`, which is why the installed app cannot open it. The
  gallery also installs a *fake backend* globally (`installFakeBackend`), so
  it must not share a window with the real app: it opens in a window of its
  own.
- **Themes are hardcoded.** `THEMES` is a fixed list in `theme.ts`, and each
  look is a CSS block in `themes.css`. A theme builder needs themes to be
  *data* — a token set plus axes, as JSON — so that refactor lands before the
  four new themes, and they are written in the format the builder saves.
- **CRT mode is bezel hardware**: six spans in `Shell.tsx` (screws, LEDs,
  vent) and 144 lines of `crt.css`. It is replaced by a **screen filter** —
  none / scanlines / phosphor glow / dot-matrix / dither / vignette — which is
  what the effect should have been: a treatment of the glass, independent of
  the theme.
- **Audio levels are one RMS value per stream, polled.** Enough for a meter,
  not for an oscilloscope. Real waveforms need a small Rust addition: a ~30 Hz
  event carrying a downsampled envelope and a handful of FFT bands per stream.
  It stays in-process, so nothing leaves the machine.
- **People are not searchable yet.** Participants live in the note context
  (`store/context.rs`) but `NoteSummary` does not carry them, so `with:`
  suggestions need the backend to expose them.
- **Width shifts between themes because the column is measured in the
  theme's own font.** Sans themes cap the content at `42rem` (672px); themes
  whose type role is mono swap that for `62ch` (`type.css`), which in a mono
  face comes out near 595px. So `1` → `2` moves both edges of the page by
  about 40px. Density is not the cause. The fix is one content column width
  for every theme, set in `rem` so no font can change it; density can then
  vary by family without moving anything.
- **Native dialogs remain in three places**: one `window.prompt` (rename, in
  `LibraryScreen.tsx`) and three `window.confirm`s (library, capture, models).
  One themed Dialog primitive replaces all four, and the command palette
  reuses it.

## The requests, ranked by cost

| # | Item | Size | Done when |
|---|---|---|---|
| 1 | Select chevron padding | XS | The chevron sits a consistent gutter from the edge in every theme |
| 2 | Larger START MEETING | XS | It is unmistakably the primary target on the screen |
| 3 | Modern new-meeting title | S | No visible field; the title floats with a blinking `>_` prompt |
| 4 | Vertical alignment | S | One rule across pages, chosen from prototypes |
| 5 | Stable width across themes | S | Flicking through themes does not move the content column |
| 6 | Themed rename and confirm | S | No native dialogs left; rename also works inline (F2 or double-click) |
| 7 | Tag suggestions while typing | S | Previously used tags complete, most used first |
| 8 | Gallery in the installed app | S | Ctrl+Shift+G, and a palette command, open it in its own window |
| 9 | Search autofill | M | `tag:`, `len:`, `has:`, `sort:` and `with:<person>` complete as typed |
| 10 | Screen filters replace CRT | M | The bezel is gone; the filter is its own setting |
| 11 | Ctrl/Cmd+K palette | M | Navigate, switch theme or filter, start or stop a meeting, search notes, hidden `trace --why` commands |
| 12 | Hover scramble, press effects | M | Scramble never changes an element's width; press differs by control; reduced motion respected |
| 13 | Four new themes | M each | Each has gallery scenarios and is judged on real screens |
| 14 | Fun mode and narrator bar | M–L | Off by default; the status bar becomes a live commentary ticker |
| 15 | Themes as data, theme builder | L | Palette, fonts, spacing, case, frame, ASCII style and filter, live preview, save and export as JSON |
| 16 | Waveform visualisation | L | Oscilloscope, spectrum, ASCII scroll, and a Lissajous of mic against system |
| 17 | Mini window | L | Frameless, always on top, timer and waveform and start/stop, in sync with the main window |

## Stages

### Stage 0 — clear the ground

Everything after depends on these, so they go first.

- **Remove the CRT bezel; add screen filters.** A setting of its own,
  defaulted per family.
- **Layout constants.** The content column, gutters and top offset move out
  of theme reach, in `rem`.
- **Sidebar collapse.** Automatic below the breakpoint, manual at any width,
  overlay when opened from the toggle.
- **Default window size.** About 1200×840, centred, clamped to roughly 85% of
  the work area.
- **Dialog primitive.** Prompt and confirm, themed, focus-trapped.
- **Gallery in the installed app**, in a separate Tauri window so its fake
  backend cannot leak into the real one. Lazy-loaded, so the main bundle does
  not grow.
- **Alignment prototypes.** Three variants as a gallery-only layout toggle:
  top-aligned with single-action states centred; centre whatever fits; top
  everything. Judged on real screens in the installed gallery, then one is
  chosen and the toggle deleted.

**Built 2026-09-30 (v0.7.0).** Notes from building it:

- The dialog is confirm-only (`Confirm.tsx`), since rename went inline in
  Q32; rename moves to Stage 1 with the rest of item 6.
- The family is `retro` in code as well as in words. Stored themes and
  overrides carry over untouched; a CRT choice becomes the `crt` filter on
  the family it was used in.
- Every page now reserves the top bar's height (`Page.tsx`), so the first
  line of every page sits at the same height. Before, it sat at 2.5, 4.5 or
  5rem depending on the screen.
- The sidebar folds into a strip, not a floating button: a floating one
  collided with the capture header, and the strip keeps the recording timer
  in view.
- The gallery keeps its own theme (`trace.gallery.theme`), since it now runs
  beside the app and shares its storage.
- Left for the user to judge in the gallery: **Align**, **Column** and
  **Reading** in its header, and the sidebar breakpoint at widths 860 and
  1000. Defaults until then: `focus`, 52rem, 42rem, 960px.

**Screen effects, third attempt (v0.7.2).** Two single-choice filter sets
were rejected — the first invisible, the second unreadable — and the reason
was the same both times: flat black drawn over the letters. Rebuilt after
measuring lofi.cafe's own textures:

- A screen is a **mix**, not a choice: grain, scanlines, dot grid, vignette,
  glow, flicker, refresh bar, each with a 0–100 slider (`screen.ts`), and
  presets to start from (none, lines, lofi, crt, film, grid). Per family.
- Lines are a soft generated texture in `overlay`, as lofi.cafe's are: they
  shade a letter, never cut it. The vignette lifts the centre as well as
  dimming the corners. The glow is three layers, up to a 38px haze.
- Grain, scanlines and dots can go **behind the letters**: blended to
  `lighten`, they show on the ground and dark surfaces and nowhere a letter
  is brighter. A layer truly underneath was rejected — every surface would
  hide it, leaving a bare band under each top bar.
- Effects are drawn on the **page canvas only**; the sidebar and status bar
  sit above the glass, untouched.
- VHS and dither were cut rather than shipped a third time.
- Checked in headless screenshots at 2× on real screens before shipping,
  since both earlier versions passed every test and were still wrong.

**Grain, done properly (v0.7.3).** The v0.7.2 grain slid one noise image
about with CSS keyframes, and read as a picture jumping. So do grained.js
and vault66-crt-effect, the libraries worth looking at; Pixlated's grain is
static, and Jashior/grain regenerates the whole screen at 60fps with no
licence. None was usable. `Grain.tsx` now rolls a fresh 256px tile of noise
24 times a second and has the GPU repeat it from a random offset: measured
in headless Chrome, consecutive frames correlate at ~0.00 (best over every
shift ±24px ~0.05, the noise floor), 24 frames a second, 0.17ms of work a
frame. vault66's glare became the **glass** effect, a faint sheen that only
lightens.

**Behind that works, and sizes (v0.7.4).** "Behind" had been a lighten blend
over everything: it spared bright letters but still covered every dark card
and box, so it looked the same as "over". It is now a layer under the
content (`z-index: -1` in the canvas's stacking context); boxes and fields
take the ground as a fill while anything is behind, and cards already had
one. Measured on screenshots, the inside of a box and of the search field go
from a texture's variation (σ≈22) to none (σ=0.0) while the ground keeps it.
The top bar moved out of the scroller so it needs no fill, and the texture
runs under it. Grain, scanlines and dots gained sizes (1–3px grain; 2, 3, 4,
6px lines; 6, 8, 12, 16px dots), stepped rather than free so no pattern lands
off the pixel grid.

### Stage 1 — quick wins

Items 1–3 and 5–9. Independent of one another, small, and all things touched
daily. `with:` autofill carries the one Rust change in this stage.

**Built 2026-09-30 (v0.8.0).** Items 5 and 8 were done in Stage 0.

- **Select chevron** drawn in CSS with the same gutter as the text, in the
  theme's muted ink; a focused select keeps it.
- **Start meeting** is the full-width primary button, with its Enter hint.
- **The title** is a `>` prompt with a blinking block cursor while empty;
  the Modern family drops the field's box so it floats.
- **Rename is inline**: the row's menu or F2 in the library, double-click on
  a note's title. Not double-click in the list, where a click opens the
  meeting and telling the two apart would make every open wait.
- **Tags** complete from the library's own, most used first; Tab takes the
  first once something is typed.
- **Search autofill**: a bare word offers people, tags and filters; a `key:`
  word offers that key's values. `with:` matches any part of a name, and a
  filter name with no value yet is ignored rather than searched for.
  `NoteSummary` now carries `participants`.
- Found on the way: the gallery's fake `rename_note` edited the shared
  fixture, so a rename in one scenario leaked into every later one.

### Stage 2 — themes as data, then the builder

- A theme schema: palette, fonts, type role, case, frame, fill style, radius,
  ASCII style, default filter.
- The six built-ins migrate to it. The rendered result must be identical
  before and after — checked against the built CSS and the gallery, not the
  source.
- Pixel and display fonts bundled locally (candidates: VT323, Silkscreen,
  Share Tech Mono, Departure Mono — licences confirmed before adding).
- Number keys read the dynamic list.
- **The builder**, on top of the gallery's preview pane. Custom themes are
  JSON files in `~/Documents/TRACE/themes/`, so they are easy to back up,
  share, and edit by hand.

**2a built 2026-09-30 (v0.9.0), with a change of plan.** The built-ins
did not move their colours into script. Their tokens stay in themes.css,
because the type and case axes override a theme's fonts only by coming
later in the cascade (type.css after themes.css), and field and fill
defaults sit in unlayered `:root` rules; moving the values out would have
put that order at risk for nothing on screen. What became data is
everything else — one `THEME_DEFS` record of family, note, frame and type —
and the adjustments laid over a built-in, which is what the builder will
save. Checked: the six existing themes on four screens are pixel-identical
before and after, bar the signal panel's sweeping playhead.

- **Adjustments are per theme** (Q22): Reset per theme, an "adjusted" mark
  on its card, and the old global overrides moved onto the theme in use.
- **Number keys** run 1–9 then 0; new themes join the end so no key moves.

### Stage 3 — new themes

Written in the Stage 2 format.

- **`shell`** — GRiD Compass and the AI_MIND terminal. No boxes at all: rules
  drawn as `──`, buttons as `[ OK ]`, headers as inverse bars, a help line at
  the bottom. Amber by default; green is only a palette change.
- **`index`** — Simmonds Ltd. Pixel type, dense table rows, full-row inverse
  highlight, dotted scrollbars, a dotted frame around the window.
- **`council`** — Data Council. Slate ground, green grid lines, dot-pattern
  fills, inverse label blocks, pixel display type over a clean sans.
- **`vault`** — Pip-Boy. Green on olive-black, bracket-cornered tabs, stat
  bars, the scanline filter on by default.

`shell` needs a new frame value, `ascii`. A value, not a switch — nothing new
forks, which keeps within the budget `themes.css` sets out.

**Rough cuts built 2026-09-30 (v0.9.0)**, to be judged before polishing.
Keys 7, 8, 9, 0. Fonts bundled: VT323, Silkscreen, Share Tech Mono, Roboto
Condensed (all OFL). `vault` borrows the device's look and nothing of its
branding.

**Retired 2026-10-01, on review:** `console` and `council`. Eight themes
remain, on keys 1–8: terminal, report, industrial, termcn, graphite, shell,
index, vault. A saved choice of a retired theme falls back to terminal and
its adjustments are dropped.

**Rough cuts of teletext and scope (v0.10.0)**, from the ideas list. Keys 9
and 0. teletext: seven hard colours, blue story bands, a page number, the
Fastext colours along the status line, VT323 for Mode 7. scope: P31 green
over a 10 × 8 graticule scaled to the page, channel and timebase readouts
in the status line (in the page's corners they sat on the last list row).

### Stage 4 — command palette

After the themes, as `10-BACKLOG.md` already argues, so it is styled once.
Ctrl+Shift+T stays alongside it.

**Built 2026-10-01 (v0.11.0).** Notes from building it:

- One box (Q31): Start or Stop a meeting, the places, every theme with its
  number key, both families, Reset, every screen preset, and the gallery;
  then up to five meetings from the library's own search; then "Search
  meetings for…", which hands the words to the library and its filters.
  `>` keeps it to commands.
- Stop goes through the capture screen rather than straight to the
  backend, because the screen flushes the last half-second of typed notes
  before it stops.
- Ranking prefers a prefix, then a word start, then anywhere, then the
  letters in order, and gives labels more weight than the words behind
  them (`microphone` finds Settings, but below anything named so).
- The hidden commands answer exact input only. Three are new: `trace
  --coffee`, `trace --cloud` and `sudo trace` (09-EASTER-EGGS.md §18).
- Fun mode and the mini window will add their commands when they exist.

### Stage 5 — motion and joy

Hover scramble, press effects, fun mode, the narrator bar.

**5a, motion — built 2026-10-01 (v0.12.0).** Notes from building it:

- Motion is a per-family setting with three values named for what they do
  — `scramble`, `ripple`, `off` — rather than after the families, because
  a Motion choice called "retro" sat next to the Retro family button and
  nobody could tell them apart.
- The 0.97 push-in is gone from every control. Presses are drawn in a frame
  laid over the control, so nothing in the layout ever moves.
- One delegated listener finds controls by `.trace-press`; no component
  changed. The scramble writes to text nodes React owns, so it pins the
  label's width first and gives way if React rewrites the label mid-way.
- Checked mid-animation in headless Chrome with real mouse input. Two
  first drafts failed that check: the burst rose out of a 32px button and
  was clipped away unseen, and the ripple faded from its first frame and
  was too faint on graphite. Both fixed before commit.
- 5b — fun mode, the narrator and the eggs — is next.

### Stage 6 — audio visualisation

The Rust `audio-frame` event and FFT, the visualiser components, a full-screen
scope view during recording, and quieter versions on the library and idle
screens (the library already has each meeting's `signal` string to draw
from).

### Stage 7 — mini window

A second Tauri window: frameless, always on top, small. It shares capture
state with the main window through the existing status polling and events.

## Press effects

The current press is `scale(0.97)` on `.trace-press`. The replacement varies
by what was pressed:

- **Buttons** — a `▁▃▅▇▅▃▁` pulse from the cursor.
- **Cards** — a brief dither dissolve.
- **Selects** — a `>` caret snaps in.
- **Links** — `[ ]` brackets snap shut around the text.
- **Toggles** — `░▒▓█` fills like a relay closing.
- **Nav items** — a one-frame channel-change jitter.

Hover runs a typewriter scramble on the label. It renders over a hidden copy
of the final text, so a proportional font cannot shift the layout mid-scramble.

## Easter eggs not yet in `09-EASTER-EGGS.md`

Fun mode turns these up; a few survive at a low rate without it.

- Both streams loud at once: `CROSSTALK DETECTED`.
- Thirty seconds of silence: `…the room goes quiet`.
- Deleting a note plays an ASCII shredder.
- The Konami code: phosphor rain down the sidebar.
- Typing `trace` outside a field runs the boot sequence.
- Five idle minutes: a waveform screensaver.
- The wordmark clicked seven times opens a hidden changelog.
- A meeting started after midnight: `burning the midnight oil`.
- The hundredth meeting unlocks something.
- The narrator reacts to meeting events — counts and states only, never
  transcript text, the same rule `diagnostics.rs` keeps for the log.

## Open

- "There could be a lot more", as a request on its own, read as an invitation
  to add ideas rather than a truncated item. The press effects, the eggs, the
  Lissajous and the scope view are the answer so far.
- Which themes to retire, once the new ones can be compared in the gallery.
- From the Stage 0 prototypes: the alignment rule, the content column cap,
  the reading-text cap inside it, and the sidebar breakpoint.