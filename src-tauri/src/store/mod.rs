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

pub mod journal;
pub mod markdown;
pub mod paths;

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

/// Remove a session's working directory once its note is safely written.
///
/// Deliberately separate from `write_note` and never automatic: the journal is
/// the only copy until the Markdown exists, so discarding it is a decision the
/// caller makes after confirming the note is on disk.
pub fn discard_session(session_dir: &std::path::Path) -> Result<(), StoreError> {
    std::fs::remove_dir_all(session_dir)?;
    Ok(())
}
