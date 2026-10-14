//! Updates from GitHub Releases, fetched only when someone clicks the version.
//!
//! Nothing here runs by itself: TRACE does not go online on its own, and a
//! click is the user asking. Releases are made by `pnpm release` on this
//! machine (`scripts/release.mjs`) and are not Authenticode-signed. What
//! proves an update came from us is the updater's own key — the public half
//! is in `tauri.conf.json`, and the plugin refuses a download whose
//! signature does not match it.

use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::capture_manager::CaptureManager;

pub const EVENT_PROGRESS: &str = "trace://update-progress";
pub const EVENT_FAILED: &str = "trace://update-failed";

/// Long enough to read "restarting to install" before the window goes.
const RESTART_PAUSE: Duration = Duration::from_millis(1500);

/// The update the last check found, so installing fetches exactly what was
/// offered rather than whatever is newest by the time of the click.
#[derive(Default)]
pub struct Pending(Mutex<Option<Update>>);

/// What a check found. Mirrors `UpdateCheck` in `src/lib/ipc.ts`.
#[derive(Debug, serde::Serialize)]
pub struct UpdateCheck {
    /// The newer version on offer, or `None` when this one is the latest.
    pub latest: Option<String>,
}

#[derive(Clone, serde::Serialize)]
struct Progress {
    percent: f64,
}

#[derive(Clone, serde::Serialize)]
struct Failed {
    message: String,
}

/// Why installing now would lose something, if it would.
///
/// Installing closes TRACE, and a meeting closed mid-recording ends there.
pub fn refusal(app: &AppHandle) -> Option<&'static str> {
    if app.state::<CaptureManager>().status().is_some() {
        Some("a meeting is recording — update once it has ended")
    } else if crate::busy::is_busy() {
        Some("notes are being written — update once they are done")
    } else {
        None
    }
}

/// Ask GitHub whether there is a newer TRACE.
pub async fn check(app: &AppHandle) -> Result<UpdateCheck, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let found = updater.check().await.map_err(|e| {
        crate::diagnostics::log(format!("update check failed: {e}"));
        plain(&e)
    })?;
    let latest = found.as_ref().map(|u| u.version.clone());
    crate::diagnostics::log(match &latest {
        Some(v) => format!("update check: {v} available"),
        None => "update check: up to date".to_string(),
    });
    *app.state::<Pending>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = found;
    Ok(UpdateCheck { latest })
}

/// Download the update the last check found, then close TRACE and run its
/// installer.
///
/// Resolves once the download is verified, so the status bar can say it is
/// restarting; the installer starts a moment later. If that fails, the
/// failure arrives as an event, since the command has already answered.
pub async fn install(app: AppHandle) -> Result<(), String> {
    if let Some(why) = refusal(&app) {
        return Err(why.to_string());
    }
    let update = app
        .state::<Pending>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
        .ok_or("nothing to install — check for updates first")?;

    crate::diagnostics::log(format!("update {}: downloading", update.version));
    let mut received = 0usize;
    let mut shown = -1.0;
    let emitter = app.clone();
    let bytes = update
        .download(
            |chunk, total| {
                received += chunk;
                let percent = percent(received, total);
                // Whole percents only: a chunk is a few KB, and an event per
                // chunk would be thousands of re-renders for one bar.
                if percent != shown {
                    shown = percent;
                    let _ = emitter.emit(EVENT_PROGRESS, Progress { percent });
                }
            },
            || {},
        )
        .await
        .map_err(|e| {
            crate::diagnostics::log(format!("update {}: download failed: {e}", update.version));
            plain(&e)
        })?;

    crate::diagnostics::log(format!(
        "update {}: downloaded {} bytes, installing",
        update.version,
        bytes.len()
    ));
    // A thread rather than a task: installing is blocking, and ends the
    // process.
    std::thread::spawn(move || {
        std::thread::sleep(RESTART_PAUSE);
        // Looked at again: a meeting could have started in the pause.
        let result = match refusal(&app) {
            Some(why) => Err(why.to_string()),
            // Runs the installer and exits; it only returns if that failed.
            None => update.install(bytes).map_err(|e| e.to_string()),
        };
        if let Err(message) = result {
            crate::diagnostics::log(format!(
                "update {}: install failed: {message}",
                update.version
            ));
            let _ = app.emit(EVENT_FAILED, Failed { message });
        }
    });
    Ok(())
}

/// Download progress in whole percents. Without a length from the server
/// there is nothing to divide by, so the bar waits at zero.
pub fn percent(received: usize, total: Option<u64>) -> f64 {
    match total {
        Some(total) if total > 0 => ((received as f64 / total as f64) * 100.0)
            .floor()
            .min(100.0),
        _ => 0.0,
    }
}

/// The plugin's errors say what failed inside it; the status bar wants what
/// the user can do about it.
fn plain(e: &tauri_plugin_updater::Error) -> String {
    use tauri_plugin_updater::Error;
    match e {
        Error::Reqwest(_) | Error::Network(_) => {
            "could not reach GitHub — check your connection".to_string()
        }
        Error::ReleaseNotFound => "no release found on GitHub".to_string(),
        Error::TargetNotFound(_) | Error::TargetsNotFound(_) => {
            "the latest release has no Windows build".to_string()
        }
        Error::Minisign(_) | Error::SignatureUtf8(_) | Error::Base64(_) => {
            "the download's signature did not match — not installed".to_string()
        }
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_is_whole_and_capped() {
        assert_eq!(percent(0, Some(1000)), 0.0);
        assert_eq!(percent(426, Some(1000)), 42.0);
        assert_eq!(percent(1000, Some(1000)), 100.0);
        assert_eq!(percent(1200, Some(1000)), 100.0);
    }

    #[test]
    fn percent_waits_without_a_length() {
        assert_eq!(percent(5000, None), 0.0);
        assert_eq!(percent(5000, Some(0)), 0.0);
    }
}
