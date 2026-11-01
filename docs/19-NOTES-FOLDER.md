# Notes folder selection — 0.42.0

Settings → Notes folder uses the existing native dialog. The destination must
exist, be empty, and sit outside the current folder, its parents and TRACE's
local application data. Canonical paths catch aliases and case differences.
Selection is persisted but does not copy files or switch the library in this
process. Meetings and background jobs can finish against the current root.
Fully quit TRACE (including its tray icon), then reopen it.

On launch, before windows or background jobs start, TRACE copies visible
Markdown files recursively, preserving relative paths and exact bytes. All
original files remain as a backup. Non-Markdown attachments and hidden entries
stay in the old folder; relative links to those attachments may need updating.
Raw audio and journals stay under `%LOCALAPPDATA%/TRACE/sessions`, independently
of the selected notes folder. Old pre-0.29 sessions are still discovered under
the original Documents/TRACE folder, even after the notes folder changes.

`%LOCALAPPDATA%/TRACE/notes-location.json` records the active and pending paths.
It is separate from forgiving ordinary preferences: a corrupt location file
refuses startup with an error instead of silently selecting Documents. A missing
selected drive is an error, not an empty library. The recording command checks
that the notes folder is writable before opening devices. A folder becoming
unavailable later still uses the existing journal-based recovery path.

Each copy is flushed into a newly created temporary file, then published with a
hard link that cannot replace an existing name. The temporary link is removed.
This requires a filesystem supporting hard links, such as NTFS. FAT/exFAT and
some shares are deliberately unsupported; failure retains the old active root.
The destination may be on another drive: the temporary file and its published
link are both on that destination drive. Source and destination are independent
copies, not hard links to one another.

Only after every copied file matches the source and a second scan agrees is the
active path committed atomically. A crash before that commit leaves the old
root active and the intent pending. Retry accepts only byte-identical completed
copies; any different file stops the change without replacing or deleting it.
Failed copies and crash-left temporary files remain in the destination. Cancel
only clears the pending preference, never deletes user files. The simple escape
route is to cancel and choose another empty folder. There is no automatic
rollback or cleanup that could accidentally erase an external edit.

A process-lifetime Windows file lock prevents two copies of this version from
sharing the preference and writing during migration. A second instance displays
an error asking the user to close the first. Older TRACE versions do not know
about this lock: close them and external editors before changing folders.
The final verification detects source changes during copying, but cannot stop
an unrelated editor changing a retained original immediately afterwards.
Symlinks, junctions and other reparse entries encountered in visible content
are refused conservatively; materialise cloud placeholders before copying.

All note-root consumers use CaptureManager's preference-aware root: library,
search, tags, writes, recovery, regeneration lookup, upgrades, diagnostics and
open-folder. Journal paths used by interrupted-note discovery and resume are
accepted only inside the active library; otherwise the session id locates the
copied note. `TRACE_NOTES_ROOT` remains a separate test override; its session
sandbox behaviour is unchanged and folder selection is disabled under it.

Verification uses temporary roots only. Unit tests cover byte preservation,
unknown files and audio staying put, collisions after partial progress, restart
and cancellation, changed originals, unavailable roots, unreadable files,
failed preference commit, unsafe paths and the Windows instance lock. UI tests
cover confirmation, picker cancellation, refusal and cancellation of a queued
change. Gallery states expose queued, failed and unavailable folders. Native
picker appearance, startup progress and cloud/removable filesystem behaviour
still require manual UI testing; no installed copy or real user data is used.

Verification recorded for this change:

- `pnpm lint`, `pnpm check`, `pnpm test`: pass; 33 files, 372 frontend tests.
- `cargo fmt --all --check`, `cargo clippy --all-targets -- -D warnings`,
  `cargo test`: pass; 421 Rust tests, plus main/doc-test targets.
- `pnpm build`: pass. The built index bundle contains all three new IPC
  commands, confirmation/cancellation text and 0.42.0. The gallery bundle
  contains all three new failure/pending scenarios. Built CSS contains
  `break-all`, `flex-wrap`, button and error rules used by the control.
- Mutation checks: allowing `.sessions` into the copy failed the exclusion
  assertion; accepting the old journal path failed the active-folder assertion;
  saving before confirmation failed the UI tests. All mutations were restored.
- Frontend tests emitted one existing `NoteScreen` `act(...)` warning in the
  gallery title-scroll test. All tests passed. No visual browser/native-dialog
  verification, installer changes, live migration, device recording or release.
