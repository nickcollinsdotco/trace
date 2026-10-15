//! A system notification when notes are ready and nobody is looking.
//!
//! Notes arrive minutes after a meeting, by which time the user is usually in
//! another app. The toast in the corner of TRACE's own window is no use then,
//! so Windows is asked to say it instead — but only then: a notification for
//! something already on screen is noise.
//!
//! The meeting's title is the user's own words and stays on this machine; no
//! transcript text or notes go into a notification.

use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::activity::Outcome;

/// Tell the user a job finished, if TRACE is out of sight.
pub fn notes_finished(app: &AppHandle, title: &str, outcome: &Outcome) {
    let Some((heading, body)) = message(title, outcome) else {
        return;
    };
    if watching(app) {
        return;
    }
    if let Err(e) = app
        .notification()
        .builder()
        .title(heading)
        .body(body)
        .show()
    {
        crate::diagnostics::log(format!("notification could not be shown: {e}"));
    }
}

/// What to say, or nothing for an outcome the user caused themselves.
fn message(title: &str, outcome: &Outcome) -> Option<(&'static str, String)> {
    let title = if title.trim().is_empty() {
        "Untitled meeting"
    } else {
        title.trim()
    };
    match outcome {
        Outcome::Generated { .. } => Some(("Notes ready", title.to_string())),
        Outcome::Failed { message } => {
            Some(("Notes could not be written", format!("{title} — {message}")))
        }
        // They pressed Stop; telling them so is noise.
        Outcome::Stopped => None,
    }
}

/// Whether the main window is in front of the user. Minimised, hidden, or
/// behind another app all count as not; the mini window over a call does too,
/// since the note opens in the main one.
fn watching(app: &AppHandle) -> bool {
    app.get_webview_window("main").is_some_and(|w| {
        w.is_visible().unwrap_or(false)
            && !w.is_minimized().unwrap_or(true)
            && w.is_focused().unwrap_or(false)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ready_notes_name_the_meeting() {
        let generated = Outcome::Generated {
            dropped: 0,
            fabricated: 0,
            uncited: 0,
            kept: None,
        };
        assert_eq!(
            message(" Pricing review ", &generated),
            Some(("Notes ready", "Pricing review".to_string()))
        );
        assert_eq!(message("", &generated).unwrap().1, "Untitled meeting");
    }

    #[test]
    fn a_failure_says_why() {
        let failed = Outcome::Failed {
            message: "Ollama is not running".into(),
        };
        assert_eq!(
            message("Standup", &failed),
            Some((
                "Notes could not be written",
                "Standup — Ollama is not running".to_string()
            ))
        );
    }

    #[test]
    fn a_stop_is_not_announced() {
        assert_eq!(message("Standup", &Outcome::Stopped), None);
    }
}
