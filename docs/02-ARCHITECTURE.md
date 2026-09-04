# Technical Architecture

## Recommended stack

### Desktop shell
Tauri.

Reason:
- lighter footprint than Electron
- native capabilities through Rust
- suitable for a desktop utility
- web UI can still be React/TypeScript

Electron remains an acceptable fallback if ecosystem support materially reduces risk.

### UI
- React
- TypeScript
- Tailwind or a similarly lightweight styling system
- component primitives kept small and local

### Canonical storage
Plain Markdown files.

Example:

```text
~/Meeting Notes/
  2026/
    09/
      2026-09-04-client-alpha.md
      2026-09-04-team-sync.md
```

Use YAML frontmatter for structured metadata.

Example:

```md
---
id: 2026-09-04-client-alpha
title: Client Alpha
date: 2026-09-04
type: client
participants:
  - Nick
  - Sarah
tags:
  - onboarding
  - pricing
---

# Client Alpha

## Summary

...

## Decisions

...

## Action items

- [ ] Nick: ...

## Open questions

...

## Notes

...

## Transcript

...
```

## Indexing

Markdown files are canonical.

A local SQLite database can be used as an index/cache for:
- full-text search
- sorting
- metadata filtering
- relationship/navigation convenience

The database must be rebuildable from Markdown.

Never make SQLite the irreplaceable source of truth.

## Audio pipeline

Abstract the capture layer:

```text
Microphone ─────┐
                ├──> Audio capture abstraction
System audio ───┘
                         ↓
                    transcription
                         ↓
                  timestamped segments
```

The platform-specific implementation should be isolated from the rest of the application.

The app should not require joining Zoom, Meet, Teams, etc. as a participant.

## Transcription

Support a provider interface:

```ts
interface TranscriptionProvider {
  start(): Promise<void>
  stop(): Promise<void>
  onSegment(callback: (segment: TranscriptSegment) => void): void
}
```

Potential implementations:
- local Whisper / faster-whisper
- cloud transcription API

Do not tightly couple the app to one provider.

## AI pipeline

Use a provider interface:

```ts
interface MeetingIntelligenceProvider {
  enhanceMeeting(input: MeetingContext): Promise<MeetingDocument>
}
```

Input:
- user notes
- transcript
- metadata
- selected meeting template
- optional previous meeting context

Output should be structured data first, then rendered to Markdown.

Example conceptual schema:

```ts
type MeetingDocument = {
  summary: string
  keyPoints: string[]
  decisions: string[]
  actionItems: ActionItem[]
  openQuestions: string[]
  notes?: string
  quotes?: Quote[]
}
```

This avoids asking the model to generate arbitrary Markdown as the primary contract.

## Privacy

Design privacy modes from the beginning:

### Local
- local transcription
- local AI where practical

### Balanced
- local or platform transcription
- cloud LLM for synthesis

### Cloud
- cloud transcription
- cloud AI

The architecture should make provider choice replaceable.

## Audio retention

Default assumption:
- audio is transient
- transcription is retained
- raw audio is not retained unless the user explicitly enables recording

This keeps the product closer to a meeting-notes tool than a recording archive.
