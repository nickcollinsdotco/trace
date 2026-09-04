# Design Direction

## Overall direction

The visual language should combine:

**modern software precision**
+
**retro computing / terminal / CRT atmosphere**

Not nostalgia for its own sake.

The product should still feel like a premium modern tool.

## Visual references supplied for exploration

The reference set suggests several useful ingredients:

1. Dark surfaces with very subtle depth and almost-black gradients.
2. Monospace typography and terminal-style information density.
3. ASCII / bitmap / pixel details.
4. Old operating-system chrome and iconography.
5. Sparse green phosphor / amber-ish terminal cues used as accents.
6. Modern minimal mobile interfaces mixed with technical graphic systems.
7. CRT scanline / noise / grain ideas used very lightly.
8. Geometric grids, dotted patterns, and tiny system indicators.

## Recommended design principle

Think:

**"a beautifully designed instrument from an alternate 1987 that happens to run modern AI."**

Do not make it:
- cyberpunk
- hacker cliché
- neon overload
- fake terminal cosplay
- noisy all the time

## Surface

Default dark mode.

Potential base:
- near-black / charcoal
- slightly raised surfaces
- very subtle gradients
- extremely restrained shadows
- fine 1px borders

The first reference's dark shadow treatment is a useful cue: depth should come primarily from extremely subtle layered shadows and tonal separation rather than obvious glows.

## Typography

Use a hybrid:

### UI
A modern sans serif.

### Technical/system elements
A good monospace, potentially something in the Fragment Mono / Geist Mono / IBM Plex Mono family.

Do not force monospace on every piece of content.

The transcript, metadata, status labels, timers, keyboard hints and decorative system information are the strongest places for it.

## Accent

Explore one phosphor-like accent.

Candidates:
- muted green
- soft cyan
- restrained lavender
- warm amber

Avoid saturated gradients as the primary identity.

Accent should communicate state:
- active recording
- transcription
- successful save
- warning

## Pixel / CRT treatments

Use as micro-details:
- tiny raster patterns
- bitmap dividers
- dotted grids
- terminal cursor
- subtle scanline texture
- pixel icons

Never compromise readability.

Disable or reduce effects with `prefers-reduced-motion`.

## Animation

Animation should communicate system state.

Good:
- subtle recording pulse
- cursor blink
- transcript segment arrival
- processing indicator
- smooth panel transitions

Bad:
- constant decorative motion
- glitch effects every time something changes
- expensive canvas effects

## Information density

The product can tolerate higher information density than a consumer productivity app.

That is useful for:
- active meeting
- transcript
- system state

But the finished notes should become calm and readable.

## Key visual tension

A strong design system could deliberately switch modes:

### Capture mode
Technical.
Dense.
Monospace-heavy.
Instrument-like.
Live.

### Reading mode
Quiet.
Editorial.
Modern.
High readability.

That could become the defining interaction of the product.

## TRACE visual grammar

The visual language should use a small number of repeatable primitives rather than random terminal decoration.

Core primitives:

```text
TRACE_

● ACTIVE

[ OK ]

> SYSTEM MESSAGE

00:41:32

████████░░░░░

┌  SECTION
────────────────────────────────
```

Think roughly:

- 80% modern interface
- 15% terminal/system language
- 5% weird retro easter eggs

### Capture mode

Capture mode can be technical, dense and instrument-like:

```text
TRACE_

CLIENT ALPHA                         32:41
● CAPTURING

┌ NOTES ─────────────────────────────────────────

Need simpler onboarding
Pricing still unclear
Ask engineering about API constraints

┌ TRANSCRIPT ────────────────────────────────────

32:14  SARAH
I think the biggest issue is...

32:19  NICK
Yeah, because the setup...

┌ SIGNAL ────────────────────────────────────────

▂▃▅▇▆▄▃▂▁▂▄▆▇▅▃▂
```

### Reading mode

The finished notes should become calmer and more editorial. Terminal elements can remain in labels, metadata and section framing, but content readability takes precedence.

### Processing language

Use terse system messages rather than generic loading copy:

```text
TRACE / PROCESSING

[01] reading notes....................... ✓
[02] aligning transcript................ ✓
[03] resolving speakers................ ✓
[04] extracting decisions.............. ✓
[05] detecting action items............. ✓
[06] compressing context............... ███░░░

ANALYSIS COMPLETE

07 key points
03 decisions
04 action items
02 open questions

TRACE SAVED.
```

### Easter-egg policy

Easter eggs should be:
- rare
- discoverable
- harmless
- optional
- consistent with the fiction of TRACE being a small intelligent system

Never let an easter egg interrupt a real meeting or obscure important state.

See `09-EASTER-EGGS.md` for the concrete library.

