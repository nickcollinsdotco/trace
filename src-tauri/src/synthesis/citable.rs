//! What a claim is allowed to cite.
//!
//! Originally only transcript segments were citable, which had a bad
//! consequence: anything the user typed but never said aloud could not be
//! grounded, so validation silently discarded their own note. The notes were
//! informing the model but could not support a conclusion.
//!
//! Notes are now citable in their own right, with their own id namespace.
//! The anti-fabrication guarantee is unchanged — a claim still cannot cite
//! something that does not exist — but the set of things that exist now
//! includes what the user wrote.

use std::collections::HashSet;

use crate::meeting::Meeting;
use crate::transcribe::Segment;

/// A line of the user's notes, addressable like a transcript segment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoteLine {
    pub id: String,
    pub text: String,
}

/// Split notes into individually citable lines.
///
/// Blank lines are skipped rather than numbered, so ids stay stable against
/// the lines that actually carry content.
pub fn note_lines(notes: &str) -> Vec<NoteLine> {
    notes
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .enumerate()
        .map(|(i, text)| NoteLine {
            id: format!("note_{i:04}"),
            text: text.to_string(),
        })
        .collect()
}

/// Every id a claim may legitimately cite.
#[derive(Debug, Default, Clone)]
pub struct CitableSet {
    ids: HashSet<String>,
}

impl CitableSet {
    pub fn from_meeting(meeting: &Meeting) -> Self {
        let mut ids: HashSet<String> = meeting.transcript.iter().map(|s| s.id.clone()).collect();
        ids.extend(note_lines(&meeting.notes).into_iter().map(|n| n.id));
        Self { ids }
    }

    /// Build from segments alone, for callers with no notes.
    pub fn from_segments(segments: &[Segment]) -> Self {
        Self {
            ids: segments.iter().map(|s| s.id.clone()).collect(),
        }
    }

    pub fn contains(&self, id: &str) -> bool {
        self.ids.contains(id)
    }

    pub fn is_empty(&self) -> bool {
        self.ids.is_empty()
    }

    pub fn insert(&mut self, id: impl Into<String>) {
        self.ids.insert(id.into());
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
            end_ms: 1,
            text: "words".into(),
            source: StreamSource::Microphone,
        }
    }

    #[test]
    fn notes_split_into_numbered_lines() {
        let lines = note_lines("pricing unclear\nremove setup step");
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].id, "note_0000");
        assert_eq!(lines[0].text, "pricing unclear");
        assert_eq!(lines[1].id, "note_0001");
    }

    #[test]
    fn blank_lines_do_not_consume_ids() {
        // Numbering the blanks would make ids shift when someone adds a
        // paragraph break, invalidating citations already written.
        let lines = note_lines("first\n\n\n  \nsecond");
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[1].id, "note_0001");
        assert_eq!(lines[1].text, "second");
    }

    #[test]
    fn empty_notes_produce_nothing() {
        assert!(note_lines("").is_empty());
        assert!(note_lines("   \n  \n").is_empty());
    }

    #[test]
    fn a_meeting_makes_both_transcript_and_notes_citable() {
        let mut m = Meeting::new("m", "T");
        m.transcript = vec![segment("mic_0000")];
        m.notes = "something I only typed".into();

        let citable = CitableSet::from_meeting(&m);
        assert!(citable.contains("mic_0000"));
        assert!(
            citable.contains("note_0000"),
            "a typed note must be groundable"
        );
        assert!(!citable.contains("invented_9999"));
    }

    #[test]
    fn a_meeting_with_no_notes_still_has_its_transcript() {
        let mut m = Meeting::new("m", "T");
        m.transcript = vec![segment("mic_0000")];

        let citable = CitableSet::from_meeting(&m);
        assert!(citable.contains("mic_0000"));
        assert!(!citable.contains("note_0000"));
    }

    #[test]
    fn an_empty_meeting_makes_nothing_citable() {
        // Nothing was said and nothing was written, so any claim at all would
        // be invention.
        let citable = CitableSet::from_meeting(&Meeting::new("m", "T"));
        assert!(citable.is_empty());
    }
}
