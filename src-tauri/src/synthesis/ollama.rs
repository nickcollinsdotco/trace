//! Ollama provider.
//!
//! Talks to a local Ollama instance over HTTP. Nothing leaves the machine:
//! `127.0.0.1` is not a configurable host, deliberately, so that "no audio or
//! transcript leaves this computer" is a property of the code rather than a
//! setting somebody could change by accident.
//!
//! Ollama applies the JSON Schema passed in `format` as a decoding grammar, so
//! structurally invalid output is not merely unlikely but ungeneratable.

use std::time::Duration;

use super::schema::{json_schema, SynthesisOutput};
use super::{prompt, LlmProvider, SynthesisError};

/// Local-only. Not configurable, by design.
const HOST: &str = "http://127.0.0.1:11434";

/// Generous, because it is a local model on unknown hardware.
///
/// An hour-long transcript through a 12B on a modest GPU can take minutes, and
/// timing out on a meeting the user just recorded would be worse than waiting.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(600);
const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

pub struct OllamaProvider {
    model: String,
}

impl OllamaProvider {
    pub fn new(model: impl Into<String>) -> Self {
        Self {
            model: model.into(),
        }
    }

    pub fn model(&self) -> &str {
        &self.model
    }

    /// Models the local instance has pulled.
    pub fn list_models() -> Result<Vec<String>, SynthesisError> {
        let response = ureq::get(&format!("{HOST}/api/tags"))
            .config()
            .timeout_global(Some(PROBE_TIMEOUT))
            .build()
            .call()
            .map_err(|e| SynthesisError::Unavailable(e.to_string()))?;

        let body: serde_json::Value = response
            .into_body()
            .read_json()
            .map_err(|e| SynthesisError::Malformed(e.to_string()))?;

        Ok(body["models"]
            .as_array()
            .map(|models| {
                models
                    .iter()
                    .filter_map(|m| m["name"].as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default())
    }

    /// Whether Ollama is running at all.
    pub fn service_running() -> bool {
        ureq::get(&format!("{HOST}/api/version"))
            .config()
            .timeout_global(Some(PROBE_TIMEOUT))
            .build()
            .call()
            .is_ok()
    }
}

/// Models tried first, in order, when more than one is installed.
const PREFERRED: &[&str] = &["qwen3:8b", "gemma3:12b"];

/// The model to suggest pulling when none is installed.
pub const SUGGESTED_MODEL: &str = PREFERRED[0];

/// Whether notes can be generated right now, and if not, why.
///
/// Three states rather than a boolean because the fixes differ: a closed
/// Ollama needs opening, an empty one needs a model pulled, and telling the
/// user the wrong one sends them looking in the wrong place.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum Readiness {
    NotRunning,
    /// Carries the model to pull, so the UI never has its own copy to drift.
    NoModel {
        suggested: &'static str,
    },
    Ready {
        model: String,
    },
}

impl Readiness {
    /// Probe the local instance. Two short requests at most.
    pub fn check() -> Self {
        match OllamaProvider::list_models() {
            Err(_) => Readiness::NotRunning,
            Ok(installed) => match pick_model(&installed) {
                Some(model) => Readiness::Ready { model },
                None => Readiness::NoModel {
                    suggested: SUGGESTED_MODEL,
                },
            },
        }
    }

    /// What to tell the user, in the words of the failure they will see.
    pub fn guidance(&self) -> Option<String> {
        match self {
            Readiness::NotRunning => Some(
                "Ollama is not running, so notes could not be written. Open Ollama and try again"
                    .into(),
            ),
            Readiness::NoModel { suggested } => Some(format!(
                "Ollama has no model installed. Run `ollama pull {suggested}` and try again"
            )),
            Readiness::Ready { .. } => None,
        }
    }
}

/// Prefer a known-good default, falling back to whatever is installed, so a
/// user who pulled a different model still gets notes rather than silence.
pub fn pick_model(installed: &[String]) -> Option<String> {
    PREFERRED
        .iter()
        .find(|p| installed.iter().any(|m| m == *p))
        .map(|s| (*s).to_string())
        .or_else(|| installed.first().cloned())
}

/// Open Ollama, for a user who quit it.
///
/// Prefers the desktop app, which is how Ollama is normally run on Windows and
/// which puts its tray icon back. `ollama serve` is the fallback for an
/// install without the app. Neither is waited on: the caller polls
/// `Readiness::check` instead, because Ollama takes a few seconds to listen
/// and a launched process says nothing about when it is ready.
pub fn launch() -> Result<(), String> {
    use std::process::{Command, Stdio};

    #[cfg(windows)]
    {
        if let Some(app) = std::env::var_os("LOCALAPPDATA")
            .map(|d| std::path::PathBuf::from(d).join("Programs\\Ollama\\ollama app.exe"))
            .filter(|p| p.exists())
        {
            return Command::new(app)
                .spawn()
                .map(drop)
                .map_err(|e| e.to_string());
        }
    }

    let mut serve = Command::new("ollama");
    serve
        .arg("serve")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    // Without this a console window opens beside TRACE and closing it kills
    // Ollama.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        serve.creation_flags(CREATE_NO_WINDOW);
    }

    serve.spawn().map(drop).map_err(|_| {
        "Ollama could not be found. Install it from ollama.com, or open it from the Start menu"
            .to_string()
    })
}

impl LlmProvider for OllamaProvider {
    fn name(&self) -> String {
        format!("ollama/{}", self.model)
    }

    fn available(&self) -> bool {
        // Checks the specific model, not just the service. A running Ollama
        // with the wrong model pulled fails at generation time otherwise,
        // after the user has already recorded a meeting.
        Self::list_models()
            .map(|models| models.iter().any(|m| m == &self.model))
            .unwrap_or(false)
    }

    fn synthesize(&self, user_prompt: &str) -> Result<SynthesisOutput, SynthesisError> {
        let request = serde_json::json!({
            "model": self.model,
            "system": prompt::SYSTEM_PROMPT,
            "prompt": user_prompt,
            "stream": false,
            // Applied as a decoding grammar, not a suggestion.
            "format": json_schema(),
            "options": {
                // Low but not zero. Deterministic decoding under a grammar can
                // get stuck repeating a structure; a little entropy avoids
                // that without inviting invention.
                "temperature": 0.2,
                "num_predict": 2048
            }
        });

        let response = ureq::post(&format!("{HOST}/api/generate"))
            .config()
            .timeout_global(Some(REQUEST_TIMEOUT))
            .build()
            .send_json(&request)
            .map_err(|e| {
                // The most likely failure by far is that Ollama is not
                // running, so say that rather than surfacing a socket error.
                if !Self::service_running() {
                    SynthesisError::Unavailable(
                        "Ollama is not running. Start it and try again.".into(),
                    )
                } else {
                    SynthesisError::Request(e.to_string())
                }
            })?;

        let body: serde_json::Value = response
            .into_body()
            .read_json()
            .map_err(|e| SynthesisError::Malformed(e.to_string()))?;

        let text = body["response"]
            .as_str()
            .ok_or_else(|| SynthesisError::Malformed("no `response` field".into()))?;

        parse_output(text)
    }
}

/// Parse the model's JSON, tolerating the wrappers models sometimes add.
///
/// The grammar should make this unnecessary. It is here because a proxy, an
/// older Ollama, or a model that ignores `format` would otherwise turn a
/// recoverable formatting quirk into a lost summary.
fn parse_output(text: &str) -> Result<SynthesisOutput, SynthesisError> {
    let trimmed = text.trim();

    if let Ok(parsed) = serde_json::from_str::<SynthesisOutput>(trimmed) {
        return Ok(parsed);
    }

    // Fenced code block, with or without a language tag.
    let unfenced = trimmed
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    if let Ok(parsed) = serde_json::from_str::<SynthesisOutput>(unfenced) {
        return Ok(parsed);
    }

    // Prose around a JSON object.
    if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if start < end {
            if let Ok(parsed) = serde_json::from_str::<SynthesisOutput>(&trimmed[start..=end]) {
                return Ok(parsed);
            }
        }
    }

    Err(SynthesisError::Malformed(format!(
        "could not read JSON from: {}",
        trimmed.chars().take(200).collect::<String>()
    )))
}

/// Ask Ollama to load a model into memory without generating anything.
///
/// Called when a meeting starts. The first request after a cold boot pays the
/// full model load — measured at roughly a minute for the initial read from
/// disk — and paying that during the meeting, rather than after it, means the
/// user never waits for it.
///
/// Entirely best-effort: a failure here costs nothing but the warmup.
pub fn warm(model: &str) {
    let model = model.to_string();
    std::thread::Builder::new()
        .name("trace-llm-warm".into())
        .spawn(move || {
            let _ = ureq::post(&format!("{HOST}/api/generate"))
                .config()
                .timeout_global(Some(Duration::from_secs(300)))
                .build()
                .send_json(serde_json::json!({
                    "model": model,
                    // Empty prompt loads the model without generating.
                    "prompt": "",
                    // Stay resident for a long meeting rather than the
                    // five-minute default, which would unload mid-call.
                    "keep_alive": "2h"
                }));
        })
        .ok();
}
#[cfg(test)]
mod tests {
    use super::*;

    const VALID: &str = r#"{"summary":"We talked.","key_points":[],"decisions":[],
        "action_items":[],"open_questions":[]}"#;

    #[test]
    fn plain_json_parses() {
        assert_eq!(parse_output(VALID).unwrap().summary, "We talked.");
    }

    #[test]
    fn fenced_json_parses() {
        let fenced = format!("```json\n{VALID}\n```");
        assert_eq!(parse_output(&fenced).unwrap().summary, "We talked.");
    }

    #[test]
    fn unlabelled_fences_parse() {
        let fenced = format!("```\n{VALID}\n```");
        assert!(parse_output(&fenced).is_ok());
    }

    #[test]
    fn json_wrapped_in_prose_parses() {
        let chatty = format!("Sure! Here is the result:\n\n{VALID}\n\nHope that helps.");
        assert_eq!(parse_output(&chatty).unwrap().summary, "We talked.");
    }

    #[test]
    fn genuinely_unparseable_output_errors_with_a_sample() {
        let err = parse_output("I'm sorry, I can't do that.").unwrap_err();
        let message = err.to_string();
        assert!(message.contains("could not read JSON"));
        // The sample matters: a bare "malformed" tells nobody anything.
        assert!(message.contains("I'm sorry"));
    }

    #[test]
    fn the_error_sample_is_bounded() {
        // A runaway model must not paste a megabyte into an error message.
        let huge = "x".repeat(100_000);
        let message = parse_output(&huge).unwrap_err().to_string();
        assert!(message.len() < 400);
    }

    #[test]
    fn the_provider_names_its_model_for_provenance() {
        assert_eq!(
            OllamaProvider::new("gemma3:12b").name(),
            "ollama/gemma3:12b"
        );
    }

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_preferred_model_wins_over_install_order() {
        let installed = names(&["llama3:8b", "gemma3:12b", "qwen3:8b"]);
        assert_eq!(pick_model(&installed).as_deref(), Some("qwen3:8b"));
    }

    #[test]
    fn any_installed_model_beats_none() {
        let installed = names(&["mistral:7b"]);
        assert_eq!(pick_model(&installed).as_deref(), Some("mistral:7b"));
        assert_eq!(pick_model(&[]), None);
    }

    #[test]
    fn each_unready_state_says_what_to_do() {
        assert!(Readiness::NotRunning
            .guidance()
            .unwrap()
            .contains("Open Ollama"));
        assert!(Readiness::NoModel {
            suggested: SUGGESTED_MODEL
        }
        .guidance()
        .unwrap()
        .contains(SUGGESTED_MODEL));
        assert_eq!(
            Readiness::Ready {
                model: "qwen3:8b".into()
            }
            .guidance(),
            None
        );
    }

    #[test]
    fn readiness_crosses_ipc_as_a_tagged_state() {
        // The frontend switches on `state`; a rename here breaks it silently.
        let json = serde_json::to_value(Readiness::Ready {
            model: "qwen3:8b".into(),
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "state": "ready", "model": "qwen3:8b" })
        );
        assert_eq!(
            serde_json::to_value(Readiness::NotRunning).unwrap(),
            serde_json::json!({ "state": "not_running" })
        );
    }

    #[test]
    fn the_host_is_loopback_only() {
        // The privacy guarantee is structural, not configured.
        assert!(HOST.starts_with("http://127.0.0.1"));
    }
}
