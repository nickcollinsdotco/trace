//! Turning a transcript into structured meeting notes.
//!
//! ```text
//!   Meeting ──> windows ──> LlmProvider ──> merge ──> condense ──> validate ──> GeneratedMeeting
//!               (nothing     (per window)   (union)   (long         (drops
//!                dropped)                              meetings)     fabrications)
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

    /// Extract structure from one prepared prompt. `label` names the window
    /// ("part 3 of 8") for the diagnostics log.
    fn synthesize(
        &self,
        user_prompt: &str,
        label: &str,
    ) -> Result<schema::SynthesisOutput, SynthesisError>;

    /// The final pass over a long meeting: one summary from the parts', and
    /// the key points that matter most, naming their sources by index.
    ///
    /// Defaulted to unsupported, which `generate` answers with a plain
    /// fallback — a failed pass must never cost the notes it was tidying.
    fn condense(
        &self,
        _summaries: &[String],
        _key_points: &[schema::RawClaim],
    ) -> Result<schema::CondenseOutput, SynthesisError> {
        Err(SynthesisError::Unavailable(
            "this provider has no final pass".into(),
        ))
    }
}

/// Progress through a long meeting, for the UI.
#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct SynthesisProgress {
    pub window: usize,
    pub total: usize,
    /// The windows are done and the final pass is combining them. Reported
    /// because it takes a window's worth of time with nothing else moving.
    pub combining: bool,
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
            combining: false,
        });

        let label = if total == 1 {
            "notes".to_string()
        } else {
            format!("part {} of {total}", window.index)
        };
        let output = provider.synthesize(&window.prompt, &label)?;

        if !output.summary.trim().is_empty() {
            summaries.push(output.summary.clone());
        }
        merge_into(&mut merged, output);
    }

    // One window needs no final pass. Several need their summaries made into
    // one, and their key points — stacked, one list per window — cut down to
    // the few that matter. Both happen in a single request.
    let combine_summaries = summaries.len() > 1;
    let cut_points = merged.key_points.len() > prompt::KEY_POINTS_MAX;

    if combine_summaries || cut_points {
        on_progress(SynthesisProgress {
            window: total,
            total,
            combining: true,
        });
        match provider.condense(&summaries, &merged.key_points) {
            Ok(condensed) => {
                if combine_summaries && !condensed.summary.trim().is_empty() {
                    merged.summary = condensed.summary;
                }
                if cut_points {
                    let points = resolve_condensed(&condensed.key_points, &merged.key_points);
                    merged.key_points = if points.is_empty() {
                        fallback_key_points(merged.key_points)
                    } else {
                        points
                    };
                }
            }
            Err(e) => {
                crate::diagnostics::log(format!(
                    "final pass failed ({e}); keeping the parts' summaries and the strongest \
                     key points"
                ));
                if cut_points {
                    merged.key_points = fallback_key_points(merged.key_points);
                }
            }
        }
    }

    if merged.summary.trim().is_empty() {
        merged.summary = summaries.join(" ");
    }

    let citable = CitableSet::from_meeting(meeting);
    Ok(validate::validate(merged, &citable, &provider.name()))
}

/// Turn the final pass's numbered choices back into cited key points.
///
/// Each point's evidence is the union of its sources' evidence, and its
/// confidence the highest of theirs, so nothing is cited that was not cited
/// before. Out-of-range numbers are ignored; a point with no valid source is
/// dropped rather than trusted.
fn resolve_condensed(
    chosen: &[schema::CondensedPoint],
    sources: &[schema::RawClaim],
) -> Vec<schema::RawClaim> {
    chosen
        .iter()
        .filter_map(|point| {
            let text = point.text.trim();
            let from: Vec<&schema::RawClaim> = point
                .from
                .iter()
                .filter_map(|&i| usize::try_from(i).ok().and_then(|i| sources.get(i)))
                .collect();
            if text.is_empty() || from.is_empty() {
                return None;
            }

            let mut evidence: Vec<String> = Vec::new();
            for id in from.iter().flat_map(|c| &c.evidence) {
                if !evidence.contains(id) {
                    evidence.push(id.clone());
                }
            }
            Some(schema::RawClaim {
                text: text.to_string(),
                evidence,
                confidence: from.iter().map(|c| c.confidence).fold(0.0, f32::max),
            })
        })
        .take(prompt::KEY_POINTS_MAX)
        .collect()
}

/// Without a final pass: the most confident points, in meeting order.
///
/// Order is kept because key points read as the course of the meeting; the
/// model's confidence only decides which survive.
fn fallback_key_points(points: Vec<schema::RawClaim>) -> Vec<schema::RawClaim> {
    if points.len() <= prompt::KEY_POINTS_MAX {
        return points;
    }
    let mut ranked: Vec<usize> = (0..points.len()).collect();
    // Stable, so equal confidence keeps the earlier point.
    ranked.sort_by(|&a, &b| points[b].confidence.total_cmp(&points[a].confidence));
    let mut keep = ranked[..prompt::KEY_POINTS_MAX].to_vec();
    keep.sort_unstable();
    keep.into_iter().map(|i| points[i].clone()).collect()
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
        /// The final pass's answer; `None` means the pass is unsupported.
        condensed: Option<schema::CondenseOutput>,
        condense_calls: Mutex<usize>,
    }

    impl StubProvider {
        fn new(outputs: Vec<schema::SynthesisOutput>) -> Self {
            Self {
                outputs: Mutex::new(outputs),
                seen: Mutex::new(Vec::new()),
                condensed: None,
                condense_calls: Mutex::new(0),
            }
        }
        fn condensing(mut self, answer: schema::CondenseOutput) -> Self {
            self.condensed = Some(answer);
            self
        }
        fn condense_calls(&self) -> usize {
            *self.condense_calls.lock().unwrap()
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
        fn synthesize(
            &self,
            prompt: &str,
            _label: &str,
        ) -> Result<schema::SynthesisOutput, SynthesisError> {
            self.seen.lock().unwrap().push(prompt.to_string());
            let mut queue = self.outputs.lock().unwrap();
            if queue.is_empty() {
                Ok(schema::SynthesisOutput::default())
            } else {
                Ok(queue.remove(0))
            }
        }
        fn condense(
            &self,
            _summaries: &[String],
            _key_points: &[schema::RawClaim],
        ) -> Result<schema::CondenseOutput, SynthesisError> {
            *self.condense_calls.lock().unwrap() += 1;
            self.condensed
                .clone()
                .ok_or_else(|| SynthesisError::Unavailable("stub".into()))
        }
    }

    /// Two windows' outputs carrying `n` distinct key points between them,
    /// each citing a real line, with confidence rising with the index.
    fn two_windows_of_points(n: usize) -> Vec<schema::SynthesisOutput> {
        let point = |i: usize| schema::RawClaim {
            text: format!("point {i}"),
            evidence: vec![format!("mic_{:04}", i % 800)],
            confidence: i as f32 / n as f32,
        };
        vec![
            schema::SynthesisOutput {
                summary: "First part.".into(),
                key_points: (0..n / 2).map(point).collect(),
                ..Default::default()
            },
            schema::SynthesisOutput {
                summary: "Second part.".into(),
                key_points: (n / 2..n).map(point).collect(),
                ..Default::default()
            },
        ]
    }

    fn chosen(text: &str, from: &[i64]) -> schema::CondensedPoint {
        schema::CondensedPoint {
            text: text.into(),
            from: from.to_vec(),
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
    fn a_long_meeting_ends_with_the_few_key_points_that_matter() {
        let m = meeting_with_lines(800);
        let p = StubProvider::new(two_windows_of_points(49)).condensing(schema::CondenseOutput {
            summary: "The whole meeting, in one.".into(),
            key_points: vec![
                chosen("points one and two, merged", &[1, 2]),
                chosen("point 40", &[40]),
            ],
        });

        let (g, _) = generate(&p, &m, |_| {}).unwrap();

        assert_eq!(p.condense_calls(), 1);
        assert_eq!(g.summary, "The whole meeting, in one.");
        assert_eq!(g.key_points.len(), 2);
        // Evidence is rebuilt from the sources, never taken from the model.
        assert_eq!(
            g.key_points[0].evidence.segment_ids,
            vec!["mic_0001", "mic_0002"]
        );
        assert_eq!(g.key_points[1].evidence.segment_ids, vec!["mic_0040"]);
        // The strongest source's confidence.
        assert!((g.key_points[0].confidence - 2.0 / 49.0).abs() < 1e-6);
    }

    #[test]
    fn the_final_pass_cannot_keep_more_than_the_cap() {
        let m = meeting_with_lines(800);
        let many = (0..30)
            .map(|i| chosen(&format!("kept {i}"), &[i]))
            .collect();
        let p = StubProvider::new(two_windows_of_points(30)).condensing(schema::CondenseOutput {
            summary: "s".into(),
            key_points: many,
        });

        let (g, _) = generate(&p, &m, |_| {}).unwrap();
        assert_eq!(g.key_points.len(), prompt::KEY_POINTS_MAX);
    }

    #[test]
    fn a_point_with_no_real_source_is_dropped_not_trusted() {
        let m = meeting_with_lines(800);
        let p = StubProvider::new(two_windows_of_points(20)).condensing(schema::CondenseOutput {
            summary: "s".into(),
            key_points: vec![
                chosen("real", &[3]),
                chosen("out of range", &[99]),
                chosen("negative", &[-1]),
                chosen("   ", &[4]),
            ],
        });

        let (g, _) = generate(&p, &m, |_| {}).unwrap();
        let texts: Vec<&str> = g.key_points.iter().map(|c| c.text.as_str()).collect();
        assert_eq!(texts, vec!["real"]);
    }

    #[test]
    fn without_a_final_pass_the_strongest_points_survive_in_meeting_order() {
        let m = meeting_with_lines(800);
        // No `condensing`: the pass is unsupported, as a failure would be.
        let p = StubProvider::new(two_windows_of_points(49));

        let (g, _) = generate(&p, &m, |_| {}).unwrap();

        assert_eq!(g.key_points.len(), prompt::KEY_POINTS_MAX);
        let texts: Vec<&str> = g.key_points.iter().map(|c| c.text.as_str()).collect();
        // Confidence rises with the index, so the last ten, still in order.
        let expected: Vec<String> = (39..49).map(|i| format!("point {i}")).collect();
        assert_eq!(
            texts,
            expected.iter().map(String::as_str).collect::<Vec<_>>()
        );
        // The parts' summaries are kept rather than lost.
        assert_eq!(g.summary, "First part. Second part.");
    }

    #[test]
    fn a_pass_that_chooses_nothing_usable_falls_back() {
        let m = meeting_with_lines(800);
        let p = StubProvider::new(two_windows_of_points(20)).condensing(schema::CondenseOutput {
            summary: String::new(),
            key_points: vec![chosen("nothing real", &[500])],
        });

        let (g, _) = generate(&p, &m, |_| {}).unwrap();
        assert_eq!(g.key_points.len(), prompt::KEY_POINTS_MAX);
        assert_eq!(
            g.summary, "First part. Second part.",
            "an empty summary is not used"
        );
    }

    #[test]
    fn a_short_meeting_needs_no_final_pass() {
        let m = meeting_with_lines(2);
        let p = StubProvider::new(vec![schema::SynthesisOutput {
            summary: "One part.".into(),
            key_points: (0..8)
                .map(|i| claim(&format!("p{i}"), &["mic_0000"]))
                .collect(),
            ..Default::default()
        }]);

        let mut combining = false;
        let (g, _) = generate(&p, &m, |x| combining |= x.combining).unwrap();
        assert_eq!(p.condense_calls(), 0);
        assert!(!combining);
        assert_eq!(g.key_points.len(), 8);
    }

    #[test]
    fn the_final_pass_is_reported_as_combining() {
        let m = meeting_with_lines(800);
        let p = StubProvider::new(two_windows_of_points(20));

        let mut progress = Vec::new();
        generate(&p, &m, |x| progress.push(x.combining)).unwrap();
        assert_eq!(progress.last(), Some(&true));
        assert_eq!(progress.iter().filter(|c| **c).count(), 1);
    }

    #[test]
    fn provenance_records_the_provider() {
        let m = meeting_with_lines(2);
        let p = StubProvider::new(vec![]);
        let (g, _) = generate(&p, &m, |_| {}).unwrap();
        assert_eq!(g.model, "stub");
    }
}
