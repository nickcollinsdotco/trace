//! The meeting domain model.
//!
//! Mirrors `src/lib/types.ts`. The two are hand-kept in step until
//! `tauri-specta` generates the TypeScript from these definitions.

use serde::{Deserialize, Serialize};

use crate::transcribe::Segment;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum MeetingType {
    #[default]
    General,
    Discovery,
    Client,
    DesignReview,
    Sales,
}

impl MeetingType {
    pub fn as_str(self) -> &'static str {
        match self {
            MeetingType::General => "general",
            MeetingType::Discovery => "discovery",
            MeetingType::Client => "client",
            MeetingType::DesignReview => "design-review",
            MeetingType::Sales => "sales",
        }
    }

    /// Parse the kebab-case form used in frontmatter.
    pub fn from_slug(s: &str) -> Option<Self> {
        Some(match s {
            "general" => MeetingType::General,
            "discovery" => MeetingType::Discovery,
            "client" => MeetingType::Client,
            "design-review" => MeetingType::DesignReview,
            "sales" => MeetingType::Sales,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum MeetingStatus {
    #[default]
    Draft,
    Active,
    Processing,
    Complete,
    Error,
}

/// Transcript spans supporting a generated claim.
///
/// Every generated item cites the segments it came from. Anything whose
/// citations do not resolve is dropped rather than shown, which turns "the
/// model must not invent decisions" into something mechanically checkable.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Evidence {
    pub segment_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Claim {
    pub text: String,
    #[serde(default)]
    pub evidence: Evidence,
    /// 0..=1. Low-confidence items must not be presented as established fact.
    #[serde(default)]
    pub confidence: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActionItem {
    pub id: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    #[serde(default)]
    pub evidence: Evidence,
    #[serde(default)]
    pub confidence: f32,
    #[serde(default)]
    pub completed: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct GeneratedMeeting {
    pub summary: String,
    #[serde(default)]
    pub key_points: Vec<Claim>,
    #[serde(default)]
    pub decisions: Vec<Claim>,
    #[serde(default)]
    pub action_items: Vec<ActionItem>,
    #[serde(default)]
    pub open_questions: Vec<Claim>,
    /// Provenance, so a note can say honestly how it was produced.
    pub model: String,
    pub generated_at: String,
}

/// Longest gist shown in the library, in characters.
const GIST_MAX_CHARS: usize = 140;

impl GeneratedMeeting {
    /// One line saying what the meeting was about, for the library list.
    ///
    /// Taken from the summary's first sentence rather than asked of the model
    /// separately. A second field would have to survive windowing and
    /// consolidation on long meetings, and the summary already opens with the
    /// high-level description almost every time — deriving it costs nothing
    /// and cannot disagree with the summary it came from.
    pub fn gist(&self) -> Option<String> {
        let summary = self
            .summary
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        if summary.is_empty() {
            return None;
        }

        // A sentence ends at terminal punctuation followed by a space, so
        // "v2.1" and "e.g.x" do not end one early.
        let end = summary
            .char_indices()
            .find(|&(i, c)| {
                matches!(c, '.' | '!' | '?') && summary[i + c.len_utf8()..].starts_with(' ')
            })
            .map(|(i, c)| i + c.len_utf8())
            .unwrap_or(summary.len());
        let sentence = &summary[..end];

        if sentence.chars().count() <= GIST_MAX_CHARS {
            return Some(sentence.to_string());
        }

        // Cut on a word boundary, so the line never ends mid-word.
        let cut: String = sentence.chars().take(GIST_MAX_CHARS).collect();
        let cut = cut.rsplit_once(' ').map_or(cut.as_str(), |(head, _)| head);
        Some(format!("{}…", cut.trim_end_matches([',', ';', ':', ' '])))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Meeting {
    pub id: String,
    pub title: String,
    /// `YYYY-MM-DD`, local time.
    pub date: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    #[serde(default, rename = "type")]
    pub meeting_type: MeetingType,
    /// Who was on the other end — the people behind `them`. Named by the user
    /// after the meeting, since the audio topology knows only that a voice
    /// came from the system stream, not whose it was.
    #[serde(default)]
    pub participants: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    /// What the user said about the meeting afterwards — "this was an
    /// interview" — for synthesis to frame the notes by. Not evidence: nothing
    /// may cite it, because nobody said it in the meeting.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    /// Loudness across the meeting as block characters, for the library.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signal: Option<String>,
    /// The user's own notes. Never overwritten by generation.
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub transcript: Vec<Segment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generated: Option<GeneratedMeeting>,
    #[serde(default)]
    pub status: MeetingStatus,
}

impl Meeting {
    /// A new meeting starting now.
    pub fn new(id: impl Into<String>, title: impl Into<String>) -> Self {
        let now = chrono::Local::now();
        Self {
            id: id.into(),
            title: title.into(),
            date: now.format("%Y-%m-%d").to_string(),
            started_at: Some(now.to_rfc3339()),
            ended_at: None,
            meeting_type: MeetingType::default(),
            participants: Vec::new(),
            tags: Vec::new(),
            project: None,
            context: None,
            signal: None,
            notes: String::new(),
            transcript: Vec::new(),
            generated: None,
            status: MeetingStatus::Active,
        }
    }

    /// The name to show for a segment's speaker.
    ///
    /// `them` becomes a name only when exactly one is known. With several, the
    /// system stream is still all of them at once, and picking one would be a
    /// guess dressed up as attribution.
    pub fn speaker_name<'a>(&'a self, segment: &'a Segment) -> &'a str {
        match (segment.source, self.participants.as_slice()) {
            (crate::audio::StreamSource::System, [only]) => only.as_str(),
            _ => segment.speaker_label(),
        }
    }

    /// Segment ids that actually exist, for validating generated citations.
    pub fn segment_ids(&self) -> std::collections::HashSet<&str> {
        self.transcript.iter().map(|s| s.id.as_str()).collect()
    }

    /// Drop generated items whose evidence does not resolve.
    ///
    /// The mechanism behind "AI must not invent decisions": a claim citing a
    /// segment that does not exist is discarded rather than displayed. Returns
    /// how many items were removed, so the UI can say so rather than silently
    /// showing less.
    pub fn drop_unevidenced(&mut self) -> usize {
        let ids: std::collections::HashSet<String> =
            self.transcript.iter().map(|s| s.id.clone()).collect();

        let Some(generated) = self.generated.as_mut() else {
            return 0;
        };

        let resolves = |e: &Evidence| {
            !e.segment_ids.is_empty() && e.segment_ids.iter().all(|id| ids.contains(id))
        };

        let before = generated.key_points.len()
            + generated.decisions.len()
            + generated.action_items.len()
            + generated.open_questions.len();

        generated.key_points.retain(|c| resolves(&c.evidence));
        generated.decisions.retain(|c| resolves(&c.evidence));
        generated.action_items.retain(|a| resolves(&a.evidence));
        generated.open_questions.retain(|c| resolves(&c.evidence));

        let after = generated.key_points.len()
            + generated.decisions.len()
            + generated.action_items.len()
            + generated.open_questions.len();

        before - after
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::StreamSource;

    fn segment(id: &str) -> Segment {
        Segment {
            id: id.into(),
            start_ms: 0,
            end_ms: 100,
            text: "hello".into(),
            source: StreamSource::Microphone,
        }
    }

    fn claim(text: &str, evidence: &[&str]) -> Claim {
        Claim {
            text: text.into(),
            evidence: Evidence {
                segment_ids: evidence.iter().map(|s| s.to_string()).collect(),
            },
            confidence: 0.9,
        }
    }

    fn meeting_with(generated: GeneratedMeeting, segments: &[&str]) -> Meeting {
        let mut m = Meeting::new("m1", "Test");
        m.transcript = segments.iter().map(|id| segment(id)).collect();
        m.generated = Some(generated);
        m
    }

    fn summarised(summary: &str) -> GeneratedMeeting {
        GeneratedMeeting {
            summary: summary.into(),
            ..Default::default()
        }
    }

    #[test]
    fn the_gist_is_the_first_sentence() {
        let g = summarised("We reviewed the pricing page. Sarah owns the copy.");
        assert_eq!(g.gist().as_deref(), Some("We reviewed the pricing page."));
    }

    #[test]
    fn a_decimal_does_not_end_the_gist() {
        let g = summarised("We agreed to ship v2.1 on Friday. Then lunch.");
        assert_eq!(
            g.gist().as_deref(),
            Some("We agreed to ship v2.1 on Friday.")
        );
    }

    #[test]
    fn a_long_first_sentence_is_cut_on_a_word() {
        let long = "word ".repeat(60);
        let gist = summarised(&long).gist().unwrap();
        assert!(gist.ends_with('…'));
        assert!(gist.chars().count() <= GIST_MAX_CHARS + 1);
        assert!(gist.trim_end_matches('…').ends_with("word"));
    }

    #[test]
    fn line_breaks_in_the_summary_do_not_reach_the_gist() {
        // The gist is written to a single frontmatter line.
        let g = summarised("We met\nabout hiring");
        assert_eq!(g.gist().as_deref(), Some("We met about hiring"));
    }

    #[test]
    fn an_empty_summary_has_no_gist() {
        assert_eq!(summarised("  \n ").gist(), None);
    }

    #[test]
    fn a_new_meeting_is_active_and_dated_today() {
        let m = Meeting::new("id", "Title");
        assert_eq!(m.status, MeetingStatus::Active);
        assert_eq!(m.date.len(), 10, "expected YYYY-MM-DD");
        assert!(m.started_at.is_some());
        assert!(m.ended_at.is_none());
    }

    #[test]
    fn claims_citing_real_segments_survive() {
        let mut m = meeting_with(
            GeneratedMeeting {
                decisions: vec![claim("we ship friday", &["mic_0001"])],
                ..Default::default()
            },
            &["mic_0001"],
        );
        assert_eq!(m.drop_unevidenced(), 0);
        assert_eq!(m.generated.unwrap().decisions.len(), 1);
    }

    #[test]
    fn claims_citing_nonexistent_segments_are_dropped() {
        // The invented-decision case. This is the whole point.
        let mut m = meeting_with(
            GeneratedMeeting {
                decisions: vec![claim("we agreed to acquire a competitor", &["mic_9999"])],
                ..Default::default()
            },
            &["mic_0001"],
        );
        assert_eq!(m.drop_unevidenced(), 1);
        assert!(m.generated.unwrap().decisions.is_empty());
    }

    #[test]
    fn claims_with_no_evidence_at_all_are_dropped() {
        let mut m = meeting_with(
            GeneratedMeeting {
                key_points: vec![claim("something plausible", &[])],
                ..Default::default()
            },
            &["mic_0001"],
        );
        assert_eq!(m.drop_unevidenced(), 1);
    }

    #[test]
    fn a_claim_is_dropped_if_any_citation_fails() {
        // Partial grounding is not grounding: one real segment does not
        // license a claim that also cites a fabricated one.
        let mut m = meeting_with(
            GeneratedMeeting {
                decisions: vec![claim("half true", &["mic_0001", "mic_9999"])],
                ..Default::default()
            },
            &["mic_0001"],
        );
        assert_eq!(m.drop_unevidenced(), 1);
    }

    #[test]
    fn dropping_applies_across_every_generated_list() {
        let mut m = meeting_with(
            GeneratedMeeting {
                key_points: vec![claim("a", &["bad"])],
                decisions: vec![claim("b", &["bad"])],
                open_questions: vec![claim("c", &["bad"])],
                action_items: vec![ActionItem {
                    id: "a1".into(),
                    text: "d".into(),
                    owner: None,
                    due_date: None,
                    evidence: Evidence {
                        segment_ids: vec!["bad".into()],
                    },
                    confidence: 0.5,
                    completed: false,
                }],
                ..Default::default()
            },
            &["mic_0001"],
        );
        assert_eq!(m.drop_unevidenced(), 4);
    }

    #[test]
    fn a_meeting_with_no_generated_content_is_unaffected() {
        let mut m = Meeting::new("id", "Title");
        assert_eq!(m.drop_unevidenced(), 0);
    }

    #[test]
    fn meeting_type_round_trips_through_its_string_form() {
        for t in [
            MeetingType::General,
            MeetingType::Discovery,
            MeetingType::Client,
            MeetingType::DesignReview,
            MeetingType::Sales,
        ] {
            assert_eq!(MeetingType::from_slug(t.as_str()), Some(t));
        }
        assert_eq!(MeetingType::from_slug("nonsense"), None);
    }
}
