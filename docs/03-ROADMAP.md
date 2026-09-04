# Roadmap

## Phase 0: Technical spike

Goal: prove the hard part before polishing the UI.

Build a crude desktop prototype that can:

1. start/stop a session
2. capture microphone audio
3. capture system audio on the target OS
4. produce live transcript segments
5. write a simple Markdown file

No polished design.

### Exit criteria

A real Zoom/Meet call can be captured and turned into timestamped transcript text without manually uploading a recording.

This phase is the biggest technical risk and should happen first.

---

## Phase 1: Core MVP

Build:

- meeting list
- new meeting
- active meeting
- manual notes
- live transcript
- start/stop state
- AI enhancement
- Markdown persistence
- basic settings
- basic full-text search

Keep the UI intentionally sparse.

### Output

A usable personal tool for daily meetings.

---

## Phase 2: Make it feel excellent

Improve:

- startup speed
- keyboard shortcuts
- recording/transcription reliability
- editing experience
- meeting templates
- command menu
- search
- metadata
- Markdown rendering
- export/open-in-editor actions

Introduce the visual identity here, once the workflow is proven.

---

## Phase 3: Personal knowledge layer

Potential features:

- previous meeting context
- "what did we decide last time?"
- cross-meeting search
- people and company references
- recurring meeting history
- project folders
- action-item detection
- follow-up suggestions
- semantic search
- ask-your-meetings interface

The key constraint remains: files stay portable and the database remains reconstructible.

---

## Phase 4: Integrations

Only once the core experience is excellent:

- calendar
- Slack
- email
- Notion import/export
- GitHub
- Linear
- CRM
- automatic meeting detection

Integrations should enrich meeting context, not turn the app into a general business system.

---

## Phase 5: Optional web companion

Potential model:

```text
Desktop app
  └── local meeting capture

Browser/web UI
  └── browse/search/read/edit exported or synced notes
```

Do not allow the browser architecture to compromise the local-first desktop experience.
