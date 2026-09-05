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

/// Working directory for in-progress sessions.
///
/// Hidden, and separate from the notes themselves: it holds journals and
/// transient audio, neither of which the user should have to look at.
pub fn sessions_root(notes_root: &Path) -> PathBuf {
    notes_root.join(".sessions")
}

pub fn session_dir(notes_root: &Path, session_id: &str) -> PathBuf {
    sessions_root(notes_root).join(sanitize(session_id))
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

    #[test]
    fn session_ids_are_sanitised_into_path_components() {
        let p = session_dir(Path::new("/notes"), "../../etc/passwd");
        let s = p.to_string_lossy();
        assert!(!s.contains(".."), "path traversal must not survive");
    }
}
