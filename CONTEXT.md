# TRACE

Local-first meeting capture: two audio streams in, on-device transcript and
structured notes out. This glossary fixes the words used for the app's
appearance and behaviour, so the UI, the code and the docs say the same thing.

## Language

### Appearance

**Theme**:
A named set of design choices — palette, fonts, letter case, framing, fills
and motion style — that re-skins the whole app. Picking a theme always gives
the same result.
_Avoid_: Look, style, skin

**Built-in theme**:
A theme that ships with TRACE. It can be adjusted, and Reset returns it to
how it shipped.

**Adjustment**:
A change the user has made to one built-in theme. It stays with that theme
and never carries over to another.
_Avoid_: Override, tweak

**Custom theme**:
A theme the user made, always starting from another theme it is based on.
Made deliberately ("Save as new theme"), never as a side effect of adjusting.
_Avoid_: User style, edited copy

**Family**:
The voice a theme speaks in: _Retro_ (prompts, box corners, system capitals)
or _Modern_ (none of those). Every theme belongs to exactly one. A family
also carries defaults for screen filter, motion, UI sound and density.
_Avoid_: Terminal (the family — `terminal` is a theme), language, mode

**Appearance**:
Everything currently applied to the screen: the active theme, its family's
settings, and the app-wide settings that belong to neither.

**Content column**:
The centred area every page's content sits in. The same width in every theme
and family, so switching never moves it.
_Avoid_: Measure (for the page width)

**Screen**:
The glass the page is shown through: a mix of screen effects. Each family
keeps its own. Drawn on the page only — the sidebar and status bar sit
above it, untouched.
_Avoid_: Screen filter, CRT mode

**Screen effect**:
One part of a screen — grain, scanlines, a dot grid, a vignette, glow,
flicker, a refresh bar — with its own amount. Textures can sit **over** the
content or **behind** the letters, where they never touch one.

**Screen preset**:
A named mix of screen effects to start from. Moving any effect makes the
screen the user's own.

**Density**:
How much space the interface leaves between things. Each family has a
default — tight for Retro, roomy for Modern — fine-tuned under Advanced. It
never changes the content column.
_Avoid_: Spacing (as a theme setting)

**Motion**:
How controls respond to hover and press: scramble and ASCII presses for
Retro, fades and ripples for Modern. Set per family.

**UI sound**:
A short, quiet sound acknowledging something the user did. Each family has
its own set. Never plays while a meeting is being recorded, because the
recording would hear it.
_Avoid_: Sound effect, SFX

**Gallery**:
A separate window showing every screen in every state, failures included,
against sample data, so nothing has to be recorded to see it.
_Avoid_: Storybook, fixtures (as a user-facing name)

**Build mode**:
The gallery with the theme editor open beside it. Where a theme is taken
apart; the Appearance page is where one is chosen.
_Avoid_: Theme builder (as a place), editor mode

### Play

**Fun mode**:
An app-wide switch that makes easter eggs frequent, gives motion more
character and hands the status bar to the narrator.
_Avoid_: Hacker mode

**Narrator**:
The running commentary on what the app is doing, shown in the status bar in
fun mode. It speaks about events and counts, never about what was said.

**Easter egg**:
A rare, playful response to something the user did or something that
happened. During a meeting, only eggs about the meeting itself may appear,
and only in the narrator.

### Capture

**Start sequence**:
The brief flourish of text, animation and sound between asking to start a
meeting and recording beginning. The same wherever a meeting is started, and
skippable.
_Avoid_: Countdown, pre-roll

**Scope strip**:
The live visualisation of both audio streams shown above the notes during a
meeting.

**Scope view**:
The full-screen visualisation of a meeting in progress, with a single-line
notes prompt so writing never stops.
_Avoid_: Visualiser mode

**Mini window**:
A small window floating above all others that shows a meeting in progress
and can start or stop one.
_Avoid_: Widget, mini player, overlay
