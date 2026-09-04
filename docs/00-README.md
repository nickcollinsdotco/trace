# Local Meeting Notes App

A lightweight, local-first meeting capture and intelligence tool inspired by the best parts of Granola, but deliberately smaller, faster, and file-based.

Core idea:

> Capture a meeting with almost zero friction, let AI turn rough notes + transcript into useful structured notes, and store the result as ordinary Markdown files.

This is not an attempt to rebuild Notion.

## Product principles

1. **Local-first**
   - Meeting data should live on the user's computer.
   - Markdown is the canonical source of truth.
   - Avoid proprietary storage formats.

2. **Fast**
   - The app should feel close to instantaneous.
   - Avoid the heavy workspace/database UI patterns that motivated this project.

3. **Capture, don't manage**
   - The main job is capturing and understanding meetings.
   - Organisation should stay deliberately lightweight.

4. **Human + AI**
   - The user can type sparse notes during the meeting.
   - The transcript provides the raw material.
   - AI turns both into a polished result.
   - AI must not invent decisions, actions, attendees, facts, or confidence.

5. **Beautiful but restrained**
   - Modern, calm, premium surface.
   - A subtle retro terminal / CRT / vaporwave influence.
   - Retro should be used as a design language, not as a gimmick.

## Working title

No name is fixed yet. Treat the project name as a replaceable placeholder.

## North-star workflow

Open app
→ Start meeting
→ Capture microphone + system audio
→ Live transcription
→ Type only what matters
→ Stop meeting
→ AI generates structured notes
→ Markdown file is saved automatically
→ Search / revisit later

## Primary deliverable

A desktop application first. A browser UI can exist later as a companion or web renderer.

Recommended technical direction: Tauri + React/TypeScript, with platform-specific audio capture behind a small abstraction.

## Spec files

- `00-README.md` — overall project brief and principles
- `01-PRODUCT.md` — product definition and scope
- `02-ARCHITECTURE.md` — technical architecture
- `03-ROADMAP.md` — phased implementation plan
- `04-UX.md` — core UX
- `05-DESIGN-DIRECTION.md` — visual language
- `06-DATA-MODEL.md` — storage and data model
- `07-OPEN-QUESTIONS.md` — questions Claude should challenge
- `08-CLAUDE-AUDIT-PROMPT.md` — audit brief for Claude Code
- `09-EASTER-EGGS.md` — ASCII, terminal language, microcopy, and hidden interactions
