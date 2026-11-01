//! A folder change is a copy on next launch, before any note jobs exist.
//!
//! Originals stay put. Publishing each complete file without replacement makes
//! an interrupted copy retryable; the active root changes only after every
//! Markdown file has been verified. A separate, strictly read configuration
//! avoids a corrupt ordinary preference silently sending notes back to Documents.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

static CHANGE: Mutex<()> = Mutex::new(());
static STARTUP_ERROR: Mutex<Option<String>> = Mutex::new(None);

#[derive(Default, Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Location {
    current: Option<PathBuf>,
    pending: Option<PathBuf>,
}

#[derive(Serialize)]
pub struct Status {
    current: String,
    pending: Option<String>,
    error: Option<String>,
}

fn config_path() -> Result<PathBuf, String> {
    Ok(crate::store::paths::default_sessions_root()
        .map_err(|e| e.to_string())?
        .with_file_name("notes-location.json"))
}

fn load(path: &Path) -> Result<Location, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|e| format!("The notes folder preference could not be read: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Location::default()),
        Err(e) => Err(e.to_string()),
    }
}

fn save(path: &Path, location: &Location) -> Result<(), String> {
    crate::store::paths::write_atomic(
        path,
        &serde_json::to_string(location).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

fn resolved(location: &Location) -> Result<PathBuf, String> {
    location.current.clone().map_or_else(
        || crate::store::paths::default_notes_root().map_err(|e| e.to_string()),
        Ok,
    )
}

pub fn root() -> Result<PathBuf, String> {
    root_at(&config_path()?)
}

fn root_at(config: &Path) -> Result<PathBuf, String> {
    let location = load(config)?;
    let root = resolved(&location)?;
    // A disconnected drive must not look like an empty library, or be recreated
    // as an empty mount point. Only the never-chosen default may start absent.
    if location.current.is_some() {
        fs::read_dir(&root)
            .map_err(|e| format!("Notes folder unavailable ({}): {e}", display(&root)))?;
    }
    Ok(root)
}

pub fn status() -> Result<Status, String> {
    if let Some(root) = std::env::var_os("TRACE_NOTES_ROOT") {
        return Ok(Status {
            current: display(Path::new(&root)),
            pending: None,
            error: Some("Folder changes are disabled while TRACE_NOTES_ROOT is set.".into()),
        });
    }
    let location = load(&config_path()?)?;
    Ok(Status {
        current: display(&resolved(&location)?),
        pending: location.pending.as_deref().map(display),
        error: STARTUP_ERROR
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .or_else(|| root().err()),
    })
}

fn display(path: &Path) -> String {
    let text = path.to_string_lossy();
    if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        text.trim_start_matches(r"\\?\").to_string()
    }
}

/// The handle lives until exit: a second new-version instance cannot write
/// notes while the next launch copies them. Windows releases it after a crash.
pub fn initialise() -> Result<File, String> {
    let path = config_path()?;
    let parent = path.parent().ok_or("No settings directory")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let lock = instance_lock(&parent.join("notes-location.lock"))?;
    let mut location = load(&path)?;
    if location.pending.is_some() {
        let result = apply(&path, &mut location, parent);
        *STARTUP_ERROR.lock().map_err(|e| e.to_string())? = result.err();
    }
    Ok(lock)
}

fn instance_lock(path: &Path) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(0);
    }
    options
        .open(path)
        .map_err(|e| format!("Close the other TRACE window before starting this copy: {e}"))
}

pub fn schedule(destination: Option<String>) -> Result<Status, String> {
    if std::env::var_os("TRACE_NOTES_ROOT").is_some() {
        return Err("Folder changes are disabled while TRACE_NOTES_ROOT is set.".into());
    }
    let _guard = CHANGE.lock().map_err(|e| e.to_string())?;
    schedule_at(&config_path()?, destination)?;
    *STARTUP_ERROR.lock().map_err(|e| e.to_string())? = None;
    status()
}

fn schedule_at(path: &Path, destination: Option<String>) -> Result<(), String> {
    let mut location = load(path)?;
    location.pending = match destination {
        Some(destination) => {
            let source = root_at(path)?;
            // Pin even the default path before queuing: if that drive disappears
            // before restart it must be an error, never an empty successful copy.
            fs::create_dir_all(&source).map_err(|e| e.to_string())?;
            location.current = Some(source.clone());
            let target = validate(
                &source,
                Path::new(&destination),
                path.parent().ok_or("No settings directory")?,
            )?;
            if fs::read_dir(&target)
                .map_err(|e| e.to_string())?
                .next()
                .is_some()
            {
                return Err("Choose an empty folder. Existing files are never overwritten. Cancel the pending change before choosing another folder.".into());
            }
            probe(&target)?;
            Some(target)
        }
        None => None,
    };
    save(path, &location)
}

fn comparable(path: &Path) -> PathBuf {
    if cfg!(windows) {
        PathBuf::from(path.to_string_lossy().to_lowercase())
    } else {
        path.to_path_buf()
    }
}

fn overlaps(a: &Path, b: &Path) -> bool {
    let a = comparable(a);
    let b = comparable(b);
    a.starts_with(&b) || b.starts_with(&a)
}

fn validate(source: &Path, target: &Path, private: &Path) -> Result<PathBuf, String> {
    if !target.is_absolute() {
        return Err("Choose an absolute folder path.".into());
    }
    let target = fs::canonicalize(target).map_err(|e| format!("Destination unavailable: {e}"))?;
    if !target.is_dir() {
        return Err("Choose a folder, not a file.".into());
    }
    let source = if source.exists() {
        fs::canonicalize(source).map_err(|e| e.to_string())?
    } else {
        // The initial Documents/TRACE folder need not exist yet.
        fs::canonicalize(source.parent().ok_or("Notes folder has no parent")?)
            .map_err(|e| e.to_string())?
            .join(source.file_name().ok_or("Notes folder has no name")?)
    };
    let private = fs::canonicalize(private).map_err(|e| e.to_string())?;
    if overlaps(&source, &target) {
        return Err(
            "Choose a different folder, outside the current notes folder and its parents.".into(),
        );
    }
    if overlaps(&private, &target) {
        return Err("Choose a folder outside TRACE's local application data. Audio and journals stay there.".into());
    }
    Ok(target)
}

pub fn check_writable(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    probe(dir)
}

fn probe(dir: &Path) -> Result<(), String> {
    let (path, mut file) = temporary(dir)?;
    let result = file
        .write_all(b"TRACE folder check")
        .and_then(|()| file.sync_all());
    drop(file);
    let _ = fs::remove_file(path);
    result.map_err(|e| format!("Folder is not writable: {e}"))
}

fn temporary(dir: &Path) -> Result<(PathBuf, File), String> {
    for n in 0..1000 {
        let path = dir.join(format!(".trace-copy-{}-{n}.tmp", std::process::id()));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("Folder is not writable: {e}")),
        }
    }
    Err("Too many interrupted temporary copies in this folder. Choose another empty folder.".into())
}

fn linked(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn markdown_files(root: &Path, dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        // Hidden working directories are never part of a Markdown library.
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if linked(&metadata) {
            return Err(format!(
                "Linked files or folders cannot be copied safely: {}",
                display(&path)
            ));
        }
        if metadata.is_dir() {
            markdown_files(root, &path, out)?;
        } else if path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("md"))
        {
            out.push(
                path.strip_prefix(root)
                    .map_err(|e| e.to_string())?
                    .to_path_buf(),
            );
        }
    }
    Ok(())
}

fn destination_parent(target: &Path, relative: &Path) -> Result<PathBuf, String> {
    let mut parent = target.to_path_buf();
    for part in relative.parent().ok_or("Note has no parent")?.components() {
        parent.push(part);
        match fs::create_dir(&parent) {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
            Err(e) => return Err(e.to_string()),
        }
        let metadata = fs::symlink_metadata(&parent).map_err(|e| e.to_string())?;
        if !metadata.is_dir() || linked(&metadata) {
            return Err(
                "A destination subfolder is a link or file. Choose another empty folder.".into(),
            );
        }
    }
    Ok(parent)
}

fn copy_note(source: &Path, target: &Path, relative: &Path) -> Result<(), String> {
    let bytes = fs::read(source.join(relative)).map_err(|e| e.to_string())?;
    let parent = destination_parent(target, relative)?;
    let destination = target.join(relative);
    if let Ok(metadata) = fs::symlink_metadata(&destination) {
        if !linked(&metadata)
            && metadata.is_file()
            && fs::read(&destination).map_err(|e| e.to_string())? == bytes
        {
            return Ok(());
        }
        return Err(format!("A different file already exists at {}. Nothing was overwritten. Choose another empty folder.", display(&destination)));
    }
    let (temp, mut file) = temporary(&parent)?;
    let result = (|| {
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        // A hard link publishes a fully flushed file, atomically and without
        // replacement. Filesystems without hard links fail safely before switch.
        fs::hard_link(&temp, &destination).map_err(|e| {
            format!(
                "Could not publish the copied note (the destination must support hard links): {e}"
            )
        })
    })();
    drop(file);
    let _ = fs::remove_file(&temp);
    result
}

fn apply(config: &Path, location: &mut Location, private: &Path) -> Result<(), String> {
    let Some(target) = location.pending.clone() else {
        return Ok(());
    };
    let source = resolved(location)?;
    let canonical = validate(&source, &target, private)?;
    if canonical != target {
        return Err("The destination has changed. Choose it again in Settings.".into());
    }
    probe(&target)?;
    let mut files = Vec::new();
    if source.exists() {
        markdown_files(&source, &source, &mut files)?;
    } else if location.current.is_some() {
        return Err(
            "The current notes folder is unavailable. Reconnect it before changing folders.".into(),
        );
    }
    files.sort();
    for relative in &files {
        copy_note(&source, &target, relative)?;
    }
    // Catch a file edited during the copy. Originals are always retained, even
    // if an editor changes one in the tiny interval after this last comparison.
    let mut after = Vec::new();
    if source.exists() {
        markdown_files(&source, &source, &mut after)?;
    }
    files.sort();
    after.sort();
    if files != after {
        return Err(
            "Notes changed during the copy. Restart to retry, or choose another empty folder."
                .into(),
        );
    }
    // A previous attempt may have copied a note that was since renamed or
    // deleted in the still-active source. Never turn that stale copy back into
    // a live note, or absorb files someone added to the destination meanwhile.
    let mut copied = Vec::new();
    markdown_files(&target, &target, &mut copied)?;
    copied.sort();
    if copied != files {
        return Err("The destination contains notes that are no longer in the current folder, or were added separately. The current folder is still in use. Cancel the change in Settings and choose another empty folder; no files were deleted.".into());
    }
    for relative in &files {
        if fs::read(source.join(relative)).map_err(|e| e.to_string())?
            != fs::read(target.join(relative)).map_err(|e| e.to_string())?
        {
            return Err("A note changed during the copy. Choose another empty folder; the original is safe.".into());
        }
    }
    let next = Location {
        current: Some(PathBuf::from(display(&target))),
        pending: None,
    };
    save(config, &next)?;
    *location = next;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT: AtomicUsize = AtomicUsize::new(0);
    struct Sandbox(PathBuf);
    impl Sandbox {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "trace-notes-location-{}-{}-{}",
                std::process::id(),
                chrono::Utc::now().timestamp_nanos_opt().unwrap(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            for child in ["source", "target", "private"] {
                fs::create_dir(path.join(child)).unwrap();
            }
            Self(path)
        }
        fn source(&self) -> PathBuf {
            self.0.join("source")
        }
        fn target(&self) -> PathBuf {
            fs::canonicalize(self.0.join("target")).unwrap()
        }
        fn private(&self) -> PathBuf {
            self.0.join("private")
        }
        fn config(&self) -> PathBuf {
            self.private().join("notes-location.json")
        }
        fn queued(&self) -> Location {
            let location = Location {
                current: Some(self.source()),
                pending: Some(self.target()),
            };
            save(&self.config(), &location).unwrap();
            location
        }
        fn write(&self, relative: &str, bytes: &[u8]) {
            let path = self.source().join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, bytes).unwrap();
        }
    }
    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn copies_exact_markdown_and_retains_originals_without_copying_audio_or_unknown_files() {
        let s = Sandbox::new();
        let bytes = b"---\r\nid: sess-test\r\n---\r\nEdited by the user\r\n";
        s.write("2026/10/note.md", bytes);
        s.write("manual.md", b"User Markdown without TRACE frontmatter");
        s.write("attachment.png", b"unknown");
        s.write(".sessions/sess-test/mic.wav", b"private audio");
        s.write(".sessions/sess-test/note.md", b"private working file");
        let mut location = s.queued();
        apply(&s.config(), &mut location, &s.private()).unwrap();
        assert_eq!(fs::read(s.target().join("2026/10/note.md")).unwrap(), bytes);
        assert_eq!(fs::read(s.source().join("2026/10/note.md")).unwrap(), bytes);
        assert!(s.target().join("manual.md").exists());
        assert!(!s.target().join("attachment.png").exists());
        assert!(!s.target().join(".sessions").exists());
        assert_eq!(
            fs::read(s.source().join(".sessions/sess-test/mic.wav")).unwrap(),
            b"private audio"
        );
        assert_eq!(
            fs::read(s.source().join("attachment.png")).unwrap(),
            b"unknown"
        );
        let restarted = load(&s.config()).unwrap();
        assert_eq!(
            fs::canonicalize(resolved(&restarted).unwrap()).unwrap(),
            s.target()
        );
        assert!(restarted.pending.is_none());
    }

    #[test]
    fn the_committed_folder_serves_search_reads_and_new_notes_after_restart() {
        let s = Sandbox::new();
        let meeting = crate::meeting::Meeting::new("folder-original", "Migration needle");
        let original = crate::store::write_note(&s.source(), &meeting).unwrap();
        let bytes = fs::read(&original).unwrap();
        let mut location = s.queued();
        apply(&s.config(), &mut location, &s.private()).unwrap();
        let active = root_at(&s.config()).unwrap();
        let found = crate::store::find_note(&active, &meeting.id).unwrap();
        assert!(found.starts_with(&active));
        assert_eq!(fs::read(&found).unwrap(), bytes);
        let hits = crate::store::search::search(&active, "needle");
        assert_eq!(hits.len(), 1);
        assert_eq!(PathBuf::from(&hits[0].path), found);
        let next = crate::meeting::Meeting::new("folder-new", "New meeting");
        let written = crate::store::write_note(&active, &next).unwrap();
        assert!(written.starts_with(&active));
        assert!(crate::store::find_note(&s.source(), &next.id).is_none());
        assert_eq!(fs::read(&original).unwrap(), bytes);
    }

    #[test]
    fn a_collision_part_way_keeps_old_root_and_restart_reuses_only_identical_copies() {
        let s = Sandbox::new();
        s.write("a.md", b"first");
        s.write("z.md", b"last");
        let mut location = s.queued();
        fs::write(s.target().join("z.md"), b"somebody else's file").unwrap();
        assert!(apply(&s.config(), &mut location, &s.private())
            .unwrap_err()
            .contains("Nothing was overwritten"));
        assert_eq!(fs::read(s.target().join("a.md")).unwrap(), b"first");
        assert_eq!(
            fs::read(s.target().join("z.md")).unwrap(),
            b"somebody else's file"
        );
        assert_eq!(resolved(&load(&s.config()).unwrap()).unwrap(), s.source());
        // The user resolves the conflicting file; a fresh process retries the
        // persisted intent and recognises the already-complete first copy.
        fs::rename(s.target().join("z.md"), s.target().join("keep.txt")).unwrap();
        let mut restarted = load(&s.config()).unwrap();
        apply(&s.config(), &mut restarted, &s.private()).unwrap();
        assert_eq!(
            fs::canonicalize(resolved(&load(&s.config()).unwrap()).unwrap()).unwrap(),
            s.target()
        );
        assert_eq!(
            fs::read(s.target().join("keep.txt")).unwrap(),
            b"somebody else's file"
        );
        assert_eq!(fs::read(s.target().join("z.md")).unwrap(), b"last");
    }

    #[test]
    fn a_crash_before_commit_can_retry_and_temporary_files_are_never_mistaken_for_notes() {
        let s = Sandbox::new();
        s.write("a.md", b"complete");
        let _ = s.queued();
        copy_note(&s.source(), &s.target(), Path::new("a.md")).unwrap();
        fs::write(s.target().join(".trace-copy-crashed.tmp"), b"partial").unwrap();
        let mut restarted = load(&s.config()).unwrap();
        assert_eq!(resolved(&restarted).unwrap(), s.source());
        apply(&s.config(), &mut restarted, &s.private()).unwrap();
        assert_eq!(fs::read(s.target().join("a.md")).unwrap(), b"complete");
        assert_eq!(
            fs::read(s.target().join(".trace-copy-crashed.tmp")).unwrap(),
            b"partial"
        );
        assert!(s.source().join("a.md").exists());
    }

    #[test]
    fn a_failed_preference_commit_preserves_the_active_root_and_both_copies() {
        let s = Sandbox::new();
        s.write("a.md", b"keep");
        let mut location = s.queued();
        // Force the final atomic preference write to fail, after copying.
        fs::create_dir(s.config().with_extension("md.tmp")).unwrap();
        assert!(apply(&s.config(), &mut location, &s.private()).is_err());
        assert_eq!(resolved(&location).unwrap(), s.source());
        assert_eq!(resolved(&load(&s.config()).unwrap()).unwrap(), s.source());
        assert_eq!(fs::read(s.source().join("a.md")).unwrap(), b"keep");
        assert_eq!(fs::read(s.target().join("a.md")).unwrap(), b"keep");
    }

    #[test]
    fn changed_originals_are_not_overwritten_by_an_earlier_partial_copy() {
        let s = Sandbox::new();
        s.write("a.md", b"before");
        let mut location = s.queued();
        copy_note(&s.source(), &s.target(), Path::new("a.md")).unwrap();
        s.write("a.md", b"edited after failed migration");
        assert!(apply(&s.config(), &mut location, &s.private()).is_err());
        assert_eq!(
            fs::read(s.source().join("a.md")).unwrap(),
            b"edited after failed migration"
        );
        assert_eq!(fs::read(s.target().join("a.md")).unwrap(), b"before");
        assert_eq!(resolved(&load(&s.config()).unwrap()).unwrap(), s.source());
    }

    #[test]
    fn retry_does_not_resurrect_deleted_or_renamed_notes() {
        for renamed in [false, true] {
            let s = Sandbox::new();
            s.write("a.md", b"original note");
            s.write("z.md", b"last note");
            let mut location = s.queued();
            fs::write(s.target().join("z.md"), b"conflict").unwrap();
            assert!(apply(&s.config(), &mut location, &s.private()).is_err());
            assert!(s.target().join("a.md").exists());
            if renamed {
                fs::rename(s.source().join("a.md"), s.source().join("renamed.md")).unwrap();
            } else {
                fs::remove_file(s.source().join("a.md")).unwrap();
            }
            fs::remove_file(s.target().join("z.md")).unwrap();
            let mut restarted = load(&s.config()).unwrap();
            assert!(apply(&s.config(), &mut restarted, &s.private())
                .unwrap_err()
                .contains("destination contains notes"));
            assert_eq!(root_at(&s.config()).unwrap(), s.source());
            assert!(!s.source().join("a.md").exists());
            assert_eq!(s.source().join("renamed.md").exists(), renamed);
            assert_eq!(fs::read(s.target().join("a.md")).unwrap(), b"original note");
        }
    }

    #[test]
    fn unrelated_destination_notes_are_preserved_but_never_adopted() {
        let s = Sandbox::new();
        s.write("a.md", b"original");
        let mut location = s.queued();
        fs::write(s.target().join("unrelated.md"), b"someone else's note").unwrap();
        assert!(apply(&s.config(), &mut location, &s.private())
            .unwrap_err()
            .contains("destination contains notes"));
        assert_eq!(root_at(&s.config()).unwrap(), s.source());
        assert_eq!(
            fs::read(s.target().join("unrelated.md")).unwrap(),
            b"someone else's note"
        );
    }

    #[test]
    fn refuses_same_nested_parent_relative_missing_file_and_private_destinations() {
        let s = Sandbox::new();
        fs::create_dir(s.source().join("nested")).unwrap();
        fs::create_dir(s.private().join("sessions")).unwrap();
        fs::write(s.0.join("file"), b"x").unwrap();
        for target in [
            s.source(),
            s.source().join("nested"),
            s.0.clone(),
            PathBuf::from("relative"),
            s.0.join("missing"),
            s.0.join("file"),
            s.private().join("sessions"),
        ] {
            assert!(
                validate(&s.source(), &target, &s.private()).is_err(),
                "{}",
                target.display()
            );
        }
        assert!(validate(&s.source(), &s.target(), &s.private()).is_ok());
    }

    #[test]
    fn missing_source_or_destination_never_commits_an_empty_library() {
        for missing_source in [true, false] {
            let s = Sandbox::new();
            let mut location = s.queued();
            fs::remove_dir(if missing_source {
                s.source()
            } else {
                s.target()
            })
            .unwrap();
            assert!(apply(&s.config(), &mut location, &s.private()).is_err());
            assert_eq!(resolved(&load(&s.config()).unwrap()).unwrap(), s.source());
        }
    }

    #[test]
    fn scheduling_and_cancelling_persist_without_copying_or_changing_the_active_library() {
        let s = Sandbox::new();
        s.write("a.md", b"live job can still write here");
        save(
            &s.config(),
            &Location {
                current: Some(s.source()),
                pending: None,
            },
        )
        .unwrap();
        schedule_at(&s.config(), Some(display(&s.target()))).unwrap();
        assert_eq!(root_at(&s.config()).unwrap(), s.source());
        assert_eq!(load(&s.config()).unwrap().pending, Some(s.target()));
        assert!(!s.target().join("a.md").exists());
        schedule_at(&s.config(), None).unwrap();
        assert!(load(&s.config()).unwrap().pending.is_none());
        assert_eq!(root_at(&s.config()).unwrap(), s.source());
        assert!(s.source().join("a.md").exists());
    }

    #[test]
    fn scheduling_refuses_nonempty_targets_even_when_the_file_is_identical() {
        let s = Sandbox::new();
        s.write("a.md", b"same");
        fs::write(s.target().join("a.md"), b"same").unwrap();
        save(
            &s.config(),
            &Location {
                current: Some(s.source()),
                pending: None,
            },
        )
        .unwrap();
        assert!(schedule_at(&s.config(), Some(display(&s.target()))).is_err());
        assert!(load(&s.config()).unwrap().pending.is_none());
        assert_eq!(root_at(&s.config()).unwrap(), s.source());
    }

    #[test]
    fn an_unavailable_selected_root_is_an_error_and_never_recreated() {
        let s = Sandbox::new();
        let _ = s.queued();
        fs::remove_dir(s.source()).unwrap();
        assert!(root_at(&s.config()).is_err());
        assert!(!s.source().exists());
        assert_eq!(load(&s.config()).unwrap().current, Some(s.source()));
    }

    #[cfg(windows)]
    #[test]
    fn an_unreadable_note_stops_a_partial_copy_without_switching_folders() {
        let s = Sandbox::new();
        s.write("a.md", b"first");
        s.write("z.md", b"locked");
        let mut location = s.queued();
        let guard = instance_lock(&s.source().join("z.md")).unwrap();
        assert!(apply(&s.config(), &mut location, &s.private()).is_err());
        assert_eq!(root_at(&s.config()).unwrap(), s.source());
        assert_eq!(fs::read(s.target().join("a.md")).unwrap(), b"first");
        assert!(!s.target().join("z.md").exists());
        drop(guard);
        apply(&s.config(), &mut location, &s.private()).unwrap();
        assert_eq!(fs::read(s.target().join("z.md")).unwrap(), b"locked");
    }

    #[test]
    fn corrupt_configuration_is_an_error_not_a_return_to_documents() {
        let s = Sandbox::new();
        fs::write(s.config(), b"{ broken").unwrap();
        assert!(load(&s.config()).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn the_instance_lock_is_exclusive_and_released_on_close() {
        let s = Sandbox::new();
        let path = s.private().join("lock");
        let guard = instance_lock(&path).unwrap();
        assert!(instance_lock(&path).is_err());
        drop(guard);
        assert!(instance_lock(&path).is_ok());
    }

    #[test]
    fn a_destination_directory_collision_cannot_redirect_a_copy() {
        let s = Sandbox::new();
        s.write("2026/10/note.md", b"keep");
        fs::write(s.target().join("2026"), b"user file").unwrap();
        let mut location = s.queued();
        assert!(apply(&s.config(), &mut location, &s.private()).is_err());
        assert_eq!(fs::read(s.target().join("2026")).unwrap(), b"user file");
        assert_eq!(resolved(&load(&s.config()).unwrap()).unwrap(), s.source());
    }
}
