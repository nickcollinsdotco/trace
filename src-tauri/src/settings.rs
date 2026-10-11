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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SummaryMemory {
    /// Loaded when a meeting starts, so notes are ready sooner after it ends.
    /// The first load after a boot takes about a minute.
    DuringMeetings,
    /// Loaded only to write notes, and released straight after — for machines
    /// where the model and a video call compete for the same memory.
    WhileWriting,
}

/// Memory at which keeping the model loaded through meetings is the default.
///
/// The 14B is ~11 GiB loaded, and a meeting is when a call, a browser and
/// whatever else is open are using the most memory they will all day. Below
/// this, holding it through the call is how a busy machine was tipped over;
/// above it, there is room for both. 48 GiB rather than 32 because a "32 GB"
/// machine reports about 31, and that is the one that froze.
pub const DURING_MEETINGS_FROM: u64 = 48 << 30;

impl SummaryMemory {
    /// What a machine with `total_ram` bytes should do unless told otherwise.
    pub fn recommended(total_ram: u64) -> Self {
        if total_ram >= DURING_MEETINGS_FROM {
            Self::DuringMeetings
        } else {
            Self::WhileWriting
        }
    }
}

/// When the mini window opens by itself during a meeting (docs/13, Q16).
///
/// Off until the user says otherwise: windows that appear unasked are what
/// people complain about most in this kind of app. The first minimise during
/// a meeting offers it once, inline, instead.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MiniAuto {
    #[default]
    Off,
    /// When TRACE is minimised.
    Minimised,
    /// When TRACE is minimised or loses focus to another app — what actually
    /// happens on a call, where people Alt+Tab to it rather than minimise.
    SwitchAway,
    /// From the moment a meeting starts.
    Always,
}

/// Where the mini window was left on one monitor, by its bottom-right
/// corner, in logical pixels: the window grows up and to the left from that
/// corner, so it holds whatever size the window is showing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MiniPlace {
    pub monitor: String,
    pub right: f64,
    pub bottom: f64,
}

/// The mini window from anywhere, unless the user picks another.
///
/// Four keys, because every shorter combination worth having is taken by
/// something on somebody's machine — Ctrl+Alt+R was, by a browser. M for mini.
pub const DEFAULT_MINI_SHORTCUT: &str = "Ctrl+Shift+Alt+M";

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
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
    /// The user's choice; `None` follows `SummaryMemory::recommended`.
    summary_memory_choice: Option<SummaryMemory>,
    /// Superseded by `summary_memory_choice`. Every file used to carry it,
    /// chosen or not, so only "while writing" — never the old default — can
    /// be read as a choice. Never written back.
    #[serde(rename = "summary_memory", skip_serializing)]
    legacy_summary_memory: Option<SummaryMemory>,
    /// Microphone the setup panel selects first, by device name.
    pub default_mic: Option<String>,
    pub mini_auto: MiniAuto,
    /// The one-time offer has been made, accepted or not.
    pub mini_offered: bool,
    pub mini_places: Vec<MiniPlace>,
    /// `None` is the default; an empty string is no shortcut at all.
    pub mini_shortcut: Option<String>,
}

impl Settings {
    pub fn mini_shortcut(&self) -> String {
        self.mini_shortcut
            .clone()
            .unwrap_or_else(|| DEFAULT_MINI_SHORTCUT.to_string())
    }

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

    /// The user's choice, or what suits this machine's memory.
    pub fn summary_memory(&self) -> SummaryMemory {
        self.summary_memory_for(crate::memory::total_ram())
    }

    fn summary_memory_for(&self, total_ram: u64) -> SummaryMemory {
        self.chosen_summary_memory()
            .unwrap_or_else(|| SummaryMemory::recommended(total_ram))
    }

    fn chosen_summary_memory(&self) -> Option<SummaryMemory> {
        self.summary_memory_choice.or(self
            .legacy_summary_memory
            .filter(|m| *m == SummaryMemory::WhileWriting))
    }

    pub fn set_summary_memory(&mut self, memory: SummaryMemory) {
        self.summary_memory_choice = Some(memory);
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
    /// Nobody has chosen, so `summary_memory` is what suits this machine.
    pub summary_memory_auto: bool,
    pub summary_memory_recommended: SummaryMemory,
    /// What the recommendation was made from, so Settings can say so.
    pub memory_total_bytes: u64,
    pub default_mic: Option<String>,
    pub mini_auto: MiniAuto,
    /// Empty for none.
    pub mini_shortcut: String,
    /// Another app held it when TRACE started, so it does nothing — said in
    /// Settings, and left out of every hint that would promise it works.
    pub mini_shortcut_taken: bool,
}

impl From<&Settings> for SettingsView {
    fn from(s: &Settings) -> Self {
        Self {
            audio_retention: s.audio_retention(),
            speech_model: crate::models::active_speech_model().id.to_string(),
            summary_model: s.summary_model.clone(),
            summary_memory: s.summary_memory(),
            summary_memory_auto: s.chosen_summary_memory().is_none(),
            summary_memory_recommended: SummaryMemory::recommended(crate::memory::total_ram()),
            memory_total_bytes: crate::memory::total_ram(),
            default_mic: s.default_mic.clone(),
            mini_auto: s.mini_auto,
            mini_shortcut: s.mini_shortcut(),
            mini_shortcut_taken: crate::windows::shortcut_taken(),
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

    const GIB: u64 = 1 << 30;

    #[test]
    fn the_model_stays_out_of_meetings_unless_the_machine_has_room_for_both() {
        let s = Settings::default();
        assert_eq!(s.summary_memory_for(31 * GIB), SummaryMemory::WhileWriting);
        assert_eq!(
            s.summary_memory_for(64 * GIB),
            SummaryMemory::DuringMeetings
        );
    }

    #[test]
    fn a_choice_beats_the_recommendation_either_way() {
        let mut s = Settings::default();
        s.set_summary_memory(SummaryMemory::DuringMeetings);
        assert_eq!(
            s.summary_memory_for(16 * GIB),
            SummaryMemory::DuringMeetings
        );
        s.set_summary_memory(SummaryMemory::WhileWriting);
        assert_eq!(s.summary_memory_for(128 * GIB), SummaryMemory::WhileWriting);
    }

    #[test]
    fn an_old_file_keeps_only_what_it_can_prove_was_chosen() {
        // "during_meetings" was written for everyone, chosen or not.
        let s: Settings = serde_json::from_str(r#"{"summary_memory":"during_meetings"}"#).unwrap();
        assert_eq!(s.summary_memory_for(31 * GIB), SummaryMemory::WhileWriting);
        assert_eq!(s.chosen_summary_memory(), None);
        // "while_writing" was only ever a choice.
        let s: Settings = serde_json::from_str(r#"{"summary_memory":"while_writing"}"#).unwrap();
        assert_eq!(s.summary_memory_for(64 * GIB), SummaryMemory::WhileWriting);

        let json = serde_json::to_string(&s).unwrap();
        assert!(!json.contains("\"summary_memory\""), "{json}");
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
