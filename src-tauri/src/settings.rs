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

/// What happens to a meeting's audio once its notes are written.
///
/// An hour of dual-stream capture is roughly 690 MB, and the note plus the
/// journal are the records worth keeping. Audio is how transcription gets
/// debugged — a chunking bug cannot be fixed against audio that was deleted
/// the moment it produced the bad output — so keeping *some* of it is useful,
/// and keeping all of it silently fills a disk. Hence a middle option.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum AudioRetention {
    /// **The default**, and load-bearing rather than incidental: filling the
    /// user's disk has to be something they chose.
    #[default]
    Delete,
    /// The most recent `count` meetings keep their audio; older ones lose it.
    KeepLatest {
        count: u32,
    },
    KeepAll,
}

/// When the summary model occupies memory.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SummaryMemory {
    /// Loaded when a meeting starts, so notes are ready sooner after it ends.
    /// The first load after a boot takes about a minute.
    #[default]
    DuringMeetings,
    /// Loaded only to write notes, and released straight after — for machines
    /// where the model and a video call compete for the same memory.
    WhileWriting,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// Superseded by `audio_retention`, and read only to migrate a file
    /// written before it existed. Never written back.
    #[serde(skip_serializing)]
    keep_audio: bool,
    audio_retention: Option<AudioRetention>,

    /// Speech model id. `None` means the default; see
    /// `models::active_speech_model`.
    pub speech_model: Option<String>,
    /// Ollama model name. `None` means the first preferred one installed.
    pub summary_model: Option<String>,
    pub summary_memory: SummaryMemory,
    /// Microphone the setup panel selects first, by device name.
    pub default_mic: Option<String>,
}

impl Settings {
    pub fn audio_retention(&self) -> AudioRetention {
        self.audio_retention.unwrap_or(if self.keep_audio {
            AudioRetention::KeepAll
        } else {
            AudioRetention::Delete
        })
    }

    pub fn set_audio_retention(&mut self, retention: AudioRetention) {
        self.audio_retention = Some(retention);
    }
}

/// Settings as the UI reads them: the retention already resolved, so the
/// migration from `keep_audio` never has to be understood by the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct SettingsView {
    pub audio_retention: AudioRetention,
    pub speech_model: String,
    pub summary_model: Option<String>,
    pub summary_memory: SummaryMemory,
    pub default_mic: Option<String>,
}

impl From<&Settings> for SettingsView {
    fn from(s: &Settings) -> Self {
        Self {
            audio_retention: s.audio_retention(),
            speech_model: crate::models::active_speech_model().id.to_string(),
            summary_model: s.summary_model.clone(),
            summary_memory: s.summary_memory,
            default_mic: s.default_mic.clone(),
        }
    }
}

/// Load, change and save in one step.
pub fn update(change: impl FnOnce(&mut Settings)) -> Result<Settings, String> {
    let mut settings = load();
    change(&mut settings);
    save(&settings)?;
    Ok(settings)
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
        assert_eq!(
            Settings::default().audio_retention(),
            AudioRetention::Delete
        );
    }

    #[test]
    fn an_old_keep_audio_file_keeps_meaning_what_it_meant() {
        let s: Settings = serde_json::from_str(r#"{"keep_audio":true}"#).unwrap();
        assert_eq!(s.audio_retention(), AudioRetention::KeepAll);
        let s: Settings = serde_json::from_str(r#"{"keep_audio":false}"#).unwrap();
        assert_eq!(s.audio_retention(), AudioRetention::Delete);
    }

    #[test]
    fn the_old_flag_is_not_written_back() {
        let mut s: Settings = serde_json::from_str(r#"{"keep_audio":true}"#).unwrap();
        s.set_audio_retention(AudioRetention::KeepLatest { count: 5 });
        let json = serde_json::to_string(&s).unwrap();
        assert!(!json.contains("keep_audio"), "{json}");
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(
            back.audio_retention(),
            AudioRetention::KeepLatest { count: 5 }
        );
    }

    #[test]
    fn unknown_fields_do_not_reset_the_rest() {
        let s: Settings =
            serde_json::from_str(r#"{"summary_model":"qwen3:14b","future":42}"#).unwrap();
        assert_eq!(s.summary_model.as_deref(), Some("qwen3:14b"));
    }

    #[test]
    fn retention_crosses_ipc_as_a_tagged_mode() {
        let json = serde_json::to_value(AudioRetention::KeepLatest { count: 3 }).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "mode": "keep_latest", "count": 3 })
        );
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
