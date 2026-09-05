//! Append-only session journal.
//!
//! Everything that happens during a meeting is appended to `session.jsonl` as
//! it happens — one JSON object per line, flushed immediately. The Markdown
//! file is written once, at the end. Between those two points the journal is
//! the only thing standing between a crash and a lost meeting.
//!
//! Append-only is the whole design. There is no seeking, no rewriting, and no
//! in-place update, so a process killed mid-write can corrupt at most the
//! final line. Replay tolerates that: a trailing partial line is discarded and
//! everything before it is recovered.
//!
//! Notes are journalled as whole snapshots rather than edits. They are small,
//! and a snapshot cannot desynchronise the way a patch stream can.

use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::audio::session::StreamOutcome;
use crate::meeting::{GeneratedMeeting, Meeting, MeetingStatus, MeetingType};
use crate::transcribe::Segment;

use super::StoreError;

/// One journalled fact. Order in the file is order of occurrence.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum JournalEvent {
    SessionStarted {
        id: String,
        title: String,
        date: String,
        started_at: String,
    },
    /// A transcript segment. Provisional ones are superseded on replay by the
    /// final pass, which writes `TranscriptReplaced`.
    Segment(Segment),
    /// The complete transcript from the accurate pass, replacing everything
    /// journalled live.
    TranscriptReplaced {
        segments: Vec<Segment>,
    },
    /// Full snapshot of the user's notes.
    Notes {
        text: String,
    },
    TitleChanged {
        title: String,
    },
    TypeChanged {
        #[serde(rename = "type")]
        meeting_type: MeetingType,
    },
    StreamFinished(Box<StreamOutcome>),
    Generated(Box<GeneratedMeeting>),
    SessionEnded {
        ended_at: String,
    },
}

/// Writes events to a session's journal.
pub struct Journal {
    file: File,
    path: PathBuf,
}

impl Journal {
    /// Open or create the journal for a session directory.
    ///
    /// Opened in append mode, so reopening after a crash continues the same
    /// file rather than truncating what was recovered.
    pub fn open(session_dir: impl AsRef<Path>) -> Result<Self, StoreError> {
        let dir = session_dir.as_ref();
        std::fs::create_dir_all(dir)?;
        let path = dir.join("session.jsonl");

        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        Ok(Self { file, path })
    }

    /// Append an event and flush it to the OS.
    ///
    /// Flushed on every write. A journal that batches would lose exactly the
    /// events a crash makes most valuable, and meeting-rate events are far too
    /// infrequent for the cost to matter.
    pub fn append(&mut self, event: &JournalEvent) -> Result<(), StoreError> {
        let line = serde_json::to_string(event)?;
        self.file.write_all(line.as_bytes())?;
        self.file.write_all(b"\n")?;
        self.file.flush()?;
        Ok(())
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

/// Outcome of replaying a journal.
#[derive(Debug)]
pub struct Replay {
    pub meeting: Meeting,
    /// Lines that could not be parsed.
    ///
    /// Expected to be at most one, at the end, from a crash mid-write. More
    /// than that means something is wrong and the user should be told rather
    /// than quietly handed a partial meeting.
    pub corrupt_lines: usize,
    /// Whether the session was ended cleanly.
    pub was_finished: bool,
}

/// Rebuild a meeting from its journal.
///
/// Unparseable lines are skipped rather than aborting the replay: recovering
/// most of a meeting is worth far more than refusing to recover any of it.
pub fn replay(session_dir: impl AsRef<Path>) -> Result<Replay, StoreError> {
    let path = session_dir.as_ref().join("session.jsonl");
    let file = File::open(&path)?;
    let reader = BufReader::new(file);

    let mut meeting: Option<Meeting> = None;
    let mut corrupt_lines = 0usize;
    let mut was_finished = false;

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => {
                corrupt_lines += 1;
                continue;
            }
        };
        if line.trim().is_empty() {
            continue;
        }

        let event: JournalEvent = match serde_json::from_str(&line) {
            Ok(e) => e,
            Err(_) => {
                corrupt_lines += 1;
                continue;
            }
        };

        apply(&mut meeting, event, &mut was_finished);
    }

    let mut meeting = meeting.ok_or(StoreError::NoSessionStart)?;

    // A journal that was never closed describes an interrupted meeting.
    if !was_finished && meeting.status == MeetingStatus::Active {
        meeting.status = MeetingStatus::Draft;
    }

    Ok(Replay {
        meeting,
        corrupt_lines,
        was_finished,
    })
}

fn apply(meeting: &mut Option<Meeting>, event: JournalEvent, was_finished: &mut bool) {
    // Every event except the opener needs a meeting to apply to. Events before
    // one are from a truncated or reordered file and are ignored.
    if let JournalEvent::SessionStarted {
        id,
        title,
        date,
        started_at,
    } = &event
    {
        let mut m = Meeting::new(id.clone(), title.clone());
        m.date = date.clone();
        m.started_at = Some(started_at.clone());
        *meeting = Some(m);
        return;
    }

    let Some(m) = meeting.as_mut() else { return };

    match event {
        JournalEvent::SessionStarted { .. } => unreachable!("handled above"),
        JournalEvent::Segment(segment) => m.transcript.push(segment),
        JournalEvent::TranscriptReplaced { segments } => m.transcript = segments,
        JournalEvent::Notes { text } => m.notes = text,
        JournalEvent::TitleChanged { title } => m.title = title,
        JournalEvent::TypeChanged { meeting_type } => m.meeting_type = meeting_type,
        JournalEvent::StreamFinished(_) => {}
        JournalEvent::Generated(generated) => {
            m.generated = Some(*generated);
            m.status = MeetingStatus::Complete;
        }
        JournalEvent::SessionEnded { ended_at } => {
            m.ended_at = Some(ended_at);
            *was_finished = true;
            if m.status == MeetingStatus::Active {
                m.status = MeetingStatus::Complete;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::StreamSource;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "trace-journal-{}-{}-{:?}",
            name,
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn segment(id: &str, text: &str) -> Segment {
        Segment {
            id: id.into(),
            start_ms: 0,
            end_ms: 500,
            text: text.into(),
            source: StreamSource::Microphone,
        }
    }

    fn started() -> JournalEvent {
        JournalEvent::SessionStarted {
            id: "s1".into(),
            title: "Client Alpha".into(),
            date: "2026-09-05".into(),
            started_at: "2026-09-05T10:00:00Z".into(),
        }
    }

    #[test]
    fn replays_a_complete_session() {
        let dir = temp_dir("complete");
        let mut j = Journal::open(&dir).unwrap();
        j.append(&started()).unwrap();
        j.append(&JournalEvent::Segment(segment("mic_0000", "hello")))
            .unwrap();
        j.append(&JournalEvent::Notes {
            text: "pricing unclear".into(),
        })
        .unwrap();
        j.append(&JournalEvent::SessionEnded {
            ended_at: "2026-09-05T10:30:00Z".into(),
        })
        .unwrap();

        let r = replay(&dir).unwrap();
        assert_eq!(r.meeting.title, "Client Alpha");
        assert_eq!(r.meeting.transcript.len(), 1);
        assert_eq!(r.meeting.notes, "pricing unclear");
        assert!(r.was_finished);
        assert_eq!(r.meeting.status, MeetingStatus::Complete);
        assert_eq!(r.corrupt_lines, 0);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn recovers_a_session_that_never_ended() {
        // The crash case: capture was interrupted, nothing wrote SessionEnded.
        let dir = temp_dir("crash");
        let mut j = Journal::open(&dir).unwrap();
        j.append(&started()).unwrap();
        j.append(&JournalEvent::Segment(segment("mic_0000", "we agreed")))
            .unwrap();
        j.append(&JournalEvent::Notes {
            text: "half-written".into(),
        })
        .unwrap();
        drop(j); // no SessionEnded — process died here

        let r = replay(&dir).unwrap();
        assert!(!r.was_finished);
        assert_eq!(r.meeting.status, MeetingStatus::Draft);
        assert_eq!(r.meeting.transcript.len(), 1, "segments must survive");
        assert_eq!(r.meeting.notes, "half-written", "notes must survive");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_truncated_final_line_does_not_lose_the_rest() {
        // A process killed mid-write leaves a partial line. Everything before
        // it is still good and must be recovered.
        let dir = temp_dir("truncated");
        let mut j = Journal::open(&dir).unwrap();
        j.append(&started()).unwrap();
        j.append(&JournalEvent::Segment(segment("mic_0000", "kept")))
            .unwrap();
        drop(j);

        let mut f = OpenOptions::new()
            .append(true)
            .open(dir.join("session.jsonl"))
            .unwrap();
        f.write_all(b"{\"event\":\"segment\",\"id\":\"mic_00")
            .unwrap();
        drop(f);

        let r = replay(&dir).unwrap();
        assert_eq!(r.corrupt_lines, 1);
        assert_eq!(r.meeting.transcript.len(), 1);
        assert_eq!(r.meeting.transcript[0].text, "kept");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn notes_snapshots_replace_rather_than_accumulate() {
        let dir = temp_dir("notes");
        let mut j = Journal::open(&dir).unwrap();
        j.append(&started()).unwrap();
        j.append(&JournalEvent::Notes { text: "one".into() })
            .unwrap();
        j.append(&JournalEvent::Notes {
            text: "one two".into(),
        })
        .unwrap();
        j.append(&JournalEvent::Notes {
            text: "one two three".into(),
        })
        .unwrap();

        let r = replay(&dir).unwrap();
        assert_eq!(r.meeting.notes, "one two three", "last snapshot wins");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_final_pass_replaces_provisional_segments() {
        let dir = temp_dir("replace");
        let mut j = Journal::open(&dir).unwrap();
        j.append(&started()).unwrap();
        j.append(&JournalEvent::Segment(segment("mic_0000", "provisional")))
            .unwrap();
        j.append(&JournalEvent::Segment(segment(
            "mic_0001",
            "also provisional",
        )))
        .unwrap();
        j.append(&JournalEvent::TranscriptReplaced {
            segments: vec![segment("mic_0000", "accurate")],
        })
        .unwrap();

        let r = replay(&dir).unwrap();
        assert_eq!(r.meeting.transcript.len(), 1);
        assert_eq!(r.meeting.transcript[0].text, "accurate");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reopening_appends_rather_than_truncating() {
        // Recovery reopens the journal to continue the session. Truncating
        // here would destroy exactly what was just recovered.
        let dir = temp_dir("reopen");
        let mut j = Journal::open(&dir).unwrap();
        j.append(&started()).unwrap();
        j.append(&JournalEvent::Segment(segment("mic_0000", "before")))
            .unwrap();
        drop(j);

        let mut j2 = Journal::open(&dir).unwrap();
        j2.append(&JournalEvent::Segment(segment("mic_0001", "after")))
            .unwrap();
        drop(j2);

        let r = replay(&dir).unwrap();
        assert_eq!(r.meeting.transcript.len(), 2);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_journal_without_a_start_event_is_an_error() {
        let dir = temp_dir("nostart");
        let mut j = Journal::open(&dir).unwrap();
        j.append(&JournalEvent::Notes {
            text: "orphaned".into(),
        })
        .unwrap();
        drop(j);

        assert!(matches!(replay(&dir), Err(StoreError::NoSessionStart)));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_missing_journal_is_an_io_error_not_a_panic() {
        let dir = temp_dir("missing").join("nope");
        assert!(replay(&dir).is_err());
    }
}
