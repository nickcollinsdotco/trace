//! Heavy background work the user should be able to see.
//!
//! After a meeting ends, the note is re-transcribed at full quality and then
//! summarised — minutes of work, most of it loading a multi-gigabyte model
//! into memory. That used to be visible only as a line on the note itself,
//! held in that screen's state: open another note and come back, and the line
//! was gone and "regenerate" was pressable again while the first run was still
//! going. Nothing in the backend refused a second run either, so two could
//! race to rewrite the same file.
//!
//! So the backend owns the record of what is running, and every screen reads
//! it. One job per note at a time, and one job doing heavy work at a time
//! (`Activity::lane`): the rest wait their turn, visibly, rather than
//! competing for the same memory.

use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

/// Emitted with the whole job list whenever any of it changes.
pub const EVENT_ACTIVITY: &str = "trace://activity";

/// Finished jobs remembered, so a note opened later can still show how its
/// notes were written. In memory only: this is a view, not a record.
const FINISHED_KEPT: usize = 20;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StepKind {
    /// The full-quality re-transcription.
    Transcript,
    /// Writing notes, before the meeting has been split into parts.
    Notes,
    /// One window of a meeting. `total` of 1 is the whole meeting.
    Part { index: usize, total: usize },
    /// The final pass combining several parts into one summary.
    Combine,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Step {
    #[serde(flatten)]
    pub kind: StepKind,
    /// Unix milliseconds. Absent while the step is waiting.
    pub started_at: Option<u64>,
    pub finished_at: Option<u64>,
    pub failed: bool,
    /// Why a step failed when the job carried on without it. A job that
    /// stopped says why in its `Outcome` instead.
    pub error: Option<String>,
}

impl Step {
    fn pending(kind: StepKind) -> Self {
        Self {
            kind,
            started_at: None,
            finished_at: None,
            failed: false,
            error: None,
        }
    }

    fn running(&self) -> bool {
        self.started_at.is_some() && self.finished_at.is_none()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum Outcome {
    Generated {
        dropped: usize,
        fabricated: usize,
        uncited: usize,
    },
    Failed {
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Job {
    pub id: u64,
    pub note_path: String,
    pub title: String,
    pub queued_at: u64,
    pub steps: Vec<Step>,
    /// Absent while the job is queued or running.
    pub outcome: Option<Outcome>,
}

impl Job {
    pub fn finished(&self) -> bool {
        self.outcome.is_some()
    }
}

/// Refused because this note already has a job queued or running.
#[derive(Debug, thiserror::Error)]
#[error("notes for this meeting are already being written")]
pub struct Busy;

#[derive(Default)]
struct Jobs {
    next_id: u64,
    list: Vec<Job>,
}

pub struct Activity {
    jobs: Mutex<Jobs>,
    lane: Mutex<()>,
}

/// The app's one record of background work.
pub static ACTIVITY: Activity = Activity::new();

impl Activity {
    pub const fn new() -> Self {
        Self {
            jobs: Mutex::new(Jobs {
                next_id: 0,
                list: Vec::new(),
            }),
            lane: Mutex::new(()),
        }
    }

    /// Everything running, waiting, or recently finished, oldest first.
    pub fn snapshot(&self) -> Vec<Job> {
        self.jobs().list.clone()
    }

    /// Queue a job for a note, or refuse if that note already has one.
    ///
    /// A finished job for the same note is replaced: the new run is what the
    /// note will show.
    pub fn begin(&self, note_path: &str, title: &str, transcript: bool) -> Result<u64, Busy> {
        let mut jobs = self.jobs();
        if jobs
            .list
            .iter()
            .any(|j| j.note_path == note_path && !j.finished())
        {
            return Err(Busy);
        }
        jobs.list.retain(|j| j.note_path != note_path);

        jobs.next_id += 1;
        let id = jobs.next_id;
        let mut steps = Vec::new();
        if transcript {
            steps.push(Step::pending(StepKind::Transcript));
        }
        steps.push(Step::pending(StepKind::Notes));
        jobs.list.push(Job {
            id,
            note_path: note_path.to_string(),
            title: title.to_string(),
            queued_at: now_ms(),
            steps,
            outcome: None,
        });

        Ok(id)
    }

    /// Wait for the heavy-work lane. Held for the whole of a job, so a second
    /// meeting ending mid-summary waits rather than loading a second model.
    pub fn lane(&self) -> MutexGuard<'_, ()> {
        self.lane.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Start a step, finishing whichever one was running.
    ///
    /// Starting `Part` replaces the `Notes` placeholder with every part, and
    /// the combining pass when there is more than one, because the number is
    /// only known once the meeting has been split — and showing what is still
    /// to come is most of what makes a long wait bearable. A combining pass
    /// that turns out not to be needed is dropped by `finish`.
    pub fn start(&self, id: u64, kind: StepKind) {
        self.with(id, |job| {
            let now = now_ms();
            for step in job.steps.iter_mut().filter(|s| s.running()) {
                step.finished_at = Some(now);
            }

            if let StepKind::Part { total, .. } = kind {
                if let Some(i) = job.steps.iter().position(|s| s.kind == StepKind::Notes) {
                    job.steps.remove(i);
                    let mut planned: Vec<Step> = (1..=total)
                        .map(|index| Step::pending(StepKind::Part { index, total }))
                        .collect();
                    if total > 1 {
                        planned.push(Step::pending(StepKind::Combine));
                    }
                    job.steps.splice(i..i, planned);
                }
            }

            match job.steps.iter_mut().find(|s| s.kind == kind) {
                Some(step) => step.started_at = Some(now),
                None => job.steps.push(Step {
                    started_at: Some(now),
                    ..Step::pending(kind)
                }),
            }
        });
    }

    /// Close the running step as failed and carry on.
    ///
    /// For a step the job can do without: a failed full-quality pass leaves
    /// the live transcript, which is still worth summarising. The reason is
    /// kept on the step, because "notes generated" alone would hide that they
    /// came from the rougher transcript.
    pub fn fail_step(&self, id: u64, reason: &str) {
        self.with(id, |job| {
            let now = now_ms();
            for step in job.steps.iter_mut().filter(|s| s.running()) {
                step.finished_at = Some(now);
                step.failed = true;
                step.error = Some(reason.to_string());
            }
        });
    }

    /// Finish the job. A running step is closed as failed or done to match,
    /// and steps that never started are dropped rather than left pending
    /// forever.
    pub fn finish(&self, id: u64, outcome: Outcome) {
        self.with(id, |job| {
            if job.finished() {
                return;
            }
            let now = now_ms();
            let failed = matches!(outcome, Outcome::Failed { .. });
            for step in job.steps.iter_mut().filter(|s| s.running()) {
                step.finished_at = Some(now);
                step.failed = failed;
            }
            job.steps.retain(|s| s.started_at.is_some());
            job.outcome = Some(outcome);
        });

        // Oldest finished jobs go first; running ones are never dropped.
        let mut jobs = self.jobs();
        while jobs.list.iter().filter(|j| j.finished()).count() > FINISHED_KEPT {
            if let Some(i) = jobs.list.iter().position(Job::finished) {
                jobs.list.remove(i);
            }
        }
    }

    fn with(&self, id: u64, f: impl FnOnce(&mut Job)) {
        if let Some(job) = self.jobs().list.iter_mut().find(|j| j.id == id) {
            f(job);
        }
    }

    // A poisoned lock means a panic mid-update of a display record. Carrying
    // on with it beats every later job failing to report.
    fn jobs(&self) -> MutexGuard<'_, Jobs> {
        self.jobs.lock().unwrap_or_else(|e| e.into_inner())
    }
}

impl Default for Activity {
    fn default() -> Self {
        Self::new()
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(a: &Activity) -> Vec<StepKind> {
        a.snapshot()[0]
            .steps
            .iter()
            .map(|s| s.kind.clone())
            .collect()
    }

    #[test]
    fn a_note_cannot_have_two_jobs_at_once() {
        let a = Activity::new();
        let id = a.begin("a.md", "A", false).unwrap();
        assert!(a.begin("a.md", "A", false).is_err());
        // Another note is not blocked; it queues behind the lane instead.
        assert!(a.begin("b.md", "B", false).is_ok());

        a.finish(
            id,
            Outcome::Failed {
                message: "x".into(),
            },
        );
        assert!(a.begin("a.md", "A", false).is_ok());
        // The finished run was replaced, not kept alongside.
        assert_eq!(
            a.snapshot()
                .iter()
                .filter(|j| j.note_path == "a.md")
                .count(),
            1
        );
    }

    #[test]
    fn parts_replace_the_placeholder_once_the_meeting_is_split() {
        let a = Activity::new();
        let id = a.begin("a.md", "A", true).unwrap();
        assert_eq!(kinds(&a), vec![StepKind::Transcript, StepKind::Notes]);

        a.start(id, StepKind::Transcript);
        a.start(id, StepKind::Part { index: 1, total: 3 });
        assert_eq!(
            kinds(&a),
            vec![
                StepKind::Transcript,
                StepKind::Part { index: 1, total: 3 },
                StepKind::Part { index: 2, total: 3 },
                StepKind::Part { index: 3, total: 3 },
                StepKind::Combine,
            ]
        );

        let steps = &a.snapshot()[0].steps;
        assert!(
            steps[0].finished_at.is_some(),
            "starting a step ends the last"
        );
        assert!(steps[1].running());
        assert!(steps[2].started_at.is_none());

        // Combining is where it was planned, not appended a second time.
        a.start(id, StepKind::Combine);
        assert_eq!(kinds(&a).len(), 5);
    }

    #[test]
    fn a_single_part_plans_no_combining_pass() {
        let a = Activity::new();
        let id = a.begin("a.md", "A", false).unwrap();
        a.start(id, StepKind::Part { index: 1, total: 1 });
        assert_eq!(kinds(&a), vec![StepKind::Part { index: 1, total: 1 }]);
    }

    #[test]
    fn a_failed_step_does_not_end_the_job() {
        let a = Activity::new();
        let id = a.begin("a.md", "A", true).unwrap();
        a.start(id, StepKind::Transcript);
        a.fail_step(id, "the transcription model did not load");
        a.start(id, StepKind::Notes);

        let job = &a.snapshot()[0];
        assert!(!job.finished(), "notes are still being written");
        assert!(job.steps[0].failed);
        assert_eq!(
            job.steps[0].error.as_deref(),
            Some("the transcription model did not load")
        );
        assert!(job.steps[1].running());

        // And a job finishing well afterwards keeps the record of it.
        a.finish(
            id,
            Outcome::Generated {
                dropped: 0,
                fabricated: 0,
                uncited: 0,
            },
        );
        let job = &a.snapshot()[0];
        assert!(job.steps[0].failed);
        assert!(!job.steps[1].failed);
    }

    #[test]
    fn finishing_drops_steps_that_never_ran() {
        let a = Activity::new();
        let id = a.begin("a.md", "A", false).unwrap();
        a.start(id, StepKind::Part { index: 1, total: 3 });
        a.finish(
            id,
            Outcome::Failed {
                message: "Ollama closed".into(),
            },
        );

        let job = &a.snapshot()[0];
        assert_eq!(job.steps.len(), 1);
        assert!(job.steps[0].failed);
        assert!(job.finished());
    }

    #[test]
    fn a_finished_job_is_not_reopened_by_a_late_update() {
        let a = Activity::new();
        let id = a.begin("a.md", "A", false).unwrap();
        a.finish(
            id,
            Outcome::Generated {
                dropped: 0,
                fabricated: 0,
                uncited: 0,
            },
        );
        a.finish(
            id,
            Outcome::Failed {
                message: "late".into(),
            },
        );
        assert!(matches!(
            a.snapshot()[0].outcome,
            Some(Outcome::Generated { .. })
        ));
    }

    #[test]
    fn old_finished_jobs_are_forgotten_but_running_ones_never_are() {
        let a = Activity::new();
        let running = a.begin("running.md", "R", false).unwrap();
        for i in 0..FINISHED_KEPT + 5 {
            let id = a.begin(&format!("{i}.md"), "N", false).unwrap();
            a.finish(
                id,
                Outcome::Failed {
                    message: "x".into(),
                },
            );
        }
        let jobs = a.snapshot();
        assert_eq!(jobs.iter().filter(|j| j.finished()).count(), FINISHED_KEPT);
        assert!(jobs.iter().any(|j| j.id == running));
    }

    #[test]
    fn serialises_in_the_shape_the_frontend_reads() {
        let a = Activity::new();
        let id = a.begin("a.md", "A", false).unwrap();
        a.start(id, StepKind::Part { index: 2, total: 5 });
        let json = serde_json::to_value(a.snapshot()).unwrap();
        let step = &json[0]["steps"][1];
        assert_eq!(step["kind"], "part");
        assert_eq!(step["index"], 2);
        assert_eq!(step["total"], 5);
        assert!(json[0]["outcome"].is_null());
    }
}
