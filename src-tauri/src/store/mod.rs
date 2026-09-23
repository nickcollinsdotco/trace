//! Persistence.
//!
//! Markdown files are the canonical record. Everything else — the journal, and
//! later the search index — is derived and rebuildable.
//!
//! ```text
//! ~/Documents/TRACE/
//!   2026/09/2026-09-05-client-alpha.md     <- canonical
//!   .sessions/<session-id>/
//!     session.jsonl                        <- crash journal
//!     mic.wav, system.wav                  <- transient audio
//! ```

use std::path::PathBuf;

pub mod context;
pub mod journal;
pub mod markdown;
pub mod paths;
pub mod search;
pub mod tags;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("serialisation failed: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("journal has no session_started event")]
    NoSessionStart,
    #[error("could not determine the notes directory")]
    NoNotesDir,
    #[error("malformed note at {path}: {reason}")]
    MalformedNote { path: PathBuf, reason: String },
}

/// A session found on disk that was never finished.
#[derive(Debug)]
pub struct Recoverable {
    pub session_dir: PathBuf,
    pub replay: journal::Replay,
}

/// Find sessions whose journals were never closed.
///
/// Called on launch. A session with a journal but no `session_ended` event is
/// a meeting that was interrupted — by a crash, a lost battery, or a forced
/// quit — and its contents are still recoverable.
///
/// Errors on individual sessions are skipped rather than propagated: one
/// unreadable journal must not hide every other recoverable meeting.
pub fn scan_recoverable(notes_root: &std::path::Path) -> Vec<Recoverable> {
    let sessions = paths::sessions_root(notes_root);
    let Ok(entries) = std::fs::read_dir(&sessions) else {
        return Vec::new();
    };

    let mut found = Vec::new();
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        match journal::replay(&dir) {
            Ok(replay) if !replay.was_finished => {
                found.push(Recoverable {
                    session_dir: dir,
                    replay,
                });
            }
            _ => {}
        }
    }

    // Newest first: the most recent interruption is the one the user remembers.
    found.sort_by(|a, b| b.session_dir.cmp(&a.session_dir));
    found
}

/// Rewrite an existing note in place.
///
/// Used by the accurate re-pass and by synthesis, which must replace the note
/// already written rather than creating a second file beside it.
///
/// The title, tags, context and names on disk win over the journal's. All are
/// edited in the file directly — see `context::apply_edits` — so replaying the
/// journal verbatim quietly undid a rename and dropped every tag the moment
/// notes were regenerated.
pub fn rewrite_note(
    path: &std::path::Path,
    meeting: &crate::meeting::Meeting,
) -> Result<(), StoreError> {
    let mut meeting = meeting.clone();
    if let Ok(existing) = std::fs::read_to_string(path) {
        context::apply_edits(&mut meeting, &existing);
    }
    paths::write_atomic(path, &markdown::serialize(&meeting))
}

/// Write a meeting to its canonical Markdown file.
///
/// Returns the path written. Uses a unique filename so two meetings sharing a
/// title on the same day cannot overwrite one another.
pub fn write_note(
    notes_root: &std::path::Path,
    meeting: &crate::meeting::Meeting,
) -> Result<PathBuf, StoreError> {
    let path = paths::unique_note_path(notes_root, &meeting.date, &meeting.title);
    paths::write_atomic(&path, &markdown::serialize(meeting))?;
    Ok(path)
}

/// Remove a session directory entirely, journal included.
///
/// For sessions the user chose to discard. Never automatic after a successful
/// save — see `discard_session_audio`.
pub fn discard_session(session_dir: &std::path::Path) -> Result<(), StoreError> {
    std::fs::remove_dir_all(session_dir)?;
    Ok(())
}

/// Delete a finished session's audio but keep its journal.
///
/// The two have wildly different costs and lifetimes. Audio is roughly 690 MB
/// per hour and is useless once transcribed; the journal is a few kilobytes
/// and is the only structured record of the meeting once the Markdown has been
/// written — the note body is deliberately never re-parsed, so without the
/// journal there is nothing to regenerate notes *from*.
///
/// Keeping it is what makes regeneration possible at negligible cost.
pub fn discard_session_audio(session_dir: &std::path::Path) -> Result<(), StoreError> {
    let entries = match std::fs::read_dir(session_dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|e| e == "wav") {
            let _ = std::fs::remove_file(&path);
        }
    }
    Ok(())
}

/// Delete audio from all but the newest `keep` sessions that still have it.
///
/// Called after each meeting under "keep latest N". Only audio goes; journals
/// stay, so every note can still be regenerated.
pub fn prune_session_audio(sessions_root: &std::path::Path, keep: usize) {
    let Ok(entries) = std::fs::read_dir(sessions_root) else {
        return;
    };
    let with_audio: Vec<String> = entries
        .flatten()
        .filter(|e| has_audio(&e.path()))
        .filter_map(|e| e.file_name().to_str().map(str::to_string))
        .collect();

    for id in sessions_to_strip(with_audio, keep) {
        let _ = discard_session_audio(&sessions_root.join(id));
    }
}

fn has_audio(dir: &std::path::Path) -> bool {
    std::fs::read_dir(dir).is_ok_and(|entries| {
        entries
            .flatten()
            .any(|e| e.path().extension().is_some_and(|x| x == "wav"))
    })
}

/// Which sessions lose their audio, oldest first.
///
/// Session ids are `sess-<epoch millis>`, so the number orders them. Sorted
/// numerically rather than as text, which would put `sess-999` after
/// `sess-1000`; anything unparseable sorts as oldest, so an unknown directory
/// is never what survives at the expense of a real recording.
pub fn sessions_to_strip(mut with_audio: Vec<String>, keep: usize) -> Vec<String> {
    let age = |id: &String| {
        id.strip_prefix("sess-")
            .and_then(|n| n.parse::<u64>().ok())
            .unwrap_or(0)
    };
    with_audio.sort_by_key(age);
    let strip = with_audio.len().saturating_sub(keep);
    with_audio.truncate(strip);
    with_audio
}

/// Locate the journal behind a saved note.
///
/// The note's frontmatter carries the session id it came from, which is what
/// links a Markdown file back to its structured record.
pub fn session_for_note(notes_root: &std::path::Path, session_id: &str) -> PathBuf {
    paths::session_dir(notes_root, session_id)
}

/// Delete a saved note, and the session behind it.
///
/// Both, deliberately. Leaving the journal would mean a deleted meeting still
/// had a full transcript on disk — the opposite of what "delete" means to
/// anyone who asked for it. The session is best-effort: an already-cleaned
/// session is not a failure, and the note is what the user pointed at.
pub fn delete_note(
    notes_root: &std::path::Path,
    note_path: &std::path::Path,
) -> Result<(), StoreError> {
    if let Ok(text) = std::fs::read_to_string(note_path) {
        if let Some(id) = crate::store::markdown::frontmatter_value(&text, "id") {
            let _ = discard_session(&session_for_note(notes_root, &id));
        }
    }

    std::fs::remove_file(note_path)?;
    Ok(())
}

/// Rename a saved note, moving the file to match its new title.
///
/// The filename carries the title as a slug, so a rename that changed only the
/// frontmatter would leave the two disagreeing — and the filename is what the
/// user sees in their own file browser, which is where a Markdown-on-disk
/// product has to stay honest.
///
/// Returns the new path. `unique_note_path` picks it, so renaming onto a name
/// that already exists appends a suffix rather than destroying the other note.
pub fn rename_note(
    notes_root: &std::path::Path,
    note_path: &std::path::Path,
    new_title: &str,
) -> Result<PathBuf, StoreError> {
    let title = new_title.trim();
    if title.is_empty() {
        return Err(StoreError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "a note needs a title",
        )));
    }

    let text = std::fs::read_to_string(note_path)?;
    let date = crate::store::markdown::frontmatter_value(&text, "date").unwrap_or_default();
    let updated = markdown::replace_title(&text, title);

    let target = paths::unique_note_path(notes_root, &date, title);
    if target == note_path {
        paths::write_atomic(note_path, &updated)?;
        return Ok(target.clone());
    }

    // Write first, remove second. A crash between the two leaves both copies,
    // which is recoverable; the other order can lose the note entirely.
    paths::write_atomic(&target, &updated)?;
    let _ = std::fs::remove_file(note_path);
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A scratch notes root. Matches the convention in `audio::wav`'s tests
    /// rather than adding a dependency for four tests.
    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("trace-store-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn a_meeting(id: &str, title: &str) -> crate::meeting::Meeting {
        let mut m = crate::meeting::Meeting::new(id, title);
        m.date = "2026-09-06".into();
        m
    }

    #[test]
    fn only_the_newest_recordings_keep_their_audio() {
        let ids = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let strip = sessions_to_strip(ids(&["sess-1000", "sess-999", "sess-3000", "sess-2000"]), 2);
        // Numeric, not lexical: sess-999 is the oldest.
        assert_eq!(strip, ids(&["sess-999", "sess-1000"]));
        assert!(sessions_to_strip(ids(&["sess-1"]), 5).is_empty());
        assert_eq!(
            sessions_to_strip(ids(&["sess-1", "junk"]), 1),
            ids(&["junk"])
        );
    }

    #[test]
    fn pruning_removes_audio_and_keeps_the_journal() {
        let root = scratch("prune");
        for id in ["sess-100", "sess-200", "sess-300"] {
            let dir = root.join(id);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("mic.wav"), b"x").unwrap();
            std::fs::write(dir.join("session.jsonl"), b"{}").unwrap();
        }

        prune_session_audio(&root, 1);

        assert!(!root.join("sess-100/mic.wav").exists());
        assert!(!root.join("sess-200/mic.wav").exists());
        assert!(root.join("sess-300/mic.wav").exists());
        assert!(root.join("sess-100/session.jsonl").exists(), "journal kept");
    }

    #[test]
    fn rewriting_keeps_a_rename_and_tags_made_since_the_note_was_written() {
        // Regeneration replays the journal, which never hears about either.
        let root = scratch("rewrite-keeps");
        let meeting = a_meeting("sess-1", "Standup");
        let written = write_note(&root, &meeting).unwrap();

        let renamed = rename_note(&root, &written, "Pricing review").unwrap();
        tags::write(&renamed, &["client".into(), "pricing".into()]).unwrap();

        rewrite_note(&renamed, &meeting).unwrap();

        let text = std::fs::read_to_string(&renamed).unwrap();
        assert_eq!(
            markdown::frontmatter_value(&text, "title").as_deref(),
            Some("Pricing review")
        );
        assert!(text.contains("# Pricing review"));
        assert_eq!(tags::read(&text), vec!["client", "pricing"]);
    }

    #[test]
    fn rewriting_keeps_context_and_names_and_labels_them_by_name() {
        let root = scratch("rewrite-context");
        let mut meeting = a_meeting("sess-1", "Huspy #2");
        meeting.transcript = vec![crate::transcribe::Segment {
            id: "sys_0000".into(),
            start_ms: 4_000,
            end_ms: 6_000,
            text: "thanks for having me".into(),
            source: crate::audio::StreamSource::System,
        }];
        let written = write_note(&root, &meeting).unwrap();
        assert!(std::fs::read_to_string(&written)
            .unwrap()
            .contains("**them** `00:04`"));

        context::write(&written, "An interview.", &["Amira".into()]).unwrap();
        rewrite_note(&written, &meeting).unwrap();

        let text = std::fs::read_to_string(&written).unwrap();
        assert_eq!(context::read(&text).context, "An interview.");
        assert_eq!(context::read(&text).participants, vec!["Amira"]);
        assert!(text.contains("**Amira** `00:04`"), "got:\n{text}");
    }

    #[test]
    fn renaming_moves_the_file_to_match_the_title() {
        // The filename carries the title as a slug, and it is what the user
        // sees in their own file browser. A rename that touched only the
        // frontmatter would leave the two disagreeing.
        let root = scratch("rename");
        let original = write_note(&root, &a_meeting("sess-1", "Standup")).unwrap();

        let renamed = rename_note(&root, &original, "Quarterly planning").unwrap();

        assert!(!original.exists(), "the old file was left behind");
        assert!(renamed.exists());
        assert!(
            renamed.to_string_lossy().contains("quarterly-planning"),
            "filename did not follow the title: {}",
            renamed.display()
        );

        let text = std::fs::read_to_string(&renamed).unwrap();
        assert!(text.contains("title: Quarterly planning"), "got:\n{text}");
        assert!(text.contains("# Quarterly planning"), "got:\n{text}");
    }

    #[test]
    fn renaming_onto_an_existing_name_does_not_destroy_it() {
        let root = scratch("rename-collide");
        let keep = write_note(&root, &a_meeting("sess-1", "Standup")).unwrap();
        let other = write_note(&root, &a_meeting("sess-2", "Retro")).unwrap();

        let renamed = rename_note(&root, &other, "Standup").unwrap();

        assert!(keep.exists(), "renaming clobbered a different meeting");
        assert_ne!(renamed, keep);
        assert!(renamed.exists());
    }

    #[test]
    fn renaming_rejects_an_empty_title() {
        let root = scratch("rename-empty");
        let note = write_note(&root, &a_meeting("sess-1", "Standup")).unwrap();

        assert!(rename_note(&root, &note, "   ").is_err());
        assert!(note.exists(), "a rejected rename still moved the file");
    }

    #[test]
    fn deleting_a_note_takes_its_session_with_it() {
        // Leaving the journal would mean a deleted meeting still had a full
        // transcript on disk, which is not what "delete" means to anyone.
        let root = scratch("delete");
        let note = write_note(&root, &a_meeting("sess-123", "Client call")).unwrap();

        let session = paths::session_dir(&root, "sess-123");
        std::fs::create_dir_all(&session).unwrap();
        std::fs::write(session.join("session.jsonl"), "{}").unwrap();

        delete_note(&root, &note).unwrap();

        assert!(!note.exists());
        assert!(!session.exists(), "the transcript outlived the note");
    }

    #[test]
    fn deleting_a_note_with_no_session_still_works() {
        let root = scratch("delete-no-session");
        let note = write_note(&root, &a_meeting("sess-gone", "Ad hoc")).unwrap();

        delete_note(&root, &note).unwrap();
        assert!(!note.exists());
    }
}
