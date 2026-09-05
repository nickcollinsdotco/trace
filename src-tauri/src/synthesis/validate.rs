//! Turning raw model output into a meeting, and discarding what it made up.
//!
//! The schema forces every claim to carry citations. This checks that those
//! citations point at segments that actually exist, and drops the ones that
//! do not.
//!
//! That is the whole anti-fabrication mechanism, and it is deliberately
//! unforgiving: a claim citing one real segment and one invented one is
//! discarded, because partial grounding is not grounding. A model that
//! hallucinates a decision has to hallucinate a segment id to carry it, and
//! ids are checked against the transcript rather than trusted.

use crate::meeting::{ActionItem, Claim, Evidence, GeneratedMeeting};

use super::citable::CitableSet;
use super::schema::SynthesisOutput;

/// What validation removed, so the UI can be honest about it.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct ValidationReport {
    /// Items dropped for citing segments that do not exist.
    pub fabricated: usize,
    /// Items dropped for citing nothing at all.
    pub uncited: usize,
    /// Items dropped for having no text.
    pub empty: usize,
}

impl ValidationReport {
    pub fn total_dropped(&self) -> usize {
        self.fabricated + self.uncited + self.empty
    }

    pub fn is_clean(&self) -> bool {
        self.total_dropped() == 0
    }
}

/// Convert model output into a meeting's generated section.
///
/// `segments` is the transcript the model was given; anything citing outside
/// it is discarded.
pub fn validate(
    output: SynthesisOutput,
    citable: &CitableSet,
    model: &str,
) -> (GeneratedMeeting, ValidationReport) {
    let known = citable;
    let mut report = ValidationReport::default();

    let key_points = keep_claims(output.key_points, known, &mut report);
    let decisions = keep_claims(output.decisions, known, &mut report);
    let open_questions = keep_claims(output.open_questions, known, &mut report);

    let action_items = output
        .action_items
        .into_iter()
        .enumerate()
        .filter_map(|(i, raw)| {
            let text = raw.text.trim().to_string();
            if text.is_empty() {
                report.empty += 1;
                return None;
            }
            let evidence = check(&raw.evidence, known, &mut report)?;
            Some(ActionItem {
                id: format!("act_{i:03}"),
                text,
                owner: raw.owner.filter(|o| !o.trim().is_empty()),
                due_date: None,
                evidence,
                confidence: raw.confidence.clamp(0.0, 1.0),
                completed: false,
            })
        })
        .collect();

    let generated = GeneratedMeeting {
        summary: output.summary.trim().to_string(),
        key_points,
        decisions,
        action_items,
        open_questions,
        model: model.to_string(),
        generated_at: chrono::Local::now().to_rfc3339(),
    };

    (generated, report)
}

fn keep_claims(
    raw: Vec<super::schema::RawClaim>,
    known: &CitableSet,
    report: &mut ValidationReport,
) -> Vec<Claim> {
    raw.into_iter()
        .filter_map(|c| {
            let text = c.text.trim().to_string();
            if text.is_empty() {
                report.empty += 1;
                return None;
            }
            let evidence = check(&c.evidence, known, report)?;
            Some(Claim {
                text,
                evidence,
                confidence: c.confidence.clamp(0.0, 1.0),
            })
        })
        .collect()
}

/// Accept citations only if they all resolve.
fn check(ids: &[String], known: &CitableSet, report: &mut ValidationReport) -> Option<Evidence> {
    if ids.is_empty() {
        report.uncited += 1;
        return None;
    }

    // All, not any. A claim resting partly on an invented citation is not
    // half-true — the fabricated part is doing unknown work in the sentence.
    if !ids.iter().all(|id| known.contains(id.as_str())) {
        report.fabricated += 1;
        return None;
    }

    Some(Evidence {
        segment_ids: ids.to_vec(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::StreamSource;
    use crate::synthesis::schema::{RawAction, RawClaim};
    use crate::transcribe::Segment;

    fn segments(ids: &[&str]) -> Vec<Segment> {
        ids.iter()
            .map(|id| Segment {
                id: (*id).into(),
                start_ms: 0,
                end_ms: 100,
                text: "spoken words".into(),
                source: StreamSource::Microphone,
            })
            .collect()
    }

    fn claim(text: &str, evidence: &[&str]) -> RawClaim {
        RawClaim {
            text: text.into(),
            evidence: evidence.iter().map(|s| s.to_string()).collect(),
            confidence: 0.8,
        }
    }

    fn output(decisions: Vec<RawClaim>) -> SynthesisOutput {
        SynthesisOutput {
            summary: "A summary.".into(),
            decisions,
            ..Default::default()
        }
    }

    #[test]
    fn a_grounded_claim_survives() {
        let (g, r) = validate(
            output(vec![claim("Ship on Friday", &["mic_0001"])]),
            &CitableSet::from_segments(&segments(&["mic_0001"])),
            "test",
        );
        assert_eq!(g.decisions.len(), 1);
        assert!(r.is_clean());
    }

    #[test]
    fn a_fabricated_citation_is_discarded() {
        // The case the whole mechanism exists for: a plausible-sounding
        // decision that nobody actually made.
        let (g, r) = validate(
            output(vec![claim(
                "We agreed to acquire a competitor",
                &["mic_9999"],
            )]),
            &CitableSet::from_segments(&segments(&["mic_0001"])),
            "test",
        );
        assert!(g.decisions.is_empty());
        assert_eq!(r.fabricated, 1);
        assert_eq!(r.total_dropped(), 1);
    }

    #[test]
    fn partial_grounding_is_not_grounding() {
        // One real citation does not license a claim that also rests on an
        // invented one.
        let (g, r) = validate(
            output(vec![claim("Half true", &["mic_0001", "mic_9999"])]),
            &CitableSet::from_segments(&segments(&["mic_0001"])),
            "test",
        );
        assert!(g.decisions.is_empty());
        assert_eq!(r.fabricated, 1);
    }

    #[test]
    fn an_uncited_claim_is_discarded_and_counted_separately() {
        // Distinct from fabrication: the model declined to cite rather than
        // inventing a citation, and the two say different things about it.
        let (g, r) = validate(
            output(vec![claim("Sounds plausible", &[])]),
            &CitableSet::from_segments(&segments(&["mic_0001"])),
            "test",
        );
        assert!(g.decisions.is_empty());
        assert_eq!(r.uncited, 1);
        assert_eq!(r.fabricated, 0);
    }

    #[test]
    fn empty_text_is_dropped() {
        let (g, r) = validate(
            output(vec![claim("   ", &["mic_0001"])]),
            &CitableSet::from_segments(&segments(&["mic_0001"])),
            "test",
        );
        assert!(g.decisions.is_empty());
        assert_eq!(r.empty, 1);
    }

    #[test]
    fn good_and_bad_claims_are_separated_not_all_or_nothing() {
        // One bad claim must not discard a good one alongside it.
        let (g, r) = validate(
            output(vec![
                claim("Real decision", &["mic_0001"]),
                claim("Invented decision", &["nope"]),
            ]),
            &CitableSet::from_segments(&segments(&["mic_0001"])),
            "test",
        );
        assert_eq!(g.decisions.len(), 1);
        assert_eq!(g.decisions[0].text, "Real decision");
        assert_eq!(r.fabricated, 1);
    }

    #[test]
    fn action_items_are_validated_the_same_way() {
        let out = SynthesisOutput {
            summary: String::new(),
            action_items: vec![
                RawAction {
                    text: "send the deck".into(),
                    owner: Some("Sarah".into()),
                    evidence: vec!["mic_0001".into()],
                    confidence: 0.7,
                },
                RawAction {
                    text: "invented task".into(),
                    owner: None,
                    evidence: vec!["ghost".into()],
                    confidence: 0.9,
                },
            ],
            ..Default::default()
        };

        let (g, r) = validate(
            out,
            &CitableSet::from_segments(&segments(&["mic_0001"])),
            "test",
        );
        assert_eq!(g.action_items.len(), 1);
        assert_eq!(g.action_items[0].owner.as_deref(), Some("Sarah"));
        assert!(!g.action_items[0].completed);
        assert_eq!(r.fabricated, 1);
    }

    #[test]
    fn a_blank_owner_becomes_none() {
        let out = SynthesisOutput {
            action_items: vec![RawAction {
                text: "do it".into(),
                owner: Some("  ".into()),
                evidence: vec!["mic_0001".into()],
                confidence: 0.5,
            }],
            ..Default::default()
        };
        let (g, _) = validate(
            out,
            &CitableSet::from_segments(&segments(&["mic_0001"])),
            "test",
        );
        assert_eq!(g.action_items[0].owner, None);
    }

    #[test]
    fn confidence_is_clamped() {
        // Models do emit values outside the range regardless of the schema.
        let mut c = claim("x", &["mic_0001"]);
        c.confidence = 4.2;
        let (g, _) = validate(
            output(vec![c]),
            &CitableSet::from_segments(&segments(&["mic_0001"])),
            "test",
        );
        assert_eq!(g.decisions[0].confidence, 1.0);
    }

    #[test]
    fn an_empty_transcript_discards_everything() {
        // Nothing was said, so nothing can be grounded. Anything the model
        // produced here is invention by definition.
        let (g, r) = validate(
            output(vec![claim("Something happened", &["mic_0001"])]),
            &CitableSet::default(),
            "test",
        );
        assert!(g.decisions.is_empty());
        assert_eq!(r.fabricated, 1);
    }

    #[test]
    fn provenance_is_recorded() {
        let (g, _) = validate(
            output(vec![]),
            &CitableSet::from_segments(&segments(&["mic_0001"])),
            "gemma3:12b",
        );
        assert_eq!(g.model, "gemma3:12b");
        assert!(!g.generated_at.is_empty());
    }
}
