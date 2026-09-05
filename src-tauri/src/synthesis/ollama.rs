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

    #[test]
    fn the_host_is_loopback_only() {
        // The privacy guarantee is structural, not configured.
        assert!(HOST.starts_with("http://127.0.0.1"));
    }
}
