//! Interim notes rewritten with the chosen model while nobody is using the
//! machine.
//!
//! When the chosen summary model has no room after a meeting, a smaller one
//! writes interim notes (`capture_manager::Quality`). Those are worth having
//! but not keeping: on real meetings the 8B padded decisions and lost track
//! of who said what. So the better notes are written later, by themselves,
//! when they cost the user nothing — no meeting or other notes in progress,
//! nobody at the keyboard, and the chosen model fitting on the graphics card
//! without spilling into system memory. If the machine fills up part-way,
//! the rewrite gives way and the interim notes stay.
//!
//! Notes whose body was edited outside TRACE are left alone: a rewrite would
//! set those edits aside, which is for the user to choose, from the note.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use crate::capture_manager::{CaptureManager, Quality};
use crate::diagnostics;

/// Nobody has touched the machine for this long.
pub const IDLE_FOR: Duration = Duration::from_secs(5 * 60);

/// How often to look.
const LOOK_EVERY: Duration = Duration::from_secs(60);

/// How long a note that could not be upgraded is left before trying again.
const RETRY_AFTER: Duration = Duration::from_secs(30 * 60);

/// Notes tried this run, and when. Stopped by the user means not again until
/// TRACE next starts: they said no.
static TRIED: Mutex<Vec<(PathBuf, Option<Instant>)>> = Mutex::new(Vec::new());

/// Look for interim notes to upgrade, for as long as TRACE runs.
pub fn watch(app: AppHandle) {
    let spawned = std::thread::Builder::new()
        .name("trace-upgrade".into())
        .spawn(move || loop {
            std::thread::sleep(LOOK_EVERY);
            if let Some((session_dir, note)) = next(&app) {
                upgrade(&app, &session_dir, &note);
            }
        });
    if let Err(e) = spawned {
        diagnostics::log(format!("could not start the interim-notes watcher: {e}"));
    }
}

/// The note to upgrade now, if now is the time.
fn next(app: &AppHandle) -> Option<(PathBuf, PathBuf)> {
    if crate::busy::is_busy() || idle_for()? < IDLE_FOR {
        return None;
    }
    let manager = app.state::<CaptureManager>();
    let notes = manager.notes_root().ok()?;
    let sessions = manager.sessions_root().ok()?;

    let candidates: Vec<(PathBuf, PathBuf)> = crate::store::interim_notes(&notes)
        .into_iter()
        .filter(|note| due(note))
        .filter(|note| {
            std::fs::read_to_string(note)
                .ok()
                .is_some_and(|text| crate::store::markdown::body_edited(&text) != Some(true))
        })
        .filter_map(|note| {
            let session = crate::commands::replayable_session(&sessions, &note).ok()?;
            Some((session, note))
        })
        .collect();
    let first = candidates.into_iter().next()?;

    // Asked last, being the slowest: only worth it with a note to write.
    let crate::synthesis::ollama::Readiness::Ready { model } =
        crate::synthesis::ollama::Readiness::check()
    else {
        return None;
    };
    let check = crate::memory::check(&model);
    matches!(
        check.verdict,
        crate::memory::Verdict::OnGpu | crate::memory::Verdict::Resident
    )
    .then_some(first)
}

/// Not tried this run, or tried long enough ago and not stopped by the user.
fn due(note: &std::path::Path) -> bool {
    let tried = TRIED.lock().unwrap_or_else(|e| e.into_inner());
    match tried.iter().find(|(p, _)| p == note) {
        None => true,
        Some((_, Some(at))) => at.elapsed() >= RETRY_AFTER,
        Some((_, None)) => false,
    }
}

fn upgrade(app: &AppHandle, session_dir: &std::path::Path, note: &std::path::Path) {
    diagnostics::log("machine idle: rewriting interim notes with the chosen model");
    let _ = crate::capture_manager::regenerate(app, session_dir, note, Quality::Upgrade);

    // Still interim means it did not finish; stopped by the user means leave
    // it be. Either way, not straight away again.
    let stopped = crate::activity::ACTIVITY.snapshot().iter().any(|j| {
        j.note_path == note.display().to_string()
            && matches!(j.outcome, Some(crate::activity::Outcome::Stopped))
    });
    let mut tried = TRIED.lock().unwrap_or_else(|e| e.into_inner());
    tried.retain(|(p, _)| p != note);
    tried.push((note.to_path_buf(), (!stopped).then(Instant::now)));
}

/// How long since the last keyboard or mouse input, anywhere on the machine.
#[cfg(windows)]
pub fn idle_for() -> Option<Duration> {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    // SAFETY: `info` is a correctly sized LASTINPUTINFO owned by this frame.
    if !unsafe { GetLastInputInfo(&mut info) }.as_bool() {
        return None;
    }
    // Both wrap at 49.7 days, together, so the difference stays right.
    let now = unsafe { GetTickCount() };
    Some(Duration::from_millis(u64::from(
        now.wrapping_sub(info.dwTime),
    )))
}

#[cfg(not(windows))]
pub fn idle_for() -> Option<Duration> {
    None
}

#[cfg(test)]
mod tests {
    #[test]
    fn idle_time_can_be_read() {
        // Smoke test: the call works, and the answer is a time, not garbage.
        let idle = super::idle_for().expect("GetLastInputInfo");
        assert!(idle < std::time::Duration::from_secs(60 * 60 * 24 * 50));
    }
}
