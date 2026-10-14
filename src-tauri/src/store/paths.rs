//! Where things live on disk, and how they are safely written.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use super::StoreError;

/// Default root for meeting notes.
///
/// Under Documents rather than an application data directory, because these
/// files are the product: the user is meant to find them, open them in another
/// editor, and put them in their own sync or version control.
pub fn default_notes_root() -> Result<PathBuf, StoreError> {
    let docs = dirs::document_dir().ok_or(StoreError::NoNotesDir)?;
    Ok(docs.join("TRACE"))
}

/// Where sessions live: journals and the meeting audio.
///
/// Under local app data, not beside the notes. Documents is the folder
/// OneDrive's backup redirects by default, and sessions there meant raw
/// meeting audio, ~690 MB an hour, uploaded by a product that promises none
/// leaves the machine — and sync locking the WAVs mid-meeting. `Local` is
/// never roamed or backed up by Windows itself.
pub fn default_sessions_root() -> Result<PathBuf, StoreError> {
    let base = dirs::data_local_dir().ok_or(StoreError::NoSessionsDir)?;
    Ok(base.join("TRACE").join("sessions"))
}

/// Sessions kept inside a notes folder: where they all lived before 0.29,
/// and where they still go under a notes root set for a test, so a sandbox
/// stays a sandbox.
pub fn sessions_beside(notes_root: &Path) -> PathBuf {
    notes_root.join(".sessions")
}

pub fn session_dir(sessions_root: &Path, session_id: &str) -> PathBuf {
    sessions_root.join(sanitize(session_id))
}

/// What moving sessions to their new home did, as counts for the log.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Moved {
    pub moved: usize,
    /// Left where they were: in use, already present at the destination, or
    /// failed to copy. Tried again on the next launch.
    pub left: usize,
}

/// Move every session from `from` into `to`, then remove `from` if empty.
///
/// A rename, which on one volume is instant whatever the size; a copy and
/// delete only when the rename failed for being across volumes. Any other
/// failure — a session another TRACE is recording into holds its files open
/// — leaves it alone, because a copy then would be a snapshot of a meeting
/// still being written. A session is moved whole or not at all: a journal
/// separated from its audio is a meeting that can neither be recovered nor
/// re-transcribed. One already at the destination is never overwritten.
pub fn move_sessions(from: &Path, to: &Path) -> Moved {
    let mut report = Moved::default();
    let Ok(entries) = fs::read_dir(from) else {
        return report;
    };
    if fs::create_dir_all(to).is_err() {
        return report;
    }

    for entry in entries.flatten() {
        let source = entry.path();
        if !source.is_dir() {
            continue;
        }
        let target = to.join(entry.file_name());
        if target.exists() {
            report.left += 1;
            continue;
        }
        let done = match fs::rename(&source, &target) {
            Ok(()) => true,
            Err(e) if crosses_volumes(&e) => copy_then_remove(&source, &target),
            Err(_) => false,
        };
        if done {
            report.moved += 1;
        } else {
            report.left += 1;
        }
    }

    // Fails, harmlessly, while anything was left.
    let _ = fs::remove_dir(from);
    report
}

/// `ErrorKind::CrossesDevices` is newer than this crate's minimum Rust.
fn crosses_volumes(e: &std::io::Error) -> bool {
    // ERROR_NOT_SAME_DEVICE on Windows, EXDEV elsewhere.
    let code = if cfg!(windows) { 17 } else { 18 };
    e.raw_os_error() == Some(code)
}

fn copy_then_remove(source: &Path, target: &Path) -> bool {
    if copy_dir(source, target).is_err() {
        let _ = fs::remove_dir_all(target);
        return false;
    }
    // The copy is complete, so a source that will not delete costs a copy
    // left behind, not data.
    let _ = fs::remove_dir_all(source);
    true
}

fn copy_dir(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::create_dir_all(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let path = entry.path();
        let dest = target.join(entry.file_name());
        if path.is_dir() {
            copy_dir(&path, &dest)?;
        } else {
            fs::copy(&path, &dest)?;
        }
    }
    Ok(())
}

/// The sync service a folder is inside, if any.
///
/// OneDrive says where its folders are in the environment, personal and work
/// alike. Dropbox does not, but its folder is named for it. Others are not
/// detected: this is a warning, and a missed one leaves things as they were.
pub fn synced_by(dir: &Path) -> Option<&'static str> {
    let onedrive: Vec<PathBuf> = ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]
        .iter()
        .filter_map(std::env::var_os)
        .map(PathBuf::from)
        .collect();
    sync_service(dir, &onedrive)
}

fn sync_service(dir: &Path, onedrive: &[PathBuf]) -> Option<&'static str> {
    let in_onedrive = onedrive
        .iter()
        .any(|root| !root.as_os_str().is_empty() && dir.starts_with(root));
    if in_onedrive {
        return Some("OneDrive");
    }
    let dropbox = dir
        .components()
        .any(|c| c.as_os_str().to_string_lossy().starts_with("Dropbox"));
    dropbox.then_some("Dropbox")
}

/// Path a finished meeting is written to: `<root>/YYYY/MM/YYYY-MM-DD-slug.md`.
///
/// Year and month directories keep any single folder browsable after a couple
/// of years of daily meetings.
pub fn note_path(notes_root: &Path, date: &str, title: &str) -> PathBuf {
    let (year, month) = split_date(date);
    notes_root
        .join(year)
        .join(month)
        .join(format!("{date}-{}.md", slug(title)))
}

/// A path that does not yet exist, by appending `-2`, `-3`, … if needed.
///
/// Two meetings a day can easily share a title ("Standup"), and silently
/// overwriting the first would lose a meeting.
pub fn unique_note_path(notes_root: &Path, date: &str, title: &str) -> PathBuf {
    let base = note_path(notes_root, date, title);
    if !base.exists() {
        return base;
    }

    let stem = base
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("meeting")
        .to_string();
    let parent = base.parent().map(Path::to_path_buf).unwrap_or_default();

    for n in 2..1000 {
        let candidate = parent.join(format!("{stem}-{n}.md"));
        if !candidate.exists() {
            return candidate;
        }
    }
    base
}

/// Write `contents` to `path` atomically.
///
/// Writes a sibling temporary file, flushes it to disk, then renames over the
/// target. Rename is atomic on both Windows and Unix, so a crash leaves either
/// the old file or the new one — never a half-written note. Writing in place
/// would risk truncating a meeting that was previously saved fine.
pub fn write_atomic(path: &Path, contents: &str) -> Result<(), StoreError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    // Sibling, not the system temp dir: rename across volumes is not atomic
    // and on Windows fails outright.
    let tmp = path.with_extension("md.tmp");

    {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(contents.as_bytes())?;
        // Flush to the device, not just the OS buffer. Without this a power
        // loss can leave a renamed but empty file.
        file.sync_all()?;
    }

    fs::rename(&tmp, path)?;
    Ok(())
}

fn split_date(date: &str) -> (&str, &str) {
    let mut parts = date.split('-');
    let year = parts.next().unwrap_or("0000");
    let month = parts.next().unwrap_or("00");
    (year, month)
}

/// A filename-safe slug.
///
/// Deliberately conservative: lowercase ASCII alphanumerics and hyphens only.
/// Meeting titles routinely contain `/`, `:` and `?`, all of which are illegal
/// on Windows, and emoji, which survive but make paths awkward everywhere.
pub fn slug(title: &str) -> String {
    let mut out = String::with_capacity(title.len());
    let mut last_dash = true; // suppresses a leading dash

    for ch in title.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }

    while out.ends_with('-') {
        out.pop();
    }

    if out.is_empty() {
        out.push_str("untitled");
    }
    out.truncate(60);
    while out.ends_with('-') {
        out.pop();
    }
    out
}

/// Sanitise a path component without the aggressive slugging.
fn sanitize(component: &str) -> String {
    component
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// Where `rewrite_note` keeps a note's previous text: beside it, named for
/// when, and ending `.bak` so neither the library nor Obsidian takes it for
/// a second copy of the meeting.
pub fn kept_copy_path(note: &Path, at: &chrono::DateTime<chrono::Local>) -> PathBuf {
    let stem = note
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "note".into());
    let base = format!(
        "{stem} (before regenerating {})",
        at.format("%Y-%m-%d %H%M")
    );
    let mut candidate = note.with_file_name(format!("{base}.md.bak"));
    let mut n = 2;
    // Two regenerations in one minute must not overwrite the first copy.
    while candidate.exists() {
        candidate = note.with_file_name(format!("{base} {n}.md.bak"));
        n += 1;
    }
    candidate
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_are_lowercase_and_hyphenated() {
        assert_eq!(slug("Client Alpha"), "client-alpha");
        assert_eq!(slug("Team Sync"), "team-sync");
    }

    #[test]
    fn slugs_strip_characters_windows_rejects() {
        // `/ \ : * ? " < > |` are all illegal in Windows filenames.
        assert_eq!(slug("Q3: Roadmap / Planning?"), "q3-roadmap-planning");
        assert_eq!(slug("A<B>C|D"), "a-b-c-d");
    }

    #[test]
    fn slugs_collapse_runs_and_trim_edges() {
        assert_eq!(slug("  Lots   of   space  "), "lots-of-space");
        assert_eq!(slug("---hello---"), "hello");
    }

    #[test]
    fn a_title_with_no_usable_characters_still_yields_a_name() {
        // An emoji-only or CJK title must not produce an empty filename.
        assert_eq!(slug("🎉🎉🎉"), "untitled");
        assert_eq!(slug(""), "untitled");
    }

    #[test]
    fn slugs_are_length_capped_without_a_trailing_dash() {
        let long = "word ".repeat(50);
        let s = slug(&long);
        assert!(s.len() <= 60);
        assert!(!s.ends_with('-'), "truncation must not leave a dash");
    }

    #[test]
    fn note_paths_are_nested_by_year_and_month() {
        let root = Path::new("/notes");
        let p = note_path(root, "2026-09-05", "Client Alpha");
        assert!(p.ends_with("2026/09/2026-09-05-client-alpha.md"));
    }

    #[test]
    fn a_malformed_date_does_not_panic() {
        let p = note_path(Path::new("/notes"), "garbage", "Title");
        assert!(p.to_string_lossy().contains("garbage-title.md"));
    }

    #[test]
    fn atomic_write_leaves_no_temporary_file() {
        let dir = std::env::temp_dir().join(format!("trace-paths-{}", std::process::id()));
        let path = dir.join("2026").join("09").join("note.md");

        write_atomic(&path, "# Hello").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "# Hello");
        assert!(!path.with_extension("md.tmp").exists());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn atomic_write_replaces_existing_content_entirely() {
        // Shorter content must not leave a tail of the longer previous note.
        let dir = std::env::temp_dir().join(format!("trace-paths-rw-{}", std::process::id()));
        let path = dir.join("note.md");

        write_atomic(&path, "a very long original note").unwrap();
        write_atomic(&path, "short").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "short");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn unique_paths_avoid_overwriting_a_same_titled_meeting() {
        // Two standups in one day must not collapse into one file.
        let dir = std::env::temp_dir().join(format!("trace-paths-uniq-{}", std::process::id()));
        let first = unique_note_path(&dir, "2026-09-05", "Standup");
        write_atomic(&first, "one").unwrap();

        let second = unique_note_path(&dir, "2026-09-05", "Standup");
        assert_ne!(first, second);
        assert!(second.to_string_lossy().ends_with("standup-2.md"));

        fs::remove_dir_all(&dir).ok();
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("trace-paths-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn a_session(sessions: &Path, id: &str, journal: &str) {
        let dir = sessions.join(id);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("session.jsonl"), journal).unwrap();
        fs::write(dir.join("mic.wav"), b"audio").unwrap();
    }

    #[test]
    fn sessions_move_whole_and_the_old_folder_goes() {
        let root = scratch("move");
        let (old, new) = (root.join("notes/.sessions"), root.join("local/sessions"));
        a_session(&old, "sess-1", "one");
        a_session(&old, "sess-2", "two");

        assert_eq!(move_sessions(&old, &new), Moved { moved: 2, left: 0 });
        assert_eq!(
            fs::read_to_string(new.join("sess-2/session.jsonl")).unwrap(),
            "two"
        );
        assert!(
            new.join("sess-1/mic.wav").exists(),
            "audio parted from its journal"
        );
        assert!(!old.exists(), "an empty .sessions left in the notes folder");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_session_already_at_the_destination_is_not_overwritten() {
        let root = scratch("move-clash");
        let (old, new) = (root.join("old"), root.join("new"));
        a_session(&old, "sess-1", "old");
        a_session(&new, "sess-1", "new");

        assert_eq!(move_sessions(&old, &new), Moved { moved: 0, left: 1 });
        assert_eq!(
            fs::read_to_string(new.join("sess-1/session.jsonl")).unwrap(),
            "new"
        );
        assert!(
            old.join("sess-1/session.jsonl").exists(),
            "the old one was lost"
        );

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn nothing_to_move_is_not_an_error() {
        let root = scratch("move-none");
        assert_eq!(
            move_sessions(&root.join("absent"), &root.join("new")),
            Moved::default()
        );
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_copy_across_volumes_is_whole() {
        // The fallback when rename cannot cross volumes, exercised directly.
        let root = scratch("copy");
        a_session(&root.join("old"), "sess-1", "one");
        fs::create_dir_all(root.join("old/sess-1/nested")).unwrap();
        fs::write(root.join("old/sess-1/nested/x"), b"x").unwrap();

        assert!(copy_then_remove(
            &root.join("old/sess-1"),
            &root.join("new/sess-1")
        ));
        assert!(root.join("new/sess-1/mic.wav").exists());
        assert!(root.join("new/sess-1/nested/x").exists());
        assert!(!root.join("old/sess-1").exists());

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn synced_folders_are_named() {
        let onedrive = [PathBuf::from("C:/Users/x/OneDrive")];
        let in_it = Path::new("C:/Users/x/OneDrive/Documents/TRACE");
        assert_eq!(sync_service(in_it, &onedrive), Some("OneDrive"));
        let dropbox = Path::new("D:/Dropbox (Personal)/TRACE");
        assert_eq!(sync_service(dropbox, &onedrive), Some("Dropbox"));
        let plain = Path::new("C:/Users/x/Documents/TRACE");
        assert_eq!(sync_service(plain, &onedrive), None);
        // An empty variable must not match everything.
        assert_eq!(sync_service(plain, &[PathBuf::new()]), None);
    }

    #[test]
    fn session_ids_are_sanitised_into_path_components() {
        let p = session_dir(Path::new("/sessions"), "../../etc/passwd");
        let s = p.to_string_lossy();
        assert!(!s.contains(".."), "path traversal must not survive");
    }
}
