//! Synthetic-only synthesis evaluation. See docs/research/decision-evaluation.md.
//! Labels never enter a model prompt; semantic judgements remain manual.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};
use trace_lib::audio::StreamSource;
use trace_lib::meeting::Meeting;
use trace_lib::synthesis::ollama::OllamaProvider;
use trace_lib::synthesis::{self, prompt, schema, CitableSet, LlmProvider, SynthesisError};
use trace_lib::transcribe::Segment;

const CORPUS: &str = include_str!("../../docs/research/decision-evaluation/corpus.json");
const CALL_LIMIT: Duration = Duration::from_secs(180);

#[derive(Deserialize)]
struct Corpus {
    synthetic: bool,
    version: usize,
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    id: String,
    split: String,
    repeat: bool,
    title: String,
    notes: String,
    context: Option<String>,
    lines: Vec<(String, StreamSource, String)>,
    pad_after: Option<usize>,
    expected: Value,
}

impl Case {
    fn meeting(&self) -> Meeting {
        let mut meeting = Meeting::new(&self.id, &self.title);
        meeting.date = "2026-11-01".into();
        meeting.notes = self.notes.clone();
        meeting.context = self.context.clone();
        for (i, (id, source, text)) in self.lines.iter().enumerate() {
            if self.pad_after == Some(i) {
                // Fill the first window to 9,950 bytes using neutral, explicitly
                // synthetic inventory. The next substantive turn crosses the
                // unchanged 10,000-byte production boundary. Expanded text is
                // saved with every run so the artificial stressor is inspectable.
                let used: usize = meeting
                    .transcript
                    .iter()
                    .map(|s| {
                        format!("[{}] (00:00) {}: {}\n", s.id, s.speaker_label(), s.text).len()
                    })
                    .sum();
                let overhead = "[sys_9000] (00:00) them: \n".len();
                let target = 9_950 - used - overhead;
                let mut filler =
                    String::from("Synthetic inventory readout, unrelated to the choice. ");
                for n in 0.. {
                    let sentence = format!("Shelf {n} contained a labelled cardboard box. ");
                    if filler.len() + sentence.len() + 5 > target {
                        break;
                    }
                    filler.push_str(&sentence);
                }
                while filler.len() + 5 <= target {
                    filler.push_str("item ");
                }
                filler.push_str(&"x".repeat(target - filler.len()));
                push_segment(&mut meeting, "sys_9000", StreamSource::System, &filler);
            }
            push_segment(&mut meeting, id, *source, text);
        }
        meeting
    }
}

fn push_segment(meeting: &mut Meeting, id: &str, source: StreamSource, text: &str) {
    let start_ms = meeting.transcript.len() as u64 * 1_000;
    meeting.transcript.push(Segment {
        id: id.into(),
        source,
        text: text.into(),
        start_ms,
        end_ms: start_ms + 900,
    });
}

fn check_corpus(corpus: &Corpus) -> Result<(), String> {
    if !corpus.synthetic || corpus.version != 1 {
        return Err("only labelled synthetic corpus version 1 is accepted".into());
    }
    let mut cases = HashSet::new();
    for case in &corpus.cases {
        if !cases.insert(&case.id) || !matches!(case.split.as_str(), "development" | "held_out") {
            return Err(format!("duplicate case or invalid split: {}", case.id));
        }
        let meeting = case.meeting();
        let mut ids = HashSet::new();
        for s in &meeting.transcript {
            let prefix = match s.source {
                StreamSource::Microphone => "mic_",
                StreamSource::System => "sys_",
            };
            if !ids.insert(&s.id) || !s.id.starts_with(prefix) {
                return Err(format!("duplicate id or wrong stream: {}", s.id));
            }
        }
        let known = CitableSet::from_meeting(&meeting);
        let expected = case.expected["decisions"]
            .as_array()
            .ok_or("missing decisions label")?;
        for label in expected
            .iter()
            .chain(case.expected.get("allowed_optional_decision"))
        {
            if label["meaning"].as_str().is_none_or(str::is_empty) {
                return Err("missing semantic label".into());
            }
            let alternatives = label["evidence"]
                .as_array()
                .ok_or("missing evidence alternatives")?;
            if alternatives.is_empty() {
                return Err("empty evidence alternatives".into());
            }
            for alternative in alternatives {
                let ids = alternative.as_array().ok_or("evidence must be an array")?;
                if ids.is_empty()
                    || ids
                        .iter()
                        .any(|id| !id.as_str().is_some_and(|s| known.contains(s)))
                {
                    return Err("expected evidence does not resolve".into());
                }
            }
        }
        let windows = prompt::windows(&meeting);
        if windows.len() != if case.pad_after.is_some() { 2 } else { 1 } {
            return Err(format!("unexpected window layout: {}", case.id));
        }
        for s in &meeting.transcript {
            let marker = format!("[{}]", s.id);
            if windows
                .iter()
                .filter(|w| w.prompt.contains(&marker))
                .count()
                != 1
            {
                return Err(format!("lost or repeated segment: {}", s.id));
            }
        }
    }
    Ok(())
}

/// Counts and id resolution are an audit aid, never a semantic score.
fn audit(output: &schema::SynthesisOutput, meeting: &Meeting, input: &str) -> Value {
    let known = CitableSet::from_meeting(meeting);
    let decisions: Vec<_> = output.decisions.iter().map(|c| json!({
        "text": c.text,
        "evidence": c.evidence,
        "all_ids_resolve": !c.evidence.is_empty() && c.evidence.iter().all(|id| known.contains(id)),
        "all_ids_in_this_prompt": !c.evidence.is_empty() && c.evidence.iter().all(|id| input.contains(&format!("[{id}]"))),
        "semantic_support": "NOT AUTOMATICALLY ASSESSED"
    })).collect();
    json!({"raw_decision_count": decisions.len(), "decisions": decisions})
}

fn safety(model: &str) -> Result<String, SynthesisError> {
    let system = sysinfo::System::new_with_specifics(
        sysinfo::RefreshKind::nothing().with_processes(sysinfo::ProcessRefreshKind::nothing()),
    );
    if system
        .processes()
        .values()
        .any(|p| p.name().to_string_lossy().eq_ignore_ascii_case("trace.exe"))
    {
        return Err(SynthesisError::Stopped(
            "TRACE is running; refusing evaluation without guessing its busy state".into(),
        ));
    }
    let check = trace_lib::memory::check(model);
    if !check.fits() {
        return Err(SynthesisError::Stopped(
            check.describe("evaluation refused"),
        ));
    }
    Ok(check.describe("before evaluation request"))
}

struct RecordingProvider<'a> {
    model: &'a str,
    meeting: &'a Meeting,
    cancel: PathBuf,
    calls: Mutex<Vec<Value>>,
}

impl RecordingProvider<'_> {
    fn provider(&self) -> OllamaProvider {
        let started = Instant::now();
        let cancel = self.cancel.clone();
        OllamaProvider::new(self.model)
            .thinking(true)
            .stop_when(std::sync::Arc::new(move || {
                started.elapsed() >= CALL_LIMIT || cancel.exists()
            }))
    }
}

impl LlmProvider for RecordingProvider<'_> {
    fn name(&self) -> String {
        format!("ollama/{}", self.model)
    }
    fn available(&self) -> bool {
        OllamaProvider::new(self.model).available()
    }
    fn synthesize(
        &self,
        input: &str,
        label: &str,
    ) -> Result<schema::SynthesisOutput, SynthesisError> {
        let check = safety(self.model)?;
        let start = Instant::now();
        let result = self.provider().synthesize(input, label);
        self.calls.lock().unwrap().push(json!({
            "kind": "extract", "label": label, "prompt": input, "safety": check,
            "elapsed_seconds": start.elapsed().as_secs_f64(),
            "raw_parsed_output": result.as_ref().ok(),
            "mechanical": result.as_ref().ok().map(|o| audit(o, self.meeting, input)),
            "error": result.as_ref().err().map(ToString::to_string)
        }));
        result
    }
    fn condense(
        &self,
        summaries: &[String],
        points: &[schema::RawClaim],
    ) -> Result<schema::CondenseOutput, SynthesisError> {
        let check = safety(self.model)?;
        let start = Instant::now();
        let result = self.provider().condense(summaries, points);
        self.calls.lock().unwrap().push(json!({
            "kind": "combine", "summaries": summaries, "key_points": points, "safety": check,
            "elapsed_seconds": start.elapsed().as_secs_f64(),
            "raw_parsed_output": result.as_ref().ok(),
            "error": result.as_ref().err().map(ToString::to_string)
        }));
        result
    }
}

fn local_get(path: &str) -> Result<Value, Box<dyn std::error::Error>> {
    Ok(ureq::get(&format!("http://127.0.0.1:11434/api/{path}"))
        .config()
        .timeout_global(Some(Duration::from_secs(3)))
        .build()
        .call()?
        .into_body()
        .read_json()?)
}

fn save(path: &Path, value: &Value) -> Result<(), Box<dyn std::error::Error>> {
    std::fs::write(path, serde_json::to_string_pretty(value)?)?;
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    trace_lib::diagnostics::terminal_only();
    let corpus: Corpus = serde_json::from_str(CORPUS)?;
    check_corpus(&corpus)?;
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args == ["--check"] {
        println!(
            "{} synthetic cases checked; no model requests",
            corpus.cases.len()
        );
        return Ok(());
    }
    if args.len() != 2 {
        return Err(
            "usage: decision_eval --check | <installed-model> <new-output-directory>".into(),
        );
    }
    let model = &args[0];
    let out = PathBuf::from(&args[1]);
    // Refuse replacement: a re-run is separate evidence, never a rewrite.
    std::fs::create_dir(&out)?;
    let tags = local_get("tags")?;
    let selected = tags["models"]
        .as_array()
        .and_then(|ms| ms.iter().find(|m| m["name"] == *model))
        .ok_or("model is not installed; evaluation never pulls")?;
    let initial_ps = local_get("ps")?;
    if initial_ps["models"]
        .as_array()
        .is_none_or(|ms| !ms.is_empty())
    {
        return Err("an existing model is loaded; refuse to compete with another workload".into());
    }
    let check = safety(model)?;
    let head = std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .output()?;
    save(
        &out.join("manifest.json"),
        &json!({
            "synthetic": true, "started_at": chrono::Utc::now().to_rfc3339(),
            "source_head": String::from_utf8_lossy(&head.stdout).trim(),
            "model": selected, "ollama": local_get("version")?, "initial_ps": initial_ps,
            "safety": check, "corpus": serde_json::from_str::<Value>(CORPUS)?,
            "settings": {"think": true, "temperature": 0.2, "num_ctx": 8192, "num_predict": 3072,
                "seed": null, "deadline_seconds_per_provider_call_including_retries": CALL_LIMIT.as_secs(),
                "keep_alive": "production settings-derived policy, not overridden"},
            "system_prompt": prompt::SYSTEM_PROMPT, "strict_schema": schema::json_schema(),
            "combine_system_prompt": prompt::CONDENSE_SYSTEM_PROMPT,
            "combine_schema": schema::condense_schema(),
            "capture_limit": "Parsed provider outputs before validation; not wire responses or hidden thinking. Production retries and grammar fallback are visible in terminal diagnostics."
        }),
    )?;
    for repeat in 1..=2 {
        for case in corpus.cases.iter().filter(|c| repeat == 1 || c.repeat) {
            let meeting = case.meeting();
            let recorder = RecordingProvider {
                model,
                meeting: &meeting,
                cancel: out.join("CANCEL"),
                calls: Mutex::new(Vec::new()),
            };
            let start = Instant::now();
            println!("CASE {} repeat {repeat}", case.id);
            let result = synthesis::generate(&recorder, &meeting, |_| {
                if recorder.cancel.exists() {
                    return Err(SynthesisError::Stopped(
                        "evaluation CANCEL file exists".into(),
                    ));
                }
                safety(model).map(|_| ())
            });
            save(
                &out.join(format!("{}-{repeat}.json", case.id)),
                &json!({
                    "case": case.id, "split": case.split, "repeat": repeat,
                    "meeting": meeting, "expected": case.expected,
                    "elapsed_seconds": start.elapsed().as_secs_f64(),
                    "calls": recorder.calls.into_inner().unwrap(),
                    "validated": result.as_ref().ok().map(|(g, _)| g),
                    "validation_report": result.as_ref().ok().map(|(_, r)| r),
                    "error": result.as_ref().err().map(ToString::to_string)
                }),
            )?;
            if matches!(result, Err(SynthesisError::Stopped(_))) {
                return Err("evaluation stopped; partial results preserved".into());
            }
        }
    }
    save(&out.join("final-ps.json"), &local_get("ps")?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corpus_preserves_splits_sources_and_real_window_boundaries() {
        let corpus: Corpus = serde_json::from_str(CORPUS).unwrap();
        check_corpus(&corpus).unwrap();
        assert_eq!(
            corpus
                .cases
                .iter()
                .filter(|c| c.split == "held_out")
                .count(),
            6
        );
        let case = corpus
            .cases
            .iter()
            .find(|c| c.id == "dev_cross_reversal")
            .unwrap();
        let windows = prompt::windows(&case.meeting());
        assert!(windows[0].prompt.contains("[mic_0000]"));
        assert!(!windows[0].prompt.contains("[sys_0001]"));
        assert!(windows[1].prompt.contains("[sys_0001]"));
        assert!(!windows[1].prompt.contains("[mic_0000]"));
        assert!(!windows.iter().any(|w| w.prompt.contains("forbidden")));
    }

    #[test]
    fn corpus_rejects_broken_evidence_and_stream_identity() {
        let mut corpus: Corpus = serde_json::from_str(CORPUS).unwrap();
        corpus.cases[0].expected["decisions"][0]["evidence"] = json!([["sys_9999"]]);
        assert!(check_corpus(&corpus)
            .unwrap_err()
            .contains("does not resolve"));
        let mut corpus: Corpus = serde_json::from_str(CORPUS).unwrap();
        corpus.cases[0].lines[0].1 = StreamSource::System;
        assert!(check_corpus(&corpus).unwrap_err().contains("wrong stream"));
    }

    #[test]
    fn audit_separates_global_resolution_from_window_visibility_and_meaning() {
        let corpus: Corpus = serde_json::from_str(CORPUS).unwrap();
        let m = corpus.cases[0].meeting();
        let output = schema::SynthesisOutput {
            decisions: vec![schema::RawClaim {
                text: "An unsupported Tuesday release".into(),
                evidence: vec!["sys_0001".into()],
                confidence: 1.0,
            }],
            ..Default::default()
        };
        let check = audit(&output, &m, "[mic_0000] proposal");
        assert_eq!(check["decisions"][0]["all_ids_resolve"], true);
        assert_eq!(check["decisions"][0]["all_ids_in_this_prompt"], false);
        assert_eq!(
            check["decisions"][0]["semantic_support"],
            "NOT AUTOMATICALLY ASSESSED"
        );
        let mut broken = output;
        broken.decisions[0].evidence.push("sys_9999".into());
        assert_eq!(
            audit(&broken, &m, "")["decisions"][0]["all_ids_resolve"],
            false
        );
    }
}
