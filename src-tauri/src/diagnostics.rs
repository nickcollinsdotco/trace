//! A small event log, and a report of the machine's state for bug reports.
//!
//! # Why a log file at all
//!
//! Everything that went wrong used to go to `eprintln!`, which in an installed
//! app goes nowhere. The failures that matter most — synthesis dying on a real
//! meeting, a stream dropping forty minutes in — happen when no terminal is
//! open, and by the time anyone asks what happened the only record is memory.
//!
//! # What is logged, and what is not
//!
//! Events, counts, durations and error messages. **Never transcript text or
//! notes**, because this file exists to be sent to someone else. The one
//! exception is outside TRACE's control: an error message may quote a short
//! sample of what the model produced, which can echo the transcript. The
//! diagnostics screen says so.
//!
//! Plain text, one line per event, rotated at a fixed size. No logging
//! framework: there is one writer and one reader, and both are here.

use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;

use crate::models::{self, ModelSpec};
use crate::synthesis::ollama::{self, LoadedModel, OllamaProvider, Readiness};

/// Rotate past this size. A few thousand events — weeks of normal use.
const MAX_LOG_BYTES: u64 = 512 * 1024;

/// Lines of recent history included in a report.
const REPORT_LINES: usize = 80;

/// Serialises appends, so two threads cannot interleave half-lines.
static WRITE: Mutex<()> = Mutex::new(());

/// `%LOCALAPPDATA%\TRACE\logs`, beside the models and settings.
pub fn log_dir() -> Option<PathBuf> {
    models::models_root().ok()?.parent().map(|p| p.join("logs"))
}

fn log_path() -> Option<PathBuf> {
    log_dir().map(|d| d.join("trace.log"))
}

/// Record one event. Best-effort: logging must never be why something fails.
///
/// Also echoed to stderr, so `pnpm tauri dev` shows it as it happens.
pub fn log(event: impl AsRef<str>) {
    let event = event.as_ref();
    eprintln!("trace: {event}");

    let Some(path) = log_path() else {
        return;
    };
    let _guard = WRITE.lock();
    let _ = append(&path, event);
}

fn append(path: &std::path::Path, event: &str) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    if std::fs::metadata(path).is_ok_and(|m| m.len() > MAX_LOG_BYTES) {
        // One previous file is kept, so a rotation never loses the event that
        // prompted someone to look.
        let _ = std::fs::rename(path, path.with_extension("log.1"));
    }

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    // One event per line, whatever the message contained.
    let line = event.replace(['\r', '\n'], " ");
    writeln!(
        file,
        "{} {line}",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S")
    )
}

/// The last `n` lines of the log, oldest first.
pub fn tail(n: usize) -> Vec<String> {
    let Some(text) = log_path().and_then(|p| std::fs::read_to_string(p).ok()) else {
        return Vec::new();
    };
    last_lines(&text, n)
}

fn last_lines(text: &str, n: usize) -> Vec<String> {
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(n)..]
        .iter()
        .map(|l| l.to_string())
        .collect()
}

/// Log panics before the process dies, since a panic is exactly the event
/// nobody sees in an installed app.
pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log(format!("PANIC {info}"));
        previous(info);
    }));
}

/// Everything worth knowing when something has gone wrong, in one place.
#[derive(Debug, Clone, Serialize)]
pub struct Report {
    pub app_version: String,
    pub dev_build: bool,
    pub os: String,
    pub cpu: String,
    pub threads: usize,
    pub memory_bytes: u64,
    pub accelerator: String,

    pub speech_model: &'static str,
    pub speech_installed: bool,

    pub llm: Readiness,
    pub ollama_version: Option<String>,
    pub preferred_models: Vec<&'static str>,
    pub loaded_models: Vec<LoadedModel>,
    pub context_tokens: u32,

    pub keep_audio: bool,
    pub notes_root: String,
    pub log_dir: String,
    pub recent: Vec<String>,
}

/// Gather the report. Blocking: probes Ollama, bounded by its short timeout.
pub fn report(app_version: String, spec: &ModelSpec, notes_root: String) -> Report {
    let system = crate::system::report(spec);
    Report {
        app_version,
        dev_build: cfg!(debug_assertions),
        os: format!("{} ({})", system.os, system.kernel),
        cpu: system.cpu,
        threads: system.threads,
        memory_bytes: system.memory_bytes,
        accelerator: system.accelerator,
        speech_model: system.model_name,
        speech_installed: system.installed,
        llm: Readiness::check(),
        ollama_version: OllamaProvider::version(),
        preferred_models: ollama::PREFERRED.to_vec(),
        loaded_models: OllamaProvider::loaded(),
        context_tokens: ollama::NUM_CTX,
        keep_audio: crate::settings::load().keep_audio,
        notes_root,
        log_dir: log_dir()
            .map(|d| d.display().to_string())
            .unwrap_or_default(),
        recent: tail(REPORT_LINES),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("trace-diag-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("trace.log")
    }

    #[test]
    fn a_multi_line_message_stays_one_event() {
        // An error with a newline in it must not look like two events, or a
        // tail would cut one in half.
        let path = scratch("oneline");
        append(&path, "first\nsecond\r\nthird").unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(text.lines().count(), 1);
        assert!(text.contains("first second  third"));
    }

    #[test]
    fn the_log_rotates_rather_than_growing_forever() {
        let path = scratch("rotate");
        std::fs::write(&path, "x".repeat(MAX_LOG_BYTES as usize + 1)).unwrap();
        append(&path, "after rotation").unwrap();

        assert!(path.with_extension("log.1").exists(), "previous file kept");
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("after rotation"));
        assert!(text.len() < 100);
    }

    #[test]
    fn the_tail_is_the_most_recent_lines_in_order() {
        let text = "a\nb\nc\nd\n";
        assert_eq!(last_lines(text, 2), vec!["c", "d"]);
        assert_eq!(last_lines(text, 10).len(), 4);
        assert!(last_lines("", 5).is_empty());
    }

    #[test]
    fn logs_sit_beside_the_models_not_inside_them() {
        let dir = log_dir().unwrap();
        assert!(dir.ends_with("logs"));
        assert!(!dir.starts_with(models::models_root().unwrap()));
    }
}
