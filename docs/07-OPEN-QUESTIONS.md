# Open Questions for Claude

Claude should actively challenge this proposal before implementation.

## Architecture

1. Is Tauri actually the right choice for reliable microphone + system audio capture on Windows and macOS?
2. Which audio capture APIs/libraries are mature enough for a personal production tool?
3. Is Electron worth accepting for ecosystem maturity?
4. Should transcription be local by default or cloud by default?
5. What is the best low-friction local transcription stack in 2026?
6. How should audio be buffered so a temporary transcription outage does not lose text?
7. How should the app recover after laptop sleep, crashes, or OS audio-device changes?

## AI

1. What model should handle meeting synthesis?
2. Should transcription cleanup and meeting synthesis be separate model passes?
3. How should hallucinations be constrained?
4. Can action-item extraction include evidence/timestamps so users can verify them?
5. Should generated notes be stored separately from user-authored notes?
6. What is the best context strategy for using previous meetings without creating a giant prompt?
7. How should the app distinguish decisions from discussion?

## UX

1. Should notes and transcript be side-by-side, stacked, or switchable?
2. Should the transcript be visible during every meeting or hidden by default?
3. What is the absolute minimum meeting setup?
4. Should meeting type be selected before recording or inferred afterward?
5. Should the app auto-title the meeting?
6. What should happen immediately after a meeting ends?
7. How can the app preserve the feeling of Granola's "just start taking notes" experience without copying its interface?

## Files

1. Where should the Markdown directory live by default?
2. Should users choose the directory on first launch?
3. Should attachments/assets live next to Markdown?
4. How should filenames be generated safely?
5. How should renaming work?
6. What happens if the user edits Markdown outside the app?
7. How should Git compatibility be handled?
8. Should YAML frontmatter be the schema, or should another format be considered?

## Search

1. Is SQLite FTS sufficient for v1?
2. When is semantic search worth adding?
3. Can embeddings be stored locally without materially increasing complexity?
4. What metadata deserves first-class filters?

## Privacy

1. Exactly what data leaves the machine in each privacy mode?
2. What telemetry, if any, should exist?
3. How should secrets/API keys be stored?
4. What should the app promise about raw audio retention?
5. What UI warnings are necessary when using cloud transcription or AI?

## Visual design

1. Is the retro/terminal direction too strong?
2. Which elements should actually be pixel/CRT inspired?
3. How do we stop dark UI from becoming visually muddy?
4. Should the accent be green, cyan, lavender, amber, or something else?
5. Should capture mode and reading mode have distinct visual identities?
6. What type choices best balance character and readability?

## Product scope

1. What is the smallest product that would genuinely replace Notion for meeting notes?
2. Which features are deceptively expensive and should be postponed?
3. What is likely to become the "killer feature" after basic capture works?
4. Which parts of Granola's workflow are actually essential versus incidental?
5. What should never be added because it would recreate the complexity we are trying to escape?
