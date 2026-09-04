# Product Definition

## Problem

Notion is useful but feels too heavy for this job. The desired workflow is a dedicated meeting tool that:

- starts instantly
- captures meetings without a bot joining the call
- gives a live transcript
- accepts lightweight manual notes
- produces high-quality AI notes
- stores everything as portable Markdown
- remains useful without becoming a general productivity suite

## Target user

Initially, this should be treated as a personal tool for a product/design professional who has frequent client, internal, discovery, review, and planning meetings.

Do not optimise the first version for teams, permissions, collaboration, or enterprise administration.

## Product loop

### Before meeting

Optional:
- meeting title
- meeting type
- participants
- project/client
- existing context
- meeting template

The user should be able to skip almost all of this.

### During meeting

Primary UI:
- elapsed time
- recording/transcription state
- manual notes canvas
- live transcript
- clear indication of microphone/system-audio state

The manual notes surface should feel like a frictionless scratchpad, not a rich text editor.

### After meeting

Generate:
- summary
- key points
- decisions
- action items
- open questions
- important context
- optionally notable quotes
- optionally suggested follow-ups

The generated result should remain editable.

## Meeting types

Initial templates:

### General
- Summary
- Key points
- Decisions
- Action items
- Open questions

### Discovery
- User/problem context
- Pain points
- Existing behaviour
- Needs
- Opportunities
- Quotes
- Open questions

### Client / project
- Objectives
- Feedback
- Decisions
- Scope changes
- Risks
- Action items
- Next steps

### Design review
- Feedback
- Decisions
- Questions
- Proposed changes
- Engineering implications
- Outstanding issues

### Sales / intro
- Needs
- Pain points
- Current solution
- Buying considerations
- Objections
- Timeline
- Next steps

Templates should be data, not hard-coded UI.

## Non-goals for v1

Do not build:
- full task management
- collaborative editing
- a Notion clone
- arbitrary database relations
- team workspaces
- complex permissions
- calendar replacement
- CRM
- mobile app
- native video recording
- elaborate project management

## Success criteria

A meeting should go from "nothing" to a useful Markdown document with almost no setup.

The app should be easier to open than Notion.
The user should never worry about where notes are stored.
The finished note should be useful both inside the app and outside it.
