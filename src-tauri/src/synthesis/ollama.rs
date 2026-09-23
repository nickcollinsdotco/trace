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

use std::sync::atomic::{AtomicU8, Ordering};

use super::schema::{FormatLevel, SynthesisOutput};
use super::{prompt, LlmProvider, SynthesisError};

/// Local-only. Not configurable, by design.
const HOST: &str = "http://127.0.0.1:11434";

/// Generous, because it is a local model on unknown hardware.
///
/// An hour-long transcript through a 12B on a modest GPU can take minutes, and
/// timing out on a meeting the user just recorded would be worse than waiting.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(600);
const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

/// The format level this Ollama has accepted, as a `FormatLevel` index.
///
/// Per run of the app rather than saved: an Ollama upgrade may accept the
/// full format again, and one refused request at the next start is a small
/// price for finding out.
static FORMAT_LEVEL: AtomicU8 = AtomicU8::new(FormatLevel::Strict as u8);

/// Context window requested for every call, in tokens.
///
/// Set explicitly because Ollama's default of 4,096 is smaller than one
/// prompt window plus its answer. Over the limit, Ollama drops the *start* of
/// the prompt without an error, so the model loses its instructions and part
/// of the transcript and carries on regardless.
///
/// 8k rather than more because the KV cache is reserved for the whole context
/// when the model loads — ~1.1 GB here for an 8B model, ~2.3 GB at 16k. The
/// window size in `prompt` is what keeps a prompt inside it. `warm` requests
/// the same size, because a different one makes Ollama reload the model.
pub const NUM_CTX: u32 = 8_192;

/// Most tokens one answer may use.
///
/// A dense stretch of meeting can yield a long list of items, and 2,048 was
/// tight enough to be reached. Reserved out of `NUM_CTX`.
const NUM_PREDICT: u32 = 3_072;

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

    /// Names of the models the local instance has pulled.
    pub fn list_models() -> Result<Vec<String>, SynthesisError> {
        Ok(Self::installed()?.into_iter().map(|m| m.name).collect())
    }

    /// Models the local instance has pulled, with their sizes.
    pub fn installed() -> Result<Vec<InstalledModel>, SynthesisError> {
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

        Ok(parse_installed(&body))
    }

    /// The running Ollama's version, for diagnostics.
    pub fn version() -> Option<String> {
        let body: serde_json::Value = ureq::get(&format!("{HOST}/api/version"))
            .config()
            .timeout_global(Some(PROBE_TIMEOUT))
            .build()
            .call()
            .ok()?
            .into_body()
            .read_json()
            .ok()?;
        body["version"].as_str().map(str::to_string)
    }

    /// Models currently in memory, and how much of each is on the GPU.
    ///
    /// The one place that shows whether a model actually fits in video memory.
    /// Partly on the CPU is the usual cause of slow notes, and nothing else on
    /// screen would reveal it.
    pub fn loaded() -> Vec<LoadedModel> {
        let Some(body) = ureq::get(&format!("{HOST}/api/ps"))
            .config()
            .timeout_global(Some(PROBE_TIMEOUT))
            .build()
            .call()
            .ok()
            .and_then(|r| r.into_body().read_json::<serde_json::Value>().ok())
        else {
            return Vec::new();
        };
        parse_loaded(&body)
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
///
/// Larger first: a machine that has pulled the 14B has chosen to run it, and
/// it writes noticeably better notes. About 10.6 GB with an 8k context, so it
/// sits entirely on a 16 GB card.
pub const PREFERRED: &[&str] = &["qwen3:14b", "qwen3:8b", "gemma3:12b"];

/// The model to suggest pulling when none is installed.
///
/// The 8B rather than the first preference: it is what fits on the hardware
/// TRACE knows nothing about, and a suggestion that will not run is worse
/// than a smaller one that will.
pub const SUGGESTED_MODEL: &str = "qwen3:8b";

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
        let chosen = crate::settings::load().summary_model;
        match OllamaProvider::list_models() {
            Err(_) => Readiness::NotRunning,
            Ok(installed) => match choose_model(chosen.as_deref(), &installed) {
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

/// A model Ollama has in memory.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct LoadedModel {
    pub name: String,
    pub size_bytes: u64,
    pub vram_bytes: u64,
    /// Absent on Ollama versions that do not report it.
    pub context_length: Option<u64>,
}

fn parse_loaded(body: &serde_json::Value) -> Vec<LoadedModel> {
    body["models"]
        .as_array()
        .map(|models| {
            models
                .iter()
                .filter_map(|m| {
                    Some(LoadedModel {
                        name: m["name"].as_str()?.to_string(),
                        size_bytes: m["size"].as_u64().unwrap_or(0),
                        vram_bytes: m["size_vram"].as_u64().unwrap_or(0),
                        context_length: m["context_length"].as_u64(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The user's choice when it is still installed, else `pick_model`.
///
/// A choice that has since been removed from Ollama falls back rather than
/// failing, for the same reason `pick_model` exists: notes from another model
/// beat no notes.
pub fn choose_model(chosen: Option<&str>, installed: &[String]) -> Option<String> {
    chosen
        .filter(|c| installed.iter().any(|m| m == c))
        .map(str::to_string)
        .or_else(|| pick_model(installed))
}

/// A model Ollama has on disk.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct InstalledModel {
    pub name: String,
    pub size_bytes: u64,
    /// "14.8B" and the like, when Ollama reports it.
    pub parameters: Option<String>,
}

fn parse_installed(body: &serde_json::Value) -> Vec<InstalledModel> {
    body["models"]
        .as_array()
        .map(|models| {
            models
                .iter()
                .filter_map(|m| {
                    Some(InstalledModel {
                        name: m["name"].as_str()?.to_string(),
                        size_bytes: m["size"].as_u64().unwrap_or(0),
                        parameters: m["details"]["parameter_size"].as_str().map(str::to_string),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// A model worth offering to download, with what it costs.
#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct Recommended {
    pub name: &'static str,
    pub summary: &'static str,
    pub approx_bytes: u64,
}

/// What the Models page offers to pull, best notes first.
///
/// Sizes are the download, roughly. On the GPU each also needs about 1–1.5 GB
/// of context at `NUM_CTX`, which is what the summaries say.
pub const RECOMMENDED: &[Recommended] = &[
    Recommended {
        name: "qwen3:14b",
        summary: "Best notes. Wants about 11 GB of video memory",
        approx_bytes: 9_300_000_000,
    },
    Recommended {
        name: "qwen3:8b",
        summary: "Good notes on most machines. About 6.5 GB of video memory",
        approx_bytes: 5_200_000_000,
    },
    Recommended {
        name: "gemma3:12b",
        summary: "An alternative voice for comparison. About 10 GB of video memory",
        approx_bytes: 8_100_000_000,
    },
];

/// Download a model through Ollama, reporting progress as a fraction.
///
/// Only names in `RECOMMENDED` are accepted: this is TRACE starting a
/// multi-gigabyte download on the user's behalf, and the list is what they
/// were shown. Anything else they can pull with Ollama directly.
///
/// Ollama reports progress per layer. The fraction is bytes across every
/// layer seen so far, so it can step back briefly when a new layer appears;
/// the weights dominate, so in practice it reads as one bar.
pub fn pull(name: &str, mut on_progress: impl FnMut(f64)) -> Result<(), SynthesisError> {
    use std::io::BufRead;

    if !RECOMMENDED.iter().any(|r| r.name == name) {
        return Err(SynthesisError::Request(format!(
            "{name} is not a model TRACE offers"
        )));
    }

    let response = ureq::post(&format!("{HOST}/api/pull"))
        .config()
        .http_status_as_error(false)
        .build()
        .send_json(serde_json::json!({ "model": name, "stream": true }))
        .map_err(|e| SynthesisError::Unavailable(e.to_string()))?;

    let status = response.status().as_u16();
    let reader = std::io::BufReader::new(response.into_body().into_reader());
    let mut layers: std::collections::HashMap<String, (u64, u64)> = Default::default();

    for line in reader.lines() {
        let line = line.map_err(|e| SynthesisError::Request(e.to_string()))?;
        let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        if let Some(error) = event["error"].as_str() {
            return Err(SynthesisError::Request(format!(
                "Ollama could not pull {name}: {error}"
            )));
        }
        if let (Some(digest), Some(total)) = (event["digest"].as_str(), event["total"].as_u64()) {
            let done = event["completed"].as_u64().unwrap_or(0);
            layers.insert(digest.to_string(), (done, total));
            let (done, total) = layers
                .values()
                .fold((0, 0), |(d, t), (ld, lt)| (d + ld, t + lt));
            if total > 0 {
                on_progress(done as f64 / total as f64);
            }
        }
        if event["status"].as_str() == Some("success") {
            on_progress(1.0);
            return Ok(());
        }
    }

    Err(SynthesisError::Request(if status == 200 {
        format!("the download of {name} stopped before it finished")
    } else {
        format!("Ollama refused to pull {name} (HTTP {status})")
    }))
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
        // One retry, for output that could not be read. Sampling is not
        // deterministic, so a second attempt at a window that ran away often
        // does not; anything else — Ollama down, a bad request — would fail
        // the same way twice.
        match self.attempt(user_prompt) {
            Err(SynthesisError::Malformed(_)) => self.attempt(user_prompt),
            other => other,
        }
    }
}

impl OllamaProvider {
    fn attempt(&self, user_prompt: &str) -> Result<SynthesisOutput, SynthesisError> {
        let mut level = FormatLevel::from_index(FORMAT_LEVEL.load(Ordering::Relaxed));
        loop {
            match self.request(user_prompt, &level.schema()) {
                Ok(output) => return Ok(output),
                Err(Failed(e)) => return Err(e),
                // A 400 is Ollama refusing the request before generating, and
                // the part of the request that varies by Ollama version is
                // what its grammar converter accepts. Step down and remember,
                // so the next window — and the next meeting — starts where
                // this one succeeded instead of paying the same refusal again.
                Err(Rejected(reason)) => {
                    let Some(next) = level.next() else {
                        return Err(SynthesisError::Request(format!(
                            "Ollama rejected the request: {reason}"
                        )));
                    };
                    let previous = FORMAT_LEVEL.fetch_max(next as u8, Ordering::Relaxed);
                    // Logged once per step, not per window: two meetings
                    // summarising together would otherwise both report it.
                    if previous < next as u8 {
                        crate::diagnostics::log(format!(
                            "Ollama rejected {} ({reason}); using {} until TRACE restarts",
                            level.describe(),
                            next.describe()
                        ));
                    }
                    level = next;
                }
            }
        }
    }

    fn request(
        &self,
        user_prompt: &str,
        format: &serde_json::Value,
    ) -> Result<SynthesisOutput, Attempt> {
        let request = serde_json::json!({
            "model": self.model,
            "system": prompt::SYSTEM_PROMPT,
            "prompt": user_prompt,
            "stream": false,
            // Applied as a decoding grammar, not a suggestion.
            "format": format,
            "options": {
                // Low but not zero. Deterministic decoding under a grammar can
                // get stuck repeating a structure; a little entropy avoids
                // that without inviting invention.
                "temperature": 0.2,
                "num_predict": NUM_PREDICT,
                "num_ctx": NUM_CTX
            },
            "keep_alive": keep_alive()
        });

        let response = ureq::post(&format!("{HOST}/api/generate"))
            .config()
            .timeout_global(Some(REQUEST_TIMEOUT))
            // Error statuses are read rather than raised, because Ollama puts
            // the reason in the body. Raised, a rejection arrived as a bare
            // "http status: 400", which says nothing about what to fix.
            .http_status_as_error(false)
            .build()
            .send_json(&request)
            .map_err(|e| {
                // The most likely failure by far is that Ollama is not
                // running, so say that rather than surfacing a socket error.
                Failed(if !Self::service_running() {
                    SynthesisError::Unavailable(
                        "Ollama is not running. Start it and try again.".into(),
                    )
                } else {
                    SynthesisError::Request(e.to_string())
                })
            })?;

        let status = response.status().as_u16();
        let text = response
            .into_body()
            .read_to_string()
            .map_err(|e| SynthesisError::Request(e.to_string()))?;

        if status != 200 {
            let reason = ollama_error(&text, status);
            return Err(if status == 400 {
                Rejected(reason)
            } else {
                Failed(SynthesisError::Request(reason))
            });
        }

        let body: serde_json::Value =
            serde_json::from_str(&text).map_err(|e| SynthesisError::Malformed(e.to_string()))?;

        // Ollama trims an oversized prompt rather than rejecting it, and says
        // so only in its own log. How many prompt tokens it read is the one
        // trace of that here: past the space left for the answer, either the
        // start of the prompt is gone or the answer will be cut off. Prompt
        // caching can make this count low, never high, so it cannot misfire.
        let read = body["prompt_eval_count"].as_u64().unwrap_or(0);
        if read > u64::from(NUM_CTX - NUM_PREDICT) {
            return Err(SynthesisError::Request(format!(
                "this part of the meeting was too long for the model to read and still answer \
                 ({read} of {NUM_CTX} tokens)"
            ))
            .into());
        }

        // Said plainly, because the parse error it would otherwise become
        // shows only the opening of the output — which looks fine — and not
        // the end, where it stopped.
        if body["done_reason"].as_str() == Some("length") {
            return Err(SynthesisError::Malformed(
                "the model ran out of room before finishing its answer, usually from repeating \
                 itself"
                    .into(),
            )
            .into());
        }

        let output = body["response"]
            .as_str()
            .ok_or_else(|| SynthesisError::Malformed("no `response` field".into()))?;

        Ok(parse_output(output)?)
    }
}

/// How one request ended, when it did not succeed.
///
/// A rejection is kept apart from every other failure because it is the one
/// worth retrying with a looser format; retrying anything else would fail the
/// same way.
enum Attempt {
    /// Ollama refused the request outright (400), with its reason.
    Rejected(String),
    Failed(SynthesisError),
}

use Attempt::{Failed, Rejected};

impl From<SynthesisError> for Attempt {
    fn from(e: SynthesisError) -> Self {
        Failed(e)
    }
}

/// Ollama's own explanation of an error status, from `{"error": "..."}`.
fn ollama_error(body: &str, status: u16) -> String {
    let reason = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v["error"].as_str().map(str::to_string))
        .unwrap_or_else(|| body.trim().chars().take(200).collect());
    if reason.is_empty() {
        format!("HTTP {status}")
    } else {
        format!("HTTP {status}: {reason}")
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

/// How long Ollama keeps the model loaded after each request.
///
/// A minute, when the user wants it gone after writing notes: long enough to
/// span the gap between windows of one meeting, so a long meeting is not
/// reloaded window by window. Otherwise Ollama's own default.
fn keep_alive() -> &'static str {
    match crate::settings::load().summary_memory {
        crate::settings::SummaryMemory::WhileWriting => "1m",
        crate::settings::SummaryMemory::DuringMeetings => "5m",
    }
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
                    "keep_alive": "2h",
                    // Must match synthesis, or the warm load is thrown away.
                    "options": { "num_ctx": NUM_CTX }
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
    fn a_chosen_model_wins_only_while_it_is_installed() {
        let installed = names(&["qwen3:8b", "qwen3:14b", "llama3:8b"]);
        assert_eq!(
            choose_model(Some("llama3:8b"), &installed).as_deref(),
            Some("llama3:8b")
        );
        // Removed from Ollama since it was chosen: the preference order.
        assert_eq!(
            choose_model(Some("gone:1b"), &installed).as_deref(),
            Some("qwen3:14b")
        );
        assert_eq!(choose_model(None, &installed).as_deref(), Some("qwen3:14b"));
    }

    #[test]
    fn installed_models_carry_their_size() {
        let body = serde_json::json!({ "models": [
            { "name": "qwen3:14b", "size": 9_300_000_000u64,
              "details": { "parameter_size": "14.8B" } },
            { "name": "bare" }
        ]});
        let m = parse_installed(&body);
        assert_eq!(m[0].size_bytes, 9_300_000_000);
        assert_eq!(m[0].parameters.as_deref(), Some("14.8B"));
        assert_eq!(m[1].size_bytes, 0);
        assert_eq!(m[1].parameters, None);
    }

    #[test]
    fn only_offered_models_can_be_pulled() {
        // Refused before any request is made, so this needs no Ollama.
        let err = pull("some/arbitrary-model", |_| {}).unwrap_err();
        assert!(err.to_string().contains("not a model TRACE offers"));
    }

    #[test]
    fn every_recommended_model_is_one_trace_prefers() {
        for r in RECOMMENDED {
            assert!(PREFERRED.contains(&r.name), "{}", r.name);
        }
    }

    #[test]
    fn the_14b_is_preferred_when_both_are_installed() {
        let installed = names(&["qwen3:8b", "qwen3:14b"]);
        assert_eq!(pick_model(&installed).as_deref(), Some("qwen3:14b"));
    }

    #[test]
    fn the_suggested_model_is_the_small_one() {
        // Suggested to people whose hardware is unknown.
        assert_eq!(SUGGESTED_MODEL, "qwen3:8b");
        assert!(PREFERRED.contains(&SUGGESTED_MODEL));
    }

    #[test]
    fn loaded_models_report_how_much_is_on_the_gpu() {
        let body = serde_json::json!({ "models": [
            { "name": "qwen3:14b", "size": 11_000_000_000u64, "size_vram": 11_000_000_000u64,
              "context_length": 8192 },
            { "name": "old", "size": 5 }
        ]});
        let loaded = parse_loaded(&body);
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].vram_bytes, 11_000_000_000);
        assert_eq!(loaded[0].context_length, Some(8192));
        assert_eq!(loaded[1].vram_bytes, 0);
        assert_eq!(loaded[1].context_length, None);
        assert!(parse_loaded(&serde_json::json!({})).is_empty());
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

    /// Rough characters per token for transcript lines, with their ids and
    /// timestamps. Deliberately pessimistic: overestimating tokens costs a little
    /// memory, underestimating silently truncates.
    const CHARS_PER_TOKEN: u32 = 3;

    #[test]
    fn a_full_window_fits_in_the_context_with_room_to_answer() {
        // Overflow is silent in Ollama: it trims the start of the prompt,
        // instructions first. So the sizing is checked here instead.
        let window_tokens = prompt::WINDOW_CHARS as u32 / CHARS_PER_TOKEN;
        let system_tokens = prompt::SYSTEM_PROMPT.len() as u32 / CHARS_PER_TOKEN;
        // Meeting headers and slack. The typed notes are inside
        // `WINDOW_CHARS` now, so they need no allowance of their own.
        let overhead = 800;
        assert!(
            window_tokens + system_tokens + overhead + NUM_PREDICT <= NUM_CTX,
            "window {window_tokens} + system {system_tokens} + {overhead} + answer {NUM_PREDICT} > {NUM_CTX}"
        );
    }

    #[test]
    fn ollama_says_why_it_refused() {
        assert_eq!(
            ollama_error(r#"{"error":"invalid JSON schema in format"}"#, 400),
            "HTTP 400: invalid JSON schema in format"
        );
        // Not JSON: the text itself, bounded.
        assert_eq!(ollama_error("Bad Request", 400), "HTTP 400: Bad Request");
        assert_eq!(ollama_error("", 500), "HTTP 500");
        assert!(ollama_error(&"x".repeat(10_000), 400).len() < 250);
    }

    #[test]
    fn the_host_is_loopback_only() {
        // The privacy guarantee is structural, not configured.
        assert!(HOST.starts_with("http://127.0.0.1"));
    }
}
