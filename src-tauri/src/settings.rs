//! Persistent preferences.
//!
//! Deliberately tiny: one JSON file, read on demand, written atomically. There
//! is no settings framework here because there are barely any settings, and a
//! framework for two fields would be exactly the premature infrastructure
//! `docs/08-CLAUDE-AUDIT-PROMPT.md` warns against.
//!
//! Unreadable or corrupt settings fall back to defaults rather than failing.
//! Losing a preference is a minor annoyance; refusing to start a meeting
//! because a JSON file has a stray brace in it is not a trade worth making.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::models::{models_root, ModelError};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// Keep the raw WAV files after a meeting is finalised.
    ///
    /// **Defaults to false**, and the derived `Default` is load-bearing rather
    /// than incidental: an hour of dual-stream capture is roughly 690 MB, and
    /// the note plus the journal are the records worth keeping. Filling the
    /// user's disk has to be something they chose.
    ///
    /// Turned on, it is how transcription itself gets debugged. A chunking bug
    /// cannot be fixed against audio that was deleted the moment it produced
    /// the bad output — see `docs/10-BACKLOG.md`.
    pub keep_audio: bool,
}

/// `%LOCALAPPDATA%\TRACE\settings.json`, beside the models.
fn settings_path() -> Result<PathBuf, ModelError> {
    Ok(models_root()?
        .parent()
        .map(std::path::Path::to_path_buf)
        .unwrap_or_default()
        .join("settings.json"))
}

pub fn load() -> Settings {
    let Ok(path) = settings_path() else {
        return Settings::default();
    };
    let Ok(text) = std::fs::read_to_string(path) else {
        return Settings::default();
    };
    // `#[serde(default)]` fills in fields added by a later version, so an
    // older file keeps working rather than resetting everything.
    serde_json::from_str(&text).unwrap_or_default()
}

pub fn save(settings: &Settings) -> Result<(), String> {
    let path = settings_path().map_err(|e| e.to_string())?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }

    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;

    // Same temp-then-rename as the note writer: a crash mid-write must not
    // leave a truncated file that reads as defaults on next start.
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&temp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_is_discarded_by_default() {
        // An hour of dual-stream capture is ~690 MB. Keeping it has to be a
        // choice somebody made, not something that happens quietly.
        assert!(!Settings::default().keep_audio);
    }

    #[test]
    fn unknown_fields_do_not_reset_the_rest() {
        let s: Settings = serde_json::from_str(r#"{"keep_audio":true,"future":42}"#).unwrap();
        assert!(s.keep_audio);
    }

    #[test]
    fn a_missing_field_takes_its_default() {
        // Written by an older version that did not have the field yet.
        let s: Settings = serde_json::from_str("{}").unwrap();
        assert!(!s.keep_audio);
    }

    #[test]
    fn corrupt_settings_do_not_propagate_an_error() {
        let s: Settings = serde_json::from_str("{ not json").unwrap_or_default();
        assert_eq!(s, Settings::default());
    }

    #[test]
    fn settings_sit_beside_the_models_not_inside_them() {
        // Inside models/ they would look like model data, and anything that
        // cleared the model directory would take the preferences with it.
        let path = settings_path().unwrap();
        assert!(path.ends_with("settings.json"));
        assert!(!path.starts_with(models_root().unwrap()));
    }
}
