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

**Motion parked, 2026-10-01.** A first cut (PR #18, branch
`stage-5a-motion`, closed unmerged) built a per-family Motion setting:
labels that scrambled on hover, presses that flashed and burst into block
characters or rippled. Tried in the app, the scramble broke fields and
buttons — it pinned each label's width while it ran, and controls whose
width follows their content resized around it — and the set as a whole was
louder than wanted. All hover and press motion now waits for a prototype
pass of its own; see "Hover and press motion" in `10-BACKLOG.md`. The 0.97
push-in stays until then.

**5b, fun mode — built 2026-10-01 (v0.13.0; 0.12.0 was the parked motion
branch, so it is skipped rather than reused).** Notes from building it:

- **Fun mode** is one app-wide switch, off by default, on the Appearance
  page and in the palette. On, it starts the narrator and plays the boot
  sequence at launch.
- **The narrator** takes the status bar's spare room, after the model
  pickers, and steps aside whenever a job is running or no speech model is
  installed. Deadpan lines about places, themes and the meeting — started
  (with its own line after midnight), every hundred segments, crosstalk
  (both channels above −34 dBFS for three seconds, then not again for two
  minutes), a quiet room (both below −48 dBFS for thirty seconds), stopped
  — and an idle line at most once a minute. Never a word of what was said,
  and no idle line claims the microphone is open.
- **The secrets answer in any mode**, because finding one should not depend
  on a setting: the Konami code (phosphor rain), typing `trace` outside a
  field (the boot sequence), seven clicks on the wordmark (the found
  README), and the palette's hidden commands. None of the big ones plays
  over a recording.
- **Not yet:** the shredder on delete, the screensaver, and the hidden theme
  at the hundredth meeting. All three are still wanted; each needs a design
  of its own rather than a quick cut.

### Stage 6 — audio visualisation

The Rust `audio-frame` event and FFT, the visualiser components, a full-screen
scope view during recording, and quieter versions on the library and idle
screens (the library already has each meeting's `signal` string to draw
from).

**Built 2026-10-01 (v0.14.0).** Notes from building it:

- **A command, not an event.** `scope_frame` returns each stream's newest
  512 samples and the scope asks for it about thirty times a second, only
  while one is on screen and the window is visible. An event would have
  streamed samples whether or not anything was drawing them.
- **The capture side takes no lock.** Every stream already passes its mono
  samples through `record_level`; that now also writes them, one in four
  (about 12kHz), into a 1024-sample ring of atomics. A mutex the reader held
  at the wrong instant would make the microphone drop a buffer.
- **The FFT is in TypeScript**, 512 points with a Hann window, folded into
  32 log-spaced bands from 80Hz to 6kHz. The Rust surface stays samples only.
- **Three modes, remembered:** wave (you above, them below, each with a
  gain that follows the voice), spectrum (you up, them down) and xy (you
  across, them up, lightly smoothed so hiss does not drown the figure).
  You are the accent colour and them the muted ink, as in the transcript.
- **The strip** sits under the header, 96px, with its controls on a row of
  their own; **the scope view** covers the recording screen with one line
  for notes — Enter appends it, Escape goes back.
- **Found while building it:** the recording screen focused the notes field
  on every status poll, once a second, pulling focus out of anything else.
  It now does so once, when recording begins.
- **Not yet:** quieter versions on the library and idle screens. Those
  never open the microphone (Q30), so they want a design for drawing from
  stored envelopes rather than this live path.

### Stage 7 — mini window

A second Tauri window: frameless, always on top, small. It shares capture
state with the main window through the existing status polling and events.

**7a built 2026-10-01 (v0.15.0).** Notes from building it:

- **Opened** from a button at the foot of the sidebar, from Ctrl+K, and from
  Ctrl+Alt+R anywhere (`tauri-plugin-global-shortcut`, registered in Rust;
  if another app owns the combination it is logged and the app carries on).
  Idle, it opens expanded with the name field focused; recording, as the bar.
- **One bar, 360×56, idle or recording** — revised after a first cut had a
  taller idle window that jumped when a meeting started. The name field
  sits where the meeting's name will be and the round red Start exactly
  where the held Stop will; the same three icons (waveform, back, close)
  show in every state so nothing shifts. Shaped after Spotify's, Apple
  Music's and Recordly's mini players: one round button carries it, the
  secondary icons fade in on hover. No recording dot — Stop and the
  waveform already say it. The waveform is faint and can be switched off,
  remembered. Opens against the right edge in the lower third of the main
  window's monitor; only the ⠿ grip drags it.
- **It grows rather than wraps.** Themes in capitals or wide typefaces made
  the saved message wrap onto a second line inside the 56px bar. Text never
  wraps now; the bar measures itself and widens leftwards, keeping its right
  edge, up to 640px, and returns to 360px once its content fits again.
- **Minor controls live in an options menu (⋮)**, as Recordly's do, not in
  buttons of their own: the waveform switch, the extended view, and whether
  it is hidden from screen shares (now a live switch, `protect_mini`). The
  menu and the details row stack above the bar; the window grows up and to
  the left to hold them, keeping its bottom-right corner, so the bar never
  moves. **The extended view** names the microphone and the transcription
  model — the meeting's own, from the capture status, which now reports
  both — and the segment count. **Parked:** one width per theme, set by its
  widest state, so a bar pinned in a corner never changes size
  (`10-BACKLOG.md`).
- **Hidden from screen shares** (`content_protected`), and created afresh
  and closed rather than hidden and re-shown — the black-rectangle bug on
  build 19045. **Not yet checked against a real Teams share.**
- **Hold to stop**, 600ms, by pointer or by Space/Enter held; a click alone
  turns the label to "hold". After it: `✓ saved · writing notes… [open]`,
  TRACE flashes in the taskbar with the note already open in it, and the
  mini window closes itself four seconds later.
- **Both windows hear each other:** start, stop and abort announce
  `trace://capture-changed`, so the main window's recording screen reloads
  when a meeting starts or stops from the mini window.
- **For the scope's second visit:** at 190px the bar's waveform aliases
  into a sawtooth; a rolling level would read better at that size.

**7b built 2026-10-01 (v0.16.0).** Notes from building it:

- **It opens by itself only during a meeting**, by Settings → Mini window:
  only when asked (the default), when TRACE is minimised, when TRACE is
  minimised or loses focus to another app, or from the moment a meeting
  starts. The rules are one pure function, `windows::auto_open`, tested
  case by case; the main window's focus and resize events feed it.
- **Opened by itself, it never takes focus** — the call keeps the keyboard.
  Coming back to TRACE closes a window that opened itself, unless the
  setting is Always; one opened by hand stays until it is closed.
- **The offer** is asked once, inline on the mini window, the first time
  TRACE is minimised in a meeting with the setting still off: "Open this
  whenever you switch away from TRACE?" Yes sets When I switch away; either
  answer is final and recorded, and Settings can change it later.
- **It snaps** to 16px from a screen edge when dropped within 28px of one,
  once it has been still for 350ms, so a drag is never fought mid-move.
- **It remembers its place per monitor**, by its bottom-right corner, so
  growing for the menu or the saved message never knocks it off a spot. A
  place that no longer fits on screen (a resolution change) falls back to
  the default against the right edge.
- **Hiding from screen shares stays a switch in its options menu**, not a
  Settings entry: it is on by default and the one moment it matters is
  mid-call, where the menu already is.
- **Not built:** the start sequence and its sound, which belong to the
  sounds work.

### After using it: the feedback round (2026-10-01)

Thirty notes from a week in the installed app, ordered into seven pull
requests. Decided with Nick: every theme stays until later testing; theme
#1 becomes **Carbon**, in the Modern family; the shortcut default is
Ctrl+Shift+Alt+M; Sort's main button reverses the order and its arrow picks
what to sort by, rather than cycling through four.

1. **Never lose the mini window** — built, v0.17.0, notes below.
2. **Quick fixes:** the black space under the app, no top bar on pages with
   nothing in it (translucent, blurred where there is one; a fade in the
   retro themes), scanlines up to 24px, flicker removed, the easter-egg
   box's ragged edge, cursors in their text's colour, Shell's TYPE, reset
   buttons at a box's top right.
3. **Design-system pass:** four levels of text in every theme, 32–36px
   buttons, one typing indicator per field, capitals as one ladder (none →
   labels → navigation → headings) that tags follow, Carbon.
4. **Appearance:** each preview in its own theme's type, not the current
   one's; a list with one large preview that follows hover; the theme's own
   font first as its default; flavour text per theme.
5. **Library:** tags, sort, filters and view on one bar; the sort button.
6. **Mini window, second pass:** the menu floating free of the bar, a faint
   grid when the waveform has nothing to draw, the details view sized to
   its text.
7. **Scope:** smoothed and slowed, XY replaced by a spectrograph, the
   panel at the content's width; the narrator centred in the status bar
   with the two model chips made one.

**Phase 1, built (v0.17.0):**

- **Why it disappeared.** Dragged between a 100% and a 150% screen,
  Windows rescales the window and nothing re-fits it — the page only
  measures itself when its content changes. It lost a third of its height
  each crossing until there was nothing left; a theme change made it
  measure again, which is why it came back. Rust now holds the size the
  content asked for and puts it back whenever a move or a scaling change
  settles.
- **The way back from anywhere:** a ↺ beside Mini window in the sidebar on
  hover, "Bring the mini window back" in Ctrl+K, and Settings → Mini window
  → Position. All forget the remembered places and return it to the
  default spot. Asking for it by any route also brings it back if it is off
  every screen. **Kept at the right edge rather than bottom centre:** bottom
  centre is where Teams, Zoom and Meet put their own controls.
- **The shortcut is a setting**, recorded by pressing it. Ctrl, Alt or the
  Windows key is required — Shift alone would take capital letters from
  every other app. A combination another app holds is refused with the old
  one kept; one that was taken at startup is said in Settings and left out
  of every hint, so nothing promises a shortcut that does nothing.
- **Switches, not ticks,** in the mini window's options menu: each is a
  state left on or off.
- **Focus rings for the keyboard only** in the mini window. The end of a
  drag hands focus back to the window, and the browser ringed the last
  button as though Tab had been pressed.
- **Found on the way:** `.trace-field` is unlayered, so Tailwind's `w-auto`
  on it never applied — Settings' microphone list has always been full
  width despite asking not to be. `.trace-field-fit` does what `w-auto`
  could not; the microphone list is left for phase 3.
- **TRACE was already in the taskbar** when minimised; nothing hides the
  main window. Checked rather than built.

**Phase 2, built (v0.17.1):**

- **The black band under the app** was the refresh bar. It rolls down to
  140% of the page, and moved content still counts towards what can be
  scrolled, so the whole window grew a scrollable tail. The canvas clips
  now (`overflow: clip`, which does not make it a scroll container).
  Measured in the build: 16px of overflow without the clip at one moment of
  the roll, none with it.
- **The top bar lives inside the scroller.** Where a page has one, it
  sticks and the page passes beneath it — translucent and blurred in the
  modern family, a solid ground the page fades into in the retro one. Where
  a page has none, its reserved height scrolls away with the content, so
  nothing is sliced off at an invisible edge. Teletext's `position:
  relative` on the bar had to go: it beat `sticky`.
- **Type does something in Shell, Teletext, Index and Scope.** Each set its
  *sans* family to its own monospace face, so moving text between sans and
  mono changed nothing. Their default role is already mono, which looks the
  same; hybrid and sans now reach a proportional face. A test keeps any
  theme from doing it again.
- **The found file's frame is a border.** Most themes' fonts have no
  box-drawing characters; the fallback's were another width, and the right
  edge came out ragged.
- **Cursors that speak rather than ask** — the narrator's, the SIGNAL
  caption's — blink in their own text's colour, not the accent.
- **A section's actions sit at the box's other corner**, cut into the
  border like its title, instead of beside the title where Reset was easy to
  miss.
- **Scanlines go to 24px; flicker is gone.**

**Phase 3a, built (v0.19.0)** — the design-system pass, split in two: this
half is the parts that change what things are; 3b gives buttons one set of
classes, and with them the size and the capitals ladder.

- **Carbon.** `terminal` is renamed, and moves to Modern: no prompts, the
  filled pill, the green kept. A saved `terminal` — the theme, a family's
  memory of it, its adjustments — reads as Carbon (`themeId`).
- **Text hierarchy, measured.** `contrast.test.ts` holds every theme to
  ink ≥ 7:1, muted ≥ 4.5:1 and faint ≥ 3:1 on the grounds text sits on,
  each a step of at least 1.35× below the last. Nine already passed.
  Teletext's three levels were all near full brightness (21, 16.7, 15.3), so
  a model's description in its picker read as loudly as the model; it is
  now white, green, and cyan at two-thirds — the one place it leaves the
  seven colours. Disabled stays faint at reduced opacity.
- **One typing indicator.** Each theme says whether its fields are a `box`
  or a `line`. The meeting title floats in every theme, as it did in
  Modern — a `>` and a blinking block are one prompt; the box was the
  third thing. A boxed search field shows the magnifier instead of the `>`;
  a line keeps the `>`.
- **Widths that work.** `.trace-field`'s 100% moved into the components
  layer, so `w-auto`, `w-36` and `w-16` on a field finally apply. The
  microphone list also needed `self-start` — a column stretches its
  children whatever their width says.

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