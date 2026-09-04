# Claude Code Audit Prompt

You are taking over a new project proposal for a lightweight local-first AI meeting notes application.

Read all markdown files in this repository before proposing implementation.

The concept is inspired by Granola's meeting workflow but intentionally aims to remain much smaller than Notion.

## Your task

Do not blindly implement the existing plan.

First:

1. Audit the product assumptions.
2. Audit the proposed architecture.
3. Identify technical risks, especially audio capture, transcription reliability, local persistence, and AI synthesis.
4. Challenge anything that is over-engineered.
5. Identify anything important that has been omitted.
6. Recommend changes that materially improve reliability, speed, UX, privacy, or maintainability.
7. Separate "must solve before MVP" from "interesting later".
8. Preserve the core principle that Markdown is the canonical source of truth.

## Critical product constraint

The app must not accidentally become Notion.

When evaluating a feature, ask:

> Does this make capturing, understanding, or retrieving meetings meaningfully better?

If not, it probably belongs later or should not exist.

## Critical engineering constraint

The first technical milestone is audio capture + transcription.

Do not spend substantial effort polishing UI before proving:

- microphone capture
- system audio capture
- reliable timestamped transcription
- persistence
- recovery from interruptions

Build a technical spike first.

## Design instruction

The provided visual direction is:

- premium modern dark UI
- terminal / retro computing influence
- subtle CRT / pixel / ASCII details
- restrained phosphor-like accent
- strong typography
- technical capture mode
- calm editorial reading mode

Treat those references as a starting point, not a fixed specification.

You should challenge whether the retro aesthetic improves the product and define a coherent design system rather than layering random effects on top.

## Deliverables from this audit

Before writing significant application code, produce:

### 1. Recommended architecture
Include:
- stack
- desktop shell
- audio architecture
- transcription architecture
- AI architecture
- storage
- indexing/search
- settings/secrets
- testing strategy

### 2. MVP definition
A brutally small list of what must exist for the first useful release.

### 3. Risk register
For every major risk:
- likelihood
- impact
- mitigation
- whether it blocks MVP

### 4. Revised roadmap
Sequence work according to technical risk rather than visual excitement.

### 5. UX critique
Challenge:
- navigation
- capture UI
- note/transcript relationship
- post-meeting flow
- search
- failure states

### 6. Design system proposal
Define:
- type
- spacing
- surfaces
- borders
- shadows
- accent
- pixel/CRT treatment
- motion
- capture vs reading modes

### 7. Decisions log
For every major architectural decision, explain:
- decision
- alternatives considered
- why this wins
- reversal cost

### 8. Build plan
Break the first implementation into small verifiable milestones that can each be tested independently.

## Development behaviour

Prefer boring, reliable foundations.

Do not:
- add dependencies without a reason
- invent abstraction layers prematurely
- build generic design-system infrastructure before screens need it
- add cloud services merely because they are convenient
- make SQLite canonical
- create a large backend for a single-user local application

Do:
- keep provider interfaces narrow
- keep platform-specific code isolated
- make the data model explicit
- write tests around persistence and parsing
- make failures recoverable
- keep the app fast

The end result should feel like a small, exceptionally well-made instrument rather than a miniature SaaS platform.
