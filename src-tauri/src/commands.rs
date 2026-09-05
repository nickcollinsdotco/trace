//! The Tauri command surface.
//!
//! Deliberately thin. Every command is a translation between the frontend and
//! a library call — no logic lives here, so the whole backend stays testable
//! without a running app.
//!
//! Errors are stringified because that is what crosses the IPC boundary
//! usefully; the typed errors remain in the library.

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, State};

use crate::audio::{self, DeviceInfo};
use crate::capture_manager::{CaptureManager, CaptureStatus, FinishedMeeting};
use crate::meeting::MeetingType;
use crate::models::{self, install, PARAKEET_V3_INT8};
use crate::store;

pub const EVENT_MODEL_PROGRESS: &str = "trace://model-progress";

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/* ------------------------------------------------------------------ *
 * Devices
 * ------------------------------------------------------------------ */

#[tauri::command]
pub fn list_input_devices() -> Vec<DeviceInfo> {
    audio::list_input_devices()
}

#[tauri::command]
pub fn list_output_devices() -> Vec<DeviceInfo> {
    audio::list_output_devices()
}

/* ------------------------------------------------------------------ *
 * Model
 * ------------------------------------------------------------------ */

#[derive(Debug, serde::Serialize)]
pub struct ModelStatus {
    pub installed: bool,
    pub name: &'static str,
    pub download_bytes: u64,
    pub directory: String,
}

#[tauri::command]
pub fn model_status() -> ModelStatus {
    ModelStatus {
        installed: models::is_installed(&PARAKEET_V3_INT8),
        name: PARAKEET_V3_INT8.display_name,
        download_bytes: PARAKEET_V3_INT8.approx_download_bytes,
        directory: models::model_dir(&PARAKEET_V3_INT8)
            .map(|p| p.display().to_string())
            .unwrap_or_default(),
    }
}

/// Download the speech model, reporting progress as events.
///
/// Runs on a blocking thread: it is a ~478 MB download and must not occupy an
/// async worker for minutes.
#[tauri::command]
pub async fn install_model(app: AppHandle) -> CmdResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut last_percent = u8::MAX;

        install::install(&PARAKEET_V3_INT8, |progress| {
            // Emit only on whole-percent changes. A byte-level callback would
            // flood the IPC channel with tens of thousands of events.
            let (phase, percent) = match progress {
                install::Progress::Downloading { .. } => (
                    "downloading",
                    progress.fraction().map(|f| (f * 100.0) as u8).unwrap_or(0),
                ),
                install::Progress::Extracting => ("extracting", 100),
                install::Progress::Verifying => ("verifying", 100),
                install::Progress::Done => ("done", 100),
            };

            let is_download = matches!(progress, install::Progress::Downloading { .. });
            if is_download && percent == last_percent {
                return;
            }
            last_percent = percent;

            let _ = app.emit(
                EVENT_MODEL_PROGRESS,
                serde_json::json!({ "phase": phase, "percent": percent }),
            );
        })
        .map_err(err)
    })
    .await
    .map_err(err)?
}

/* ------------------------------------------------------------------ *
 * Capture
 * ------------------------------------------------------------------ */

#[tauri::command]
pub fn start_capture(
    app: AppHandle,
    manager: State<'_, CaptureManager>,
    title: String,
    mic_device: Option<String>,
) -> CmdResult<CaptureStatus> {
    let title = if title.trim().is_empty() {
        "Untitled meeting".to_string()
    } else {
        title
    };
    manager.start(app, title, mic_device).map_err(err)
}

#[tauri::command]
pub fn capture_status(manager: State<'_, CaptureManager>) -> Option<CaptureStatus> {
    manager.status()
}

#[tauri::command]
pub fn update_notes(manager: State<'_, CaptureManager>, text: String) -> CmdResult<()> {
    manager.update_notes(text).map_err(err)
}

#[tauri::command]
pub fn set_title(manager: State<'_, CaptureManager>, title: String) -> CmdResult<()> {
    manager.set_title(title).map_err(err)
}

/// Stop recording and write the note.
///
/// Blocking, and deliberately so — finalising involves a journal replay and a
/// synchronous file write, and the UI must not proceed as though the meeting
/// were saved before it actually is.
#[tauri::command]
pub async fn stop_capture(
    app: AppHandle,
    manager: State<'_, CaptureManager>,
) -> CmdResult<FinishedMeeting> {
    manager.stop(app).map_err(err)
}

/* ------------------------------------------------------------------ *
 * Library
 * ------------------------------------------------------------------ */

/// A note found on disk.
#[derive(Debug, serde::Serialize)]
pub struct NoteSummary {
    pub path: String,
    pub title: String,
    pub date: String,
    #[serde(rename = "type")]
    pub meeting_type: MeetingType,
}

/// List saved notes, newest first.
///
/// Reads the filesystem rather than an index. Markdown is canonical, and at
/// personal-use volumes a directory walk is instant; the SQLite index arrives
/// when search does, and will be rebuildable from exactly this.
#[tauri::command]
pub fn list_notes(manager: State<'_, CaptureManager>) -> CmdResult<Vec<NoteSummary>> {
    let root = manager.notes_root().map_err(err)?;
    let mut notes = Vec::new();
    collect_notes(&root, &mut notes);

    // Filename begins with the ISO date, so a reverse lexical sort is
    // chronological.
    notes.sort_by(|a: &NoteSummary, b: &NoteSummary| b.path.cmp(&a.path));
    Ok(notes)
}

fn collect_notes(dir: &std::path::Path, out: &mut Vec<NoteSummary>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();

        if path.is_dir() {
            // Session working directories are not notes.
            if path.file_name().is_some_and(|n| n == ".sessions") {
                continue;
            }
            collect_notes(&path, out);
            continue;
        }

        if !path.extension().is_some_and(|e| e == "md") {
            continue;
        }

        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };

        out.push(NoteSummary {
            title: frontmatter_field(&text, "title").unwrap_or_else(|| {
                path.file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default()
            }),
            date: frontmatter_field(&text, "date").unwrap_or_default(),
            meeting_type: store::markdown::parse_meeting_type(&text).unwrap_or_default(),
            path: path.display().to_string(),
        });
    }
}

/// Read one frontmatter scalar, unwrapping the quoting the serialiser adds.
fn frontmatter_field(markdown: &str, key: &str) -> Option<String> {
    let mut lines = markdown.lines();
    if lines.next()?.trim() != "---" {
        return None;
    }

    for line in lines {
        if line.trim() == "---" {
            break;
        }
        if let Some(value) = line.strip_prefix(&format!("{key}:")) {
            let value = value.trim();
            let unquoted = value
                .strip_prefix('"')
                .and_then(|v| v.strip_suffix('"'))
                .map(|v| v.replace("\\\"", "\"").replace("\\\\", "\\"))
                .unwrap_or_else(|| value.to_string());
            return Some(unquoted);
        }
    }
    None
}

#[tauri::command]
pub fn read_note(path: String) -> CmdResult<String> {
    std::fs::read_to_string(PathBuf::from(path)).map_err(err)
}

#[tauri::command]
pub fn notes_root(manager: State<'_, CaptureManager>) -> CmdResult<String> {
    manager
        .notes_root()
        .map(|p| p.display().to_string())
        .map_err(err)
}

/* ------------------------------------------------------------------ *
 * Recovery
 * ------------------------------------------------------------------ */

#[derive(Debug, serde::Serialize)]
pub struct RecoverableSession {
    pub session_dir: String,
    pub title: String,
    pub date: String,
    pub segment_count: usize,
    pub note_length: usize,
    pub corrupt_lines: usize,
}

/// Interrupted meetings found on disk.
///
/// Called on launch. A non-empty result means a previous run was killed while
/// recording and the user has unsaved work.
#[tauri::command]
pub fn recoverable_sessions(
    manager: State<'_, CaptureManager>,
) -> CmdResult<Vec<RecoverableSession>> {
    let root = manager.notes_root().map_err(err)?;
    Ok(store::scan_recoverable(&root)
        .into_iter()
        .map(|r| RecoverableSession {
            session_dir: r.session_dir.display().to_string(),
            title: r.replay.meeting.title,
            date: r.replay.meeting.date,
            segment_count: r.replay.meeting.transcript.len(),
            note_length: r.replay.meeting.notes.len(),
            corrupt_lines: r.replay.corrupt_lines,
        })
        .collect())
}

/// Write a recovered session to Markdown and discard its journal.
#[tauri::command]
pub fn recover_session(
    manager: State<'_, CaptureManager>,
    session_dir: String,
) -> CmdResult<String> {
    let dir = PathBuf::from(session_dir);
    let replay = store::journal::replay(&dir).map_err(err)?;
    let root = manager.notes_root().map_err(err)?;

    let path = store::write_note(&root, &replay.meeting).map_err(err)?;
    // Discarded only once the note exists.
    let _ = store::discard_session(&dir);

    Ok(path.display().to_string())
}

/// Delete a recovered session without saving it.
#[tauri::command]
pub fn discard_session(session_dir: String) -> CmdResult<()> {
    store::discard_session(&PathBuf::from(session_dir)).map_err(err)
}

#[tauri::command]
pub fn reveal_notes_folder(manager: State<'_, CaptureManager>) -> CmdResult<String> {
    let root = manager.notes_root().map_err(err)?;
    std::fs::create_dir_all(&root).map_err(err)?;
    Ok(root.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontmatter_fields_are_read_back() {
        let md = "---\ntitle: Client Alpha\ndate: 2026-09-05\n---\n\n# Client Alpha\n";
        assert_eq!(
            frontmatter_field(md, "title").as_deref(),
            Some("Client Alpha")
        );
        assert_eq!(frontmatter_field(md, "date").as_deref(), Some("2026-09-05"));
    }

    #[test]
    fn quoted_frontmatter_is_unwrapped() {
        // The serialiser quotes anything YAML-ambiguous; reading must undo it.
        let md = "---\ntitle: \"Q3: Planning\"\n---\n";
        assert_eq!(
            frontmatter_field(md, "title").as_deref(),
            Some("Q3: Planning")
        );
    }

    #[test]
    fn escaped_quotes_survive_the_round_trip() {
        let md = "---\ntitle: \"has \\\"quotes\\\"\"\n---\n";
        assert_eq!(
            frontmatter_field(md, "title").as_deref(),
            Some("has \"quotes\"")
        );
    }

    #[test]
    fn a_note_without_frontmatter_yields_nothing() {
        assert_eq!(frontmatter_field("# Just a heading\n", "title"), None);
        assert_eq!(frontmatter_field("", "title"), None);
    }

    #[test]
    fn body_content_is_not_mistaken_for_frontmatter() {
        // A line in the body that looks like a field must not be picked up.
        let md = "---\ntitle: Real\n---\n\ntitle: not this one\n";
        assert_eq!(frontmatter_field(md, "title").as_deref(), Some("Real"));
    }

    #[test]
    fn a_missing_field_is_none_not_empty() {
        let md = "---\ntitle: Only title\n---\n";
        assert_eq!(frontmatter_field(md, "project"), None);
    }
}

/// Regenerate the structured notes for a saved meeting.
///
/// Reads the session id from the note's frontmatter, replays that journal, and
/// runs synthesis again — so this works on the original transcript rather than
/// on the rendered Markdown, which is deliberately never re-parsed.
///
/// Fails clearly when the journal is gone: notes recovered from a much older
/// version, or discarded manually, cannot be regenerated and the user should
/// be told rather than shown a silent no-op.
#[tauri::command]
pub async fn regenerate_notes(
    app: AppHandle,
    manager: State<'_, CaptureManager>,
    note_path: String,
) -> CmdResult<()> {
    let root = manager.notes_root().map_err(err)?;
    let path = PathBuf::from(&note_path);

    let text = std::fs::read_to_string(&path).map_err(err)?;
    let session_id =
        frontmatter_field(&text, "id").ok_or_else(|| "this note has no session id".to_string())?;

    let session_dir = store::session_for_note(&root, &session_id);
    if !session_dir.join("session.jsonl").exists() {
        return Err(
            "the original transcript record for this meeting is no longer available".into(),
        );
    }

    // Off the async runtime: synthesis on a long meeting is seconds to
    // minutes of blocking work.
    tauri::async_runtime::spawn_blocking(move || {
        crate::capture_manager::regenerate(&app, &session_dir, &path);
    })
    .await
    .map_err(err)
}

/// Whether a saved note already has generated sections.
#[tauri::command]
pub fn note_is_enhanced(path: String) -> bool {
    std::fs::read_to_string(PathBuf::from(path))
        .map(|text| text.contains("\n## Summary\n"))
        .unwrap_or(false)
}
