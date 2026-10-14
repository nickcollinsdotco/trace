//! Whether TRACE has work it cannot resume: a meeting recording, or its
//! notes being written.
//!
//! Three things need to know. Windows, so it does not idle-sleep (`awake`).
//! The close button and the in-app updater, which would end the work where
//! it was. And `scripts/update.ps1`, a separate process, which closes TRACE
//! to install a build and so reads a marker file rather than asking.

use std::path::PathBuf;
use std::sync::Mutex;

/// How many pieces of work are holding TRACE busy. A count, not a flag: a
/// meeting can start while the last one's notes are still being written.
static HELD: Mutex<usize> = Mutex::new(0);

/// Held while TRACE must not be closed or put to sleep; dropping it ends
/// the hold.
pub struct Busy {
    _awake: crate::awake::Awake,
}

/// Mark TRACE busy until the guard is dropped.
pub fn hold() -> Busy {
    let mut held = HELD.lock().unwrap_or_else(|e| e.into_inner());
    if *held == 0 {
        write_marker();
    }
    *held += 1;
    Busy {
        _awake: crate::awake::hold(),
    }
}

impl Drop for Busy {
    fn drop(&mut self) {
        let mut held = HELD.lock().unwrap_or_else(|e| e.into_inner());
        *held = held.saturating_sub(1);
        if *held == 0 {
            remove_marker();
        }
    }
}

/// Whether anything is holding TRACE busy now.
pub fn is_busy() -> bool {
    *HELD.lock().unwrap_or_else(|e| e.into_inner()) > 0
}

/// `%LOCALAPPDATA%\TRACE\busy`, holding the process id.
///
/// The id is what keeps a stale marker harmless: a crash or a power cut
/// leaves the file behind, and the update script ignores it once no TRACE
/// with that id is running. It is also how the script tells an installed
/// TRACE from a development build, which shares this folder.
pub fn marker_path() -> Option<PathBuf> {
    crate::models::models_root()
        .ok()?
        .parent()
        .map(|p| p.join("busy"))
}

// Best-effort, both: a marker that could not be written costs the update
// script its warning, which is no reason to refuse to record. Never from
// tests, which would delete the marker of an installed TRACE mid-meeting.
#[cfg(not(test))]
fn write_marker() {
    if let Some(path) = marker_path() {
        let _ = std::fs::write(path, std::process::id().to_string());
    }
}

#[cfg(not(test))]
fn remove_marker() {
    if let Some(path) = marker_path() {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
fn write_marker() {}

#[cfg(test)]
fn remove_marker() {}

#[cfg(test)]
mod tests {
    use super::*;

    // Only what holds whatever else runs: the count is process-wide, and
    // other tests may hold it in parallel, so "not busy" cannot be asserted.
    #[test]
    fn busy_while_any_hold_lasts() {
        let recording = hold();
        let notes = hold();
        assert!(is_busy());
        drop(recording);
        assert!(is_busy(), "the notes still hold it");
        drop(notes);
    }
}
