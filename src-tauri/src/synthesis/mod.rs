//! Turning a transcript into structured meeting notes.
//!
//! ```text
//!   Meeting ──> windows ──> LlmProvider ──> merge ──> validate ──> GeneratedMeeting
//!               (nothing     (per window)   (union)   (drops
//!                dropped)                              fabrications)
//! ```
//!
//! The provider is a trait taking a prepared prompt. Windowing, merging and
//! validation all sit above it, so a different backend changes nothing but the
//! HTTP call.

use crate::meeting::{GeneratedMeeting, Meeting};

pub mod citable;
pub mod ollama;
pub mod prompt;
pub mod schema;
pub mod validate;

pub use citable::CitableSet;
pub use validate::ValidationReport;

#[derive(Debug, thiserror::Error)]
pub enum SynthesisError {
    #[error("no language model is available: {0}")]
    Unavailable(String),
    #[error("the model request failed: {0}")]
    Request(String),
    #[error("the model returned output that could not be read: {0}")]
    Malformed(String),
    #[error("there is nothing to summarise")]
    EmptyTranscript,
}

/// A source of meeting synthesis.
pub trait LlmProvider: Send {
    /// Human-readable identity, recorded on the note as provenance.
    fn name(&self) -> String;

    /// Whether this provider can currently be used.
    fn available(&self) -> bool;

    /// Extract structure from one prepared prompt.
    fn synthesize(&self, user_prompt: &str) -> Result<schema::SynthesisOutput, SynthesisError>;

    /// Merge several part-summaries into one.
    ///
    /// Defaulted so a provider need not implement it; joining is correct if
    /// inelegant, and a failed consolidation must not lose the parts.
    fn consolidate(&self, summaries: &[String]) -> Result<String, SynthesisError> {
        Ok(summaries.join(" "))
    }
}

/// Progress through a long meeting, for the UI.
#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct SynthesisProgress {
    pub window: usize,
    pub total: usize,
}

/// Synthesise a meeting and discard anything the model made up.
pub fn generate(
    provider: &dyn LlmProvider,
    meeting: &Meeting,
    mut on_progress: impl FnMut(SynthesisProgress),
) -> Result<(GeneratedMeeting, ValidationReport), SynthesisError> {
    let has_speech = meeting.transcript.iter().any(|s| !s.text.trim().is_empty());
    let has_notes = !meeting.notes.trim().is_empty();
    if !has_speech && !has_notes {
        return Err(SynthesisError::EmptyTranscript);
    }

    let windows = prompt::windows(meeting);
    let total = windows.len();

    let mut merged = schema::SynthesisOutput::default();
    let mut summaries: Vec<String> = Vec::with_capacity(total);

    for window in &windows {
        on_progress(SynthesisProgress {
            window: window.index,
            total,
        });

        let output = provider.synthesize(&window.prompt)?;

        if !output.summary.trim().is_empty() {
            summaries.push(output.summary.clone());
        }
        merge_into(&mut merged, output);
    }

    // One window needs no consolidation; several do, and the input to that is
    // summaries rather than transcript, so it stays small however long the
    // meeting was.
    merged.summary = match summaries.len() {
        0 => String::new(),
        1 => summaries.remove(0),
        _ => provider
            .consolidate(&summaries)
            .unwrap_or_else(|_| summaries.join(" ")),
    };

    let citable = CitableSet::from_meeting(meeting);
    Ok(validate::validate(merged, &citable, &provider.name()))
}

/// Union one window's output into the running result.
///
/// Duplicates are removed by exact text match, case- and space-insensitively.
/// Deliberately conservative: merging near-duplicates would lose whichever
/// citation was discarded, and a repeated item is a smaller problem than a
/// missing one.
fn merge_into(into: &mut schema::SynthesisOutput, from: schema::SynthesisOutput) {
    extend_unique(&mut into.key_points, from.key_points, |c| c.text.clone());
    extend_unique(&mut into.decisions, from.decisions, |c| c.text.clone());
    extend_unique(&mut into.open_questions, from.open_questions, |c| {
        c.text.clone()
    });
    extend_unique(&mut into.action_items, from.action_items, |a| {
        a.text.clone()
    });
}

fn extend_unique<T>(into: &mut Vec<T>, from: Vec<T>, key: impl Fn(&T) -> String) {
    for item in from {
        let k = key(&item).trim().to_lowercase();
        if k.is_empty() {
            continue;
        }
        if into.iter().any(|e| key(e).trim().to_lowercase() == k) {
            continue;
        }
        into.push(item);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::StreamSource;
    use crate::transcribe::Segment;
    use std::sync::Mutex;

    /// Returns a queued output per call, recording the prompts it saw.
    struct StubProvider {
        outputs: Mutex<Vec<schema::SynthesisOutput>>,
        seen: Mutex<Vec<String>>,
    }

    impl StubProvider {
        fn new(outputs: Vec<schema::SynthesisOutput>) -> Self {
            Self {
                outputs: Mutex::new(outputs),
                seen: Mutex::new(Vec::new()),
            }
        }
        fn calls(&self) -> usize {
            self.seen.lock().unwrap().len()
        }
    }

    impl LlmProvider for StubProvider {
        fn name(&self) -> String {
            "stub".into()
        }
        fn available(&self) -> bool {
            true
        }
        fn synthesize(&self, prompt: &str) -> Result<schema::SynthesisOutput, SynthesisError> {
            self.seen.lock().unwrap().push(prompt.to_string());
            let mut queue = self.outputs.lock().unwrap();
            if queue.is_empty() {
                Ok(schema::SynthesisOutput::default())
            } else {
                Ok(queue.remove(0))
            }
        }
    }

    fn claim(text: &str, evidence: &[&str]) -> schema::RawClaim {
        schema::RawClaim {
            text: text.into(),
            evidence: evidence.iter().map(|s| s.to_string()).collect(),
            confidence: 0.9,
        }
    }

    fn meeting_with_lines(n: usize) -> Meeting {
        let mut m = Meeting::new("m", "Test");
        m.transcript = (0..n)
            .map(|i| Segment {
                id: format!("mic_{i:04}"),
                start_ms: i as u64 * 1000,
                end_ms: i as u64 * 1000 + 500,
                text: "a line of transcript with a realistic amount of content".into(),
                source: StreamSource::Microphone,
            })
            .collect();
        m
    }

    #[test]
    fn a_meeting_with_neither_speech_nor_notes_is_refused() {
        let p = StubProvider::new(vec![]);
        assert!(matches!(
            generate(&p, &Meeting::new("m", "T"), |_| {}),
            Err(SynthesisError::EmptyTranscript)
        ));
    }

    #[test]
    fn a_meeting_with_only_notes_is_still_synthesised() {
        // Someone may type notes with no usable audio; that is still a meeting
        // worth summarising.
        let mut m = Meeting::new("m", "T");
        m.notes = "we agreed to ship".into();

        let p = StubProvider::new(vec![schema::SynthesisOutput {
            summary: "They agreed to ship.".into(),
            decisions: vec![claim("ship it", &["note_0000"])],
            ..Default::default()
        }]);

        let (g, r) = generate(&p, &m, |_| {}).unwrap();
        assert_eq!(g.decisions.len(), 1, "a note should be citable");
        assert!(r.is_clean());
    }

    #[test]
    fn a_claim_citing_a_note_survives_validation() {
        // The gap this fixed: previously only transcript ids were citable, so
        // anything the user typed but never said was silently discarded.
        let mut m = meeting_with_lines(1);
        m.notes = "the vendor is a problem".into();

        let p = StubProvider::new(vec![schema::SynthesisOutput {
            summary: "s".into(),
            key_points: vec![claim("the vendor is a problem", &["note_0000"])],
            ..Default::default()
        }]);

        let (g, r) = generate(&p, &m, |_| {}).unwrap();
        assert_eq!(g.key_points.len(), 1);
        assert!(r.is_clean());
    }

    #[test]
    fn a_long_meeting_calls_the_model_once_per_window() {
        let m = meeting_with_lines(800);
        let p = StubProvider::new(vec![]);

        let mut progress = Vec::new();
        generate(&p, &m, |x| progress.push((x.window, x.total))).unwrap();

        assert!(p.calls() > 1, "a long meeting should window");
        assert_eq!(progress.len(), p.calls(), "progress reported per window");
        assert_eq!(progress[0], (1, p.calls()));
    }

    #[test]
    fn results_from_every_window_are_kept() {
        // The point of windowing: content from the middle of a meeting must
        // survive, not just the last part.
        let m = meeting_with_lines(800);
        let p = StubProvider::new(vec![
            schema::SynthesisOutput {
                summary: "First part.".into(),
                decisions: vec![claim("decision from window one", &["mic_0000"])],
                ..Default::default()
            },
            schema::SynthesisOutput {
                summary: "Second part.".into(),
                decisions: vec![claim("decision from window two", &["mic_0400"])],
                ..Default::default()
            },
        ]);

        let (g, _) = generate(&p, &m, |_| {}).unwrap();
        let texts: Vec<&str> = g.decisions.iter().map(|d| d.text.as_str()).collect();
        assert!(texts.contains(&"decision from window one"));
        assert!(texts.contains(&"decision from window two"));
    }

    #[test]
    fn duplicate_claims_across_windows_are_merged() {
        let m = meeting_with_lines(800);
        let repeated = || schema::SynthesisOutput {
            summary: "s".into(),
            decisions: vec![claim("Ship on Friday", &["mic_0000"])],
            ..Default::default()
        };
        let p = StubProvider::new(vec![repeated(), repeated(), repeated()]);

        let (g, _) = generate(&p, &m, |_| {}).unwrap();
        assert_eq!(g.decisions.len(), 1, "the same decision should appear once");
    }

    #[test]
    fn duplicate_detection_ignores_case_and_spacing() {
        let m = meeting_with_lines(800);
        let p = StubProvider::new(vec![
            schema::SynthesisOutput {
                summary: "s".into(),
                decisions: vec![claim("Ship on Friday", &["mic_0000"])],
                ..Default::default()
            },
            schema::SynthesisOutput {
                summary: "s".into(),
                decisions: vec![claim("  ship on friday  ", &["mic_0400"])],
                ..Default::default()
            },
        ]);

        let (g, _) = generate(&p, &m, |_| {}).unwrap();
        assert_eq!(g.decisions.len(), 1);
    }

    #[test]
    fn a_single_window_summary_is_used_verbatim() {
        let m = meeting_with_lines(2);
        let p = StubProvider::new(vec![schema::SynthesisOutput {
            summary: "Exactly this.".into(),
            ..Default::default()
        }]);

        let (g, _) = generate(&p, &m, |_| {}).unwrap();
        assert_eq!(g.summary, "Exactly this.");
    }

    #[test]
    fn fabrications_are_still_dropped_after_merging() {
        let m = meeting_with_lines(2);
        let p = StubProvider::new(vec![schema::SynthesisOutput {
            summary: "s".into(),
            decisions: vec![claim("invented", &["does_not_exist"])],
            ..Default::default()
        }]);

        let (g, r) = generate(&p, &m, |_| {}).unwrap();
        assert!(g.decisions.is_empty());
        assert_eq!(r.fabricated, 1);
    }

    #[test]
    fn provenance_records_the_provider() {
        let m = meeting_with_lines(2);
        let p = StubProvider::new(vec![]);
        let (g, _) = generate(&p, &m, |_| {}).unwrap();
        assert_eq!(g.model, "stub");
    }
}
