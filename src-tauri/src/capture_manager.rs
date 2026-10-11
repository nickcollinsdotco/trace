//! Owns the lifecycle of a running meeting.
//!
//! Everything the spikes did by hand — start capture, pump audio to the
//! transcriber, journal what comes back, publish it to the UI, then finalise —
//! lives here behind one type, so the Tauri commands stay thin.
//!
//! ```text
//!   capture threads ──tap──> pump thread ──> live transcriber
//!                                │                  │
//!                                │<─── segments ────┘
//!                                ├──> journal (durable)
//!                                └──> Tauri event (UI)
//! ```
//!
//! The pump journals a segment *before* emitting it. A segment the user has
//! seen but that was never written down is the one outcome worth avoiding.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::activity::{MemoryWait, Outcome, StepKind, WaitChoice, ACTIVITY, EVENT_ACTIVITY};
use crate::audio::session::{CaptureSession, SessionSummary, StreamOutcome};
use crate::audio::{CapturedAudio, StreamSource};
use crate::diagnostics;
use crate::meeting::Meeting;
use crate::store::journal::{Journal, JournalEvent};
use crate::store::{self, paths};
use crate::transcribe::live::{AudioTap, LiveEvent, LiveTranscriber};
use crate::transcribe::{Segment, Transcriber};

/// Event names the frontend subscribes to.
pub const EVENT_SEGMENT: &str = "trace://segment";
pub const EVENT_CAPTURE_ERROR: &str = "trace://capture-error";
/// Emitted when the accurate re-pass has replaced the live transcript.
pub const EVENT_TRANSCRIPT_UPDATED: &str = "trace://transcript-updated";
/// Structured notes were generated and written. Progress and failure are
/// reported through `activity`, which every screen reads, rather than as
/// events only the screen open at the time would hear.
pub const EVENT_NOTES_GENERATED: &str = "trace://notes-generated";

#[derive(Debug, thiserror::Error)]
pub enum ManagerError {
    #[error("a meeting is already being recorded")]
    AlreadyActive,
    #[error("no meeting is being recorded")]
    NotActive,
    #[error(transparent)]
    Store(#[from] store::StoreError),
    #[error("transcription unavailable: {0}")]
    Transcribe(String),
}

/// What the UI needs to render the capture screen.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CaptureStatus {
    pub session_id: String,
    pub title: String,
    pub elapsed_ms: u64,
    pub levels: Vec<StreamLevel>,
    pub segment_count: usize,
    /// True when the live transcript has holes the final pass will not.
    pub dropped_audio: bool,
    /// False when no model is installed; capture still works, transcription
    /// simply does not happen until the model is downloaded.
    pub transcribing: bool,
    /// Chunks currently being transcribed.
    pub in_flight: u64,
    /// Speech already spoken but not yet shown, because its chunk has not
    /// closed. This is the latency the user perceives, and reporting it lets
    /// the UI say the system is working rather than appearing stalled.
    pub pending_speech_ms: u64,
    /// The microphone asked for — a device name, or `None` for the system
    /// default. For the mini window's details; not the device's own report.
    pub mic: Option<String>,
    /// The transcription model this meeting uses, as people know it.
    pub speech_model: String,
    /// The summary model has no room right now, so its notes may have to
    /// wait once the meeting ends. Said during the meeting, when closing
    /// something is still an option, rather than discovered after it.
    pub memory_tight: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct StreamLevel {
    pub source: StreamSource,
    pub level: f32,
}

/// One stream's latest waveform, oldest sample first.
#[derive(Debug, Clone, serde::Serialize)]
pub struct StreamWave {
    pub source: StreamSource,
    pub samples: Vec<f32>,
}

/// Result of finishing a meeting.
#[derive(Debug, Clone, serde::Serialize)]
pub struct FinishedMeeting {
    pub meeting: Meeting,
    pub note_path: PathBuf,
    pub summary: SessionSummary,
}

struct Active {
    session_id: String,
    title: String,
    dir: PathBuf,
    capture: CaptureSession,
    journal: Arc<Mutex<Journal>>,
    segments: Arc<Mutex<Vec<Segment>>>,
    live: Option<Arc<LiveTranscriber>>,
    pump_stop: Arc<AtomicBool>,
    pump: Option<JoinHandle<()>>,
    /// Chosen when the meeting starts and used for its re-pass too, so
    /// switching models mid-meeting cannot give one transcript two engines.
    speech: &'static crate::models::ModelSpec,
    /// Watches memory through the meeting and, when the user keeps the
    /// summary model ready, holds it loaded until the notes are written.
    /// `None` when Ollama was not ready.
    model_hold: Option<crate::synthesis::ollama::ModelHold>,
    mic: Option<String>,
    /// The latest notes journalled, so a recording screen opened mid-meeting
    /// starts from them. Each journal entry is the whole text, so a screen
    /// that started empty would replace them all with its first keystroke.
    notes: String,
}

/// The application's capture state. One meeting at a time, by design.
#[derive(Default)]
pub struct CaptureManager {
    active: Mutex<Option<Active>>,
    notes_root: Mutex<Option<PathBuf>>,
}

impl CaptureManager {
    /// Where notes are written. Overridable for tests via `TRACE_NOTES_ROOT`.
    pub fn notes_root(&self) -> Result<PathBuf, store::StoreError> {
        match self.notes_root_override() {
            Some(root) => Ok(root),
            None => paths::default_notes_root(),
        }
    }

    pub fn set_notes_root(&self, root: PathBuf) {
        if let Ok(mut guard) = self.notes_root.lock() {
            *guard = Some(root);
        }
    }

    /// The notes root a test or `TRACE_NOTES_ROOT` set, if any.
    fn notes_root_override(&self) -> Option<PathBuf> {
        self.notes_root
            .lock()
            .ok()
            .and_then(|g| g.clone())
            .or_else(|| std::env::var_os("TRACE_NOTES_ROOT").map(PathBuf::from))
    }

    /// Where sessions are kept: local app data, or inside an overridden
    /// notes root, so a test's meetings never land among real ones.
    pub fn sessions_root(&self) -> Result<PathBuf, store::StoreError> {
        match self.notes_root_override() {
            Some(root) => Ok(paths::sessions_beside(&root)),
            None => paths::default_sessions_root(),
        }
    }

    /// Bring sessions recorded before 0.29 out of the notes folder.
    ///
    /// Every launch, not once: a session in use by another running TRACE is
    /// left where it is, and the next launch finds it finished.
    pub fn move_old_sessions(&self) {
        let (Ok(notes), Ok(sessions)) = (self.notes_root(), self.sessions_root()) else {
            return;
        };
        let old = paths::sessions_beside(&notes);
        if old == sessions || !old.exists() {
            return;
        }
        let moved = paths::move_sessions(&old, &sessions);
        if moved.moved + moved.left > 0 {
            diagnostics::log(format!(
                "sessions moved out of the notes folder: {} moved, {} left",
                moved.moved, moved.left
            ));
        }
    }

    pub fn is_active(&self) -> bool {
        self.active.lock().map(|g| g.is_some()).unwrap_or(false)
    }

    /// Begin recording.
    ///
    /// Transcription is optional: if no model is installed the meeting is still
    /// captured and journalled, because losing the recording would be far worse
    /// than lacking a live transcript.
    pub fn start(
        &self,
        app: AppHandle,
        title: String,
        mic_device: Option<String>,
    ) -> Result<CaptureStatus, ManagerError> {
        let mut guard = self.active.lock().map_err(|_| ManagerError::NotActive)?;
        if guard.is_some() {
            return Err(ManagerError::AlreadyActive);
        }
        // The title is the user's words, so it stays out of the log.
        diagnostics::log(format!(
            "meeting started, microphone: {}",
            mic_device.as_deref().unwrap_or("default")
        ));

        let now = chrono::Local::now();
        let session_id = format!("sess-{}", now.timestamp_millis());
        let dir = paths::session_dir(&self.sessions_root()?, &session_id);

        let mut journal = Journal::open(&dir)?;
        journal.append(&JournalEvent::SessionStarted {
            id: session_id.clone(),
            title: title.clone(),
            date: now.format("%Y-%m-%d").to_string(),
            started_at: now.to_rfc3339(),
        })?;
        let journal = Arc::new(Mutex::new(journal));

        // Load the language model now, in the background, if the user keeps
        // it ready and there is room. Synthesis does not run until the
        // meeting ends, but the first load after a cold boot takes about a
        // minute, and paying it during the meeting means the user never waits
        // for it afterwards. Either way memory is watched, so a meeting whose
        // notes will have to wait can say so while it is still running.
        let preload = crate::settings::load().summary_memory()
            == crate::settings::SummaryMemory::DuringMeetings;
        let model_hold = default_provider().map(|provider| {
            crate::synthesis::ollama::ModelHold::for_meeting(provider.model(), preload)
        });

        // Load the transcription engine before capture starts. It takes about
        // a second, and doing it afterwards would miss the opening.
        let speech = crate::models::active_speech_model();
        diagnostics::log(format!("transcribing with {}", speech.display_name));
        let live = Transcriber::load_model(speech)
            .ok()
            .map(LiveTranscriber::start)
            .map(Arc::new);
        let transcribing = live.is_some();

        let (tap_tx, tap_rx) = crossbeam_channel::bounded::<CapturedAudio>(4000);
        let mic = mic_device.clone();
        let capture = CaptureSession::start(&session_id, &dir, mic_device, Some(tap_tx));

        let segments = Arc::new(Mutex::new(Vec::new()));
        let pump_stop = Arc::new(AtomicBool::new(false));

        let pump = spawn_pump(
            app,
            tap_rx,
            live.clone(),
            Arc::clone(&journal),
            Arc::clone(&segments),
            Arc::clone(&pump_stop),
        );

        let status = CaptureStatus {
            session_id: session_id.clone(),
            title: title.clone(),
            elapsed_ms: 0,
            levels: Vec::new(),
            segment_count: 0,
            dropped_audio: false,
            transcribing,
            in_flight: 0,
            pending_speech_ms: 0,
            mic: mic.clone(),
            speech_model: speech.display_name.to_string(),
            memory_tight: false,
        };

        *guard = Some(Active {
            session_id,
            title,
            dir,
            capture,
            journal,
            segments,
            live,
            pump_stop,
            pump: Some(pump),
            speech,
            model_hold,
            mic,
            notes: String::new(),
        });

        Ok(status)
    }

    /// The live scope's waveforms, or `None` when nothing is recording.
    ///
    /// Separate from `status`, which the sidebar and narrator poll once a
    /// second: this is polled at drawing speed, and only while a scope is on
    /// screen, so it carries nothing but samples.
    pub fn scope(&self, points: usize) -> Option<Vec<StreamWave>> {
        let guard = self.active.lock().ok()?;
        let active = guard.as_ref()?;
        Some(
            active
                .capture
                .scope(points)
                .into_iter()
                .map(|(source, samples)| StreamWave { source, samples })
                .collect(),
        )
    }

    /// Poll for the meters and elapsed time. Cheap enough for a UI timer.
    pub fn status(&self) -> Option<CaptureStatus> {
        let guard = self.active.lock().ok()?;
        let active = guard.as_ref()?;

        Some(CaptureStatus {
            session_id: active.session_id.clone(),
            title: active.title.clone(),
            elapsed_ms: active.capture.elapsed_ms(),
            levels: active
                .capture
                .levels()
                .into_iter()
                .map(|(source, level)| StreamLevel { source, level })
                .collect(),
            segment_count: active.segments.lock().map(|s| s.len()).unwrap_or(0),
            dropped_audio: active
                .live
                .as_ref()
                .map(|l| l.dropped_audio())
                .unwrap_or(false),
            transcribing: active.live.is_some(),
            in_flight: active
                .live
                .as_ref()
                .map(|l| {
                    l.activity()
                        .in_flight
                        .load(std::sync::atomic::Ordering::Relaxed)
                })
                .unwrap_or(0),
            pending_speech_ms: active
                .live
                .as_ref()
                .map(|l| {
                    l.activity()
                        .pending_speech_ms
                        .load(std::sync::atomic::Ordering::Relaxed)
                })
                .unwrap_or(0),
            mic: active.mic.clone(),
            speech_model: active.speech.display_name.to_string(),
            memory_tight: active
                .model_hold
                .as_ref()
                .is_some_and(crate::synthesis::ollama::ModelHold::tight),
        })
    }

    /// Persist the user's notes.
    ///
    /// Journalled as a whole snapshot on every call, so the debounce lives in
    /// the UI where it belongs rather than risking a lost final edit here.
    pub fn update_notes(&self, text: String) -> Result<(), ManagerError> {
        let mut guard = self.active.lock().map_err(|_| ManagerError::NotActive)?;
        let active = guard.as_mut().ok_or(ManagerError::NotActive)?;

        if let Ok(mut journal) = active.journal.lock() {
            journal.append(&JournalEvent::Notes { text: text.clone() })?;
        }
        active.notes = text;
        Ok(())
    }

    /// The running meeting's notes as last saved.
    pub fn notes(&self) -> Result<String, ManagerError> {
        let guard = self.active.lock().map_err(|_| ManagerError::NotActive)?;
        let active = guard.as_ref().ok_or(ManagerError::NotActive)?;
        Ok(active.notes.clone())
    }

    pub fn set_title(&self, title: String) -> Result<(), ManagerError> {
        let mut guard = self.active.lock().map_err(|_| ManagerError::NotActive)?;
        let active = guard.as_mut().ok_or(ManagerError::NotActive)?;

        if let Ok(mut journal) = active.journal.lock() {
            journal.append(&JournalEvent::TitleChanged {
                title: title.clone(),
            })?;
        }
        active.title = title;
        Ok(())
    }

    /// Take ownership of the running session, or report that there is none.
    ///
    /// Split out from `stop` so the no-active-meeting case stays unit-testable:
    /// `stop` needs an `AppHandle`, which cannot be constructed outside a
    /// running Tauri app.
    fn take_active(&self) -> Result<Active, ManagerError> {
        let mut guard = self.active.lock().map_err(|_| ManagerError::NotActive)?;
        guard.take().ok_or(ManagerError::NotActive)
    }

    /// Stop recording, finalise the transcript, and write the note.
    ///
    /// `app` is passed in rather than held on the session. An `AppHandle`
    /// stored inside `.manage()` state makes the library test binary fail to
    /// load on Windows with STATUS_ENTRYPOINT_NOT_FOUND — it drags the Wry
    /// runtime into a binary that never starts an app. Passing it per-call
    /// avoids that entirely.
    /// Abandon the meeting, writing nothing.
    ///
    /// Starting a recording used to commit you to it: the only way out was to
    /// stop, which writes a note, re-transcribes and runs synthesis. A meeting
    /// begun by accident, or one that went wrong in the first ten seconds,
    /// left a file to clean up and spent minutes of compute getting there.
    ///
    /// This tears down the same machinery as `stop` and then deletes the
    /// session directory outright. No note, no re-pass, no synthesis.
    ///
    /// Deliberately irreversible, and deliberately named so. The confirmation
    /// belongs in the UI, where the user can see what they are discarding.
    pub fn abort(&self) -> Result<(), ManagerError> {
        let active = self.take_active()?;
        diagnostics::log("meeting discarded by the user");

        // Same teardown order as `stop`: capture first so the tap closes and
        // the pump can drain, otherwise the join below waits on a thread that
        // is still being fed.
        let _summary = active.capture.stop();

        active.pump_stop.store(true, Ordering::Relaxed);
        if let Some(pump) = active.pump {
            pump.join().ok();
        }

        // Dropped rather than flushed. `stop` drains the transcriber's
        // trailing utterance because it is often the conclusion; here there is
        // nowhere for it to go.
        drop(active.live);

        // No notes will be written, so nothing needs the summary model.
        drop(active.model_hold);

        // Best-effort. A locked WAV leaves files behind, which is untidy but
        // not a failure the user can act on — and reporting it would suggest
        // the meeting was somehow kept, which it was not.
        let _ = store::discard_session(&active.dir);
        Ok(())
    }

    pub fn stop(&self, app: AppHandle) -> Result<FinishedMeeting, ManagerError> {
        let active = self.take_active()?;

        // Stop capture first so the WAVs are finalised and the tap closes,
        // which lets the pump drain and exit on its own.
        let summary = active.capture.stop();
        log_streams(&summary);

        active.pump_stop.store(true, Ordering::Relaxed);
        if let Some(pump) = active.pump {
            pump.join().ok();
        }

        // Flush the transcriber's trailing utterance — often the conclusion.
        if let Some(live) = active.live {
            if let Ok(live) = Arc::try_unwrap(live) {
                for event in live.stop() {
                    if let LiveEvent::Segment(segment) = event {
                        if let Ok(mut journal) = active.journal.lock() {
                            let _ = journal.append(&JournalEvent::Segment(segment.clone()));
                        }
                        if let Ok(mut segments) = active.segments.lock() {
                            segments.push(segment);
                        }
                    }
                }
            }
        }

        let ended_at = chrono::Local::now().to_rfc3339();
        for outcome in &summary.streams {
            if let Ok(mut journal) = active.journal.lock() {
                let _ = journal.append(&JournalEvent::StreamFinished(Box::new(outcome.clone())));
            }
        }
        if let Ok(mut journal) = active.journal.lock() {
            journal.append(&JournalEvent::SessionEnded {
                ended_at: ended_at.clone(),
            })?;
        }

        // Rebuild from the journal rather than from memory. The journal is what
        // survives a crash, so making it the source of truth here means the
        // normal path and the recovery path produce identical results.
        let replay = crate::store::journal::replay(&active.dir)?;
        let meeting = replay.meeting;
        diagnostics::log(format!(
            "meeting ended: {} live segments, {} characters of notes",
            meeting.transcript.len(),
            meeting.notes.chars().count()
        ));

        let notes_root = self.notes_root()?;
        let note_path = store::write_note(&notes_root, &meeting)?;

        // The re-pass runs in the background rather than blocking here. Each
        // stream runs at roughly 25x realtime, but there are two, transcribed
        // one after the other, so an hour-long meeting takes four to five
        // minutes — 4.5 measured on a Ryzen 7 7800X3D. Holding the UI on
        // "Saving..." for that long after a meeting ends would be worse than
        // briefly showing a slightly rougher transcript. The note on disk is
        // already complete and correct; the re-pass only improves its wording.
        //
        // The session directory is deliberately NOT discarded here — the
        // re-pass still needs the WAVs and the journal.

        // Queued here rather than in the thread, so the job is on screen from
        // the moment the meeting ends. A note path is new per meeting, so this
        // cannot collide with a job already running.
        let job = ACTIVITY
            .begin(&note_path.display().to_string(), &meeting.title, true)
            .ok()
            .map(|id| Tracked::new(app.clone(), id));

        spawn_repass(
            app,
            job,
            active.dir.clone(),
            note_path.clone(),
            summary.clone(),
            active.speech,
            active.model_hold,
            Underway::begin(&active.dir, &note_path),
        );

        Ok(FinishedMeeting {
            meeting,
            note_path,
            summary,
        })
    }
}

/// One line per stream, so a meeting with a dead or glitching device can be
/// told apart from one where nobody spoke.
fn log_streams(summary: &SessionSummary) {
    for s in &summary.streams {
        diagnostics::log(format!(
            "stream {:?} on \"{}\": {:.0}s at {} Hz, {} chunks dropped, {} stream errors{}",
            s.source,
            s.device_name,
            s.duration_secs(),
            s.sample_rate,
            s.chunks_dropped,
            s.stream_errors,
            s.error
                .as_deref()
                .map(|e| format!(", failed: {e}"))
                .unwrap_or_default()
        ));
    }
}

/// A job's handle. Every change is published to the UI, and a job its thread
/// abandons without an outcome is closed rather than left running forever —
/// which would leave the note unable to be regenerated until a restart.
struct Tracked {
    app: AppHandle,
    id: u64,
}

impl Tracked {
    fn new(app: AppHandle, id: u64) -> Self {
        let tracked = Self { app, id };
        tracked.publish();
        tracked
    }

    fn start(&self, kind: StepKind) {
        ACTIVITY.start(self.id, kind);
        self.publish();
    }

    fn finish(&self, outcome: Outcome) {
        ACTIVITY.finish(self.id, outcome);
        self.publish();
    }

    fn fail_step(&self, reason: &str) {
        ACTIVITY.fail_step(self.id, reason);
        self.publish();
    }

    fn waiting(&self, wait: Option<MemoryWait>) {
        ACTIVITY.set_waiting(self.id, wait);
        self.publish();
    }

    fn fail(&self, message: String) {
        diagnostics::log(format!("summary failed: {message}"));
        self.finish(Outcome::Failed { message });
    }

    fn publish(&self) {
        let _ = self.app.emit(EVENT_ACTIVITY, ACTIVITY.snapshot());
    }
}

impl Drop for Tracked {
    fn drop(&mut self) {
        // A no-op when the job already has its outcome.
        ACTIVITY.finish(
            self.id,
            Outcome::Failed {
                message: "stopped before the notes were written".into(),
            },
        );
        self.publish();
    }
}

/// Re-run synthesis for an already-saved note.
///
/// Refused while the note already has a job, so a second press cannot start
/// a run that races the first to rewrite the file. Otherwise it waits for
/// the heavy-work lane like any other job.
pub fn regenerate(
    app: &AppHandle,
    session_dir: &std::path::Path,
    note_path: &std::path::Path,
) -> Result<(), crate::activity::Busy> {
    let title = crate::store::journal::replay(session_dir)
        .map(|r| r.meeting.title)
        .unwrap_or_else(|_| {
            note_path
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default()
        });
    let id = ACTIVITY.begin(&note_path.display().to_string(), &title, false)?;
    let job = Tracked::new(app.clone(), id);
    let _underway = Underway::begin(session_dir, note_path);

    let _lane = ACTIVITY.lane();
    synthesize(app, &job, session_dir, note_path);
    Ok(())
}

/// Finish the notes of a meeting whose work was cut off.
///
/// Picks up where it stopped. If the full-quality pass never finished and
/// the audio is still there, it runs again first, exactly as it would have
/// after the meeting; otherwise the audio is released as the retention
/// setting says and only the notes are written.
pub fn resume(
    app: &AppHandle,
    notes_root: &std::path::Path,
    session_dir: &std::path::Path,
) -> Result<(), String> {
    let replay = crate::store::journal::replay(session_dir).map_err(|e| e.to_string())?;
    let note_path = replay
        .note_path
        .clone()
        .filter(|p| p.exists())
        .or_else(|| store::find_note(notes_root, &replay.meeting.id))
        .ok_or("this meeting's note is no longer in the notes folder")?;
    let summary = SessionSummary {
        session_id: replay.meeting.id.clone(),
        directory: session_dir.to_path_buf(),
        streams: replay.streams,
    };
    let repass = !replay.transcript_replaced
        && summary
            .streams
            .iter()
            .any(|s| s.is_usable() && s.path.exists());
    diagnostics::log(if repass {
        "resuming interrupted notes, full-quality pass first"
    } else {
        "resuming interrupted notes"
    });

    if !repass {
        release_session_audio(session_dir);
        return regenerate(app, session_dir, &note_path).map_err(|e| e.to_string());
    }

    let id = ACTIVITY
        .begin(
            &note_path.display().to_string(),
            &replay.meeting.title,
            true,
        )
        .map_err(|e| e.to_string())?;
    spawn_repass(
        app.clone(),
        Some(Tracked::new(app.clone(), id)),
        session_dir.to_path_buf(),
        note_path.clone(),
        summary,
        // Which model the meeting used is not journalled. After a restart
        // the chosen one is the best guess, and every model TRACE offers runs
        // on the same engine.
        crate::models::active_speech_model(),
        None,
        Underway::begin(session_dir, &note_path),
    );
    Ok(())
}

/// Leave an interrupted meeting's notes unwritten, as the user chose. Its
/// audio goes as the retention setting says; the journal stays, so the notes
/// can still be written from the note later.
pub fn dismiss_interrupted(session_dir: &std::path::Path) {
    if let Ok(mut journal) = Journal::open(session_dir) {
        let _ = journal.append(&JournalEvent::NotesFinished);
    }
    release_session_audio(session_dir);
}

/// Settle the audio of a meeting recovered after TRACE stopped mid-recording.
///
/// Its WAVs were never finalised, so their headers are mended now, while
/// nothing holds them, rather than leaving that to whoever opens them next.
/// Then they go as the retention setting says, like any meeting's.
pub fn finish_recovered(session_dir: &std::path::Path) {
    for source in [StreamSource::Microphone, StreamSource::System] {
        let path = session_dir.join(format!("{}.wav", source.file_stem()));
        if let Ok(crate::audio::wav::Repair::Repaired { frames }) = crate::audio::wav::repair(&path)
        {
            diagnostics::log(format!(
                "recovered {} audio: {frames} frames",
                source.file_stem()
            ));
        }
    }
    release_session_audio(session_dir);
}

/// Release the audio of an interrupted meeting that no longer needs it: its
/// full-quality pass finished before the notes were cut off.
pub fn release_unneeded_audio(interrupted: &store::Interrupted) {
    if interrupted.replay.transcript_replaced {
        release_session_audio(&interrupted.session_dir);
    }
}

/// Sessions whose notes are being worked on in this run of the app, by id.
static UNDERWAY: Mutex<Vec<std::ffi::OsString>> = Mutex::new(Vec::new());

/// Whether this session's notes are being worked on now, so an open marker
/// in its journal means work in progress rather than work cut off.
pub fn is_underway(session_dir: &std::path::Path) -> bool {
    session_dir.file_name().is_some_and(|id| {
        UNDERWAY
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .any(|u| u == id)
    })
}

/// Marks a session's notes as in progress — in its journal, and in this run
/// — until dropped.
///
/// Dropped on every way the work ends that the user is shown: written,
/// failed, put off. Only TRACE itself stopping part-way, or the machine
/// dying, leaves the journal's mark open, which is exactly the case it is
/// there to catch.
struct Underway {
    dir: PathBuf,
}

impl Underway {
    fn begin(session_dir: &std::path::Path, note_path: &std::path::Path) -> Self {
        if let Ok(mut journal) = Journal::open(session_dir) {
            let _ = journal.append(&JournalEvent::NotesStarted {
                note_path: note_path.display().to_string(),
            });
        }
        if let Some(id) = session_dir.file_name() {
            UNDERWAY
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push(id.to_owned());
        }
        Self {
            dir: session_dir.to_path_buf(),
        }
    }
}

impl Drop for Underway {
    fn drop(&mut self) {
        if let Ok(mut journal) = Journal::open(&self.dir) {
            let _ = journal.append(&JournalEvent::NotesFinished);
        }
        if let Some(id) = self.dir.file_name() {
            let mut underway = UNDERWAY.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(i) = underway.iter().position(|u| u == id) {
                underway.remove(i);
            }
        }
    }
}

/// How often notes waiting for memory look again.
const ROOM_RECHECK: Duration = Duration::from_secs(10);

/// What the note says when its notes were put off for want of memory.
const PUT_OFF: &str = "put off until there is memory for the summary model. Close some apps, then \
                       write them from this note";

/// Hold notes back until the summary model has room, or the user decides.
///
/// Called before every request of a summary — the first, which loads the
/// model, and each part after, in case the machine has filled up since.
/// What it saw is logged the first time and whenever the answer changes, so
/// a slow or stopped summary explains itself from the diagnostics. Returns
/// the reason, in words for the note, when the user puts the notes off.
fn wait_for_room(
    job: &Tracked,
    model: &str,
    when: &str,
    said: &mut Option<bool>,
) -> Result<(), String> {
    let mut since: Option<u64> = None;
    loop {
        match ACTIVITY.choice(job.id) {
            Some(WaitChoice::Anyway) => {
                if since.is_some() {
                    diagnostics::log("memory check overridden: writing notes anyway");
                    job.waiting(None);
                }
                return Ok(());
            }
            Some(WaitChoice::Later) => {
                diagnostics::log("notes put off while waiting for memory");
                job.waiting(None);
                return Err(PUT_OFF.into());
            }
            None => {}
        }

        let check = crate::memory::check(model);
        if *said != Some(check.fits()) {
            diagnostics::log(check.describe(when));
            *said = Some(check.fits());
        }
        if check.fits() {
            if since.is_some() {
                job.waiting(None);
            }
            return Ok(());
        }

        let started = *since.get_or_insert_with(crate::activity::now_ms);
        job.waiting(Some(MemoryWait {
            needed_bytes: check.need.bytes,
            ram_available_bytes: check.machine.ram_available,
            gpu_free_bytes: check.machine.gpu.as_ref().map(crate::memory::Gpu::free),
            since: started,
        }));

        // In short sleeps, so a choice is acted on at once rather than at
        // the next look.
        let until = std::time::Instant::now() + ROOM_RECHECK;
        while std::time::Instant::now() < until && ACTIVITY.choice(job.id).is_none() {
            std::thread::sleep(Duration::from_millis(250));
        }
    }
}

/// Generate structured notes from the finished transcript.
///
/// Best-effort and non-fatal. If no model is installed, or Ollama is not
/// running, or the model fails, the note keeps its transcript and notes and
/// simply has no generated sections. A missing summary is a disappointment;
/// a lost meeting is not, and this must never risk the second to attempt the
/// first.
fn synthesize(
    app: &AppHandle,
    job: &Tracked,
    session_dir: &std::path::Path,
    note_path: &std::path::Path,
) {
    // Every early return says why. Returning quietly here once made a closed
    // Ollama indistinguishable from a feature that did not exist: the note
    // simply never gained a summary, and nothing on screen said so.
    let fail = |message: String| job.fail(message);

    // Shown as started before Ollama is asked anything, so the wait for a
    // cold model to load is visibly this step rather than a stall.
    job.start(StepKind::Notes);

    let readiness = crate::synthesis::ollama::Readiness::check();
    let provider = match readiness {
        crate::synthesis::ollama::Readiness::Ready { model } => {
            crate::synthesis::ollama::OllamaProvider::new(model)
        }
        unready => {
            fail(unready.guidance().unwrap_or_default());
            return;
        }
    };
    // Keeps the model from being unloaded under this summary by a meeting
    // ending elsewhere, and unloads it after if nothing else needs it.
    let _model_hold = crate::synthesis::ollama::ModelHold::in_use(provider.model());
    diagnostics::log(format!("summarising with {}", provider.model()));
    let started = std::time::Instant::now();

    let replay = match crate::store::journal::replay(session_dir) {
        Ok(r) => r,
        Err(e) => {
            fail(format!("the meeting record could not be read: {e}"));
            return;
        }
    };

    // What the user has said about the meeting since — the kind of meeting,
    // who was on the other end — is in the note, not the journal. Without
    // this, adding context and regenerating would change nothing.
    let mut meeting = replay.meeting;
    if let Ok(text) = std::fs::read_to_string(note_path) {
        store::context::apply_edits(&mut meeting, &text);
    }

    let mut said = None;
    let result = crate::synthesis::generate(&provider, &meeting, |progress| {
        job.start(if progress.combining {
            StepKind::Combine
        } else {
            StepKind::Part {
                index: progress.window,
                total: progress.total,
            }
        });
        let when = if progress.combining {
            "before the final pass".to_string()
        } else if progress.window == 1 {
            "before writing notes".to_string()
        } else {
            format!("before part {} of {}", progress.window, progress.total)
        };
        wait_for_room(job, provider.model(), &when, &mut said)
            .map_err(crate::synthesis::SynthesisError::Stopped)
    });

    let (generated, report) = match result {
        Ok(pair) => pair,
        // The user's own choice, logged as such; not a failure.
        Err(crate::synthesis::SynthesisError::Stopped(message)) => {
            job.finish(Outcome::Failed { message });
            return;
        }
        Err(e) => {
            fail(e.to_string());
            return;
        }
    };

    diagnostics::log(format!(
        "summary written in {:.0}s: {} key points, {} decisions, {} action items, {} discarded",
        started.elapsed().as_secs_f64(),
        generated.key_points.len(),
        generated.decisions.len(),
        generated.action_items.len(),
        report.total_dropped()
    ));

    // Journal before rewriting, so a crash between the two replays to the
    // generated version rather than losing it.
    if let Ok(mut journal) = Journal::open(session_dir) {
        let _ = journal.append(&JournalEvent::Generated(Box::new(generated)));
    }

    let written = crate::store::journal::replay(session_dir)
        .map_err(|e| e.to_string())
        .and_then(|replay| {
            store::rewrite_note(note_path, &replay.meeting).map_err(|e| e.to_string())
        });
    if let Err(e) = written {
        fail(format!(
            "the notes were written but the file could not be updated: {e}"
        ));
        return;
    }

    let _ = app.emit(
        EVENT_NOTES_GENERATED,
        serde_json::json!({ "notePath": note_path.display().to_string() }),
    );
    // Surfaced rather than logged: the user should be told that items were
    // discarded, not quietly shown fewer.
    job.finish(Outcome::Generated {
        dropped: report.total_dropped(),
        fabricated: report.fabricated,
        uncited: report.uncited,
    });
}

/// Reduce the session's WAVs to a loudness envelope and journal it.
fn record_signal(session_dir: &std::path::Path) {
    let paths = [
        session_dir.join(format!("{}.wav", StreamSource::Microphone.file_stem())),
        session_dir.join(format!("{}.wav", StreamSource::System.file_stem())),
    ];
    let refs: Vec<&std::path::Path> = paths.iter().map(PathBuf::as_path).collect();
    let Some(levels) = crate::audio::envelope::of_wavs(&refs) else {
        return;
    };
    if let Ok(mut journal) = Journal::open(session_dir) {
        let _ = journal.append(&JournalEvent::Signal { levels });
    }
}

/// The model to synthesise with, if one can be used right now.
fn default_provider() -> Option<crate::synthesis::ollama::OllamaProvider> {
    use crate::synthesis::ollama::{OllamaProvider, Readiness};

    match Readiness::check() {
        Readiness::Ready { model } => Some(OllamaProvider::new(model)),
        _ => None,
    }
}

/// Discard a session's audio unless the user asked to keep it.
///
/// Every path that finishes with a session goes through here — success,
/// engine failure, and empty transcript alike — so "keep audio" cannot hold
/// on the happy path and be quietly ignored on a failing one, which is
/// exactly the case it exists to help debug.
fn release_session_audio(session_dir: &std::path::Path) {
    use crate::settings::AudioRetention;

    match crate::settings::load().audio_retention() {
        AudioRetention::KeepAll => {}
        AudioRetention::Delete => {
            let _ = store::discard_session_audio(session_dir);
        }
        // This meeting is the newest, so it survives; older ones make room.
        AudioRetention::KeepLatest { count } => {
            if let Some(root) = session_dir.parent() {
                store::prune_session_audio(root, count as usize);
            }
        }
    }
}

/// Re-transcribe the finished recording at full quality, then write notes,
/// in the background.
///
/// The live transcript is produced from 4-7 second chunks, which trades the
/// model's surrounding context for latency. This pass re-runs the same audio
/// with the offline 20/30 second config, which is measurably more accurate on
/// exactly the short, ambiguous words the live pass gets wrong.
///
/// A failed re-pass is not a failed meeting. The note on disk and the journal
/// both still hold the live transcript, so notes are written from that — the
/// same notes "Generate summary" would produce from the same journal, without
/// making the user find the button. The step is shown as failed, with why.
#[allow(clippy::too_many_arguments)]
fn spawn_repass(
    app: AppHandle,
    job: Option<Tracked>,
    session_dir: PathBuf,
    note_path: PathBuf,
    summary: SessionSummary,
    speech: &'static crate::models::ModelSpec,
    model_hold: Option<crate::synthesis::ollama::ModelHold>,
    underway: Underway,
) {
    std::thread::Builder::new()
        .name("trace-repass".into())
        .spawn(move || {
            // Dropped last, after the audio: the journal says the work is
            // done only once all of it is.
            let _underway = underway;
            // Held until this thread ends, whichever way it ends, so the
            // summary model stays loaded through the queue and the re-pass,
            // and goes as soon as there is nothing left to summarise.
            let _model_hold = model_hold;

            // One heavy job at a time: a meeting that ends while another's
            // notes are being written waits here, shown as queued.
            let _lane = ACTIVITY.lane();
            if let Some(job) = &job {
                job.start(StepKind::Transcript);
            }

            // Before anything can delete the audio. Journalled, so every
            // rewrite from here — the re-pass, the summary, a regeneration
            // next year — carries it without reading a WAV again.
            record_signal(&session_dir);

            if let Err(reason) = repass(&app, &session_dir, &note_path, &summary, speech) {
                diagnostics::log(format!(
                    "re-pass failed, summarising the live transcript: {reason}"
                ));
                if let Some(job) = &job {
                    job.fail_step(&reason);
                }
            }

            // Synthesis runs on whatever the journal now replays to: the
            // re-transcribed text when the pass worked, which is why it waits
            // for it, and the live transcript when it did not. Rougher notes
            // beat none, and are what regenerating would give anyway.
            match &job {
                Some(job) => synthesize(&app, job, &session_dir, &note_path),
                None => diagnostics::log("summary skipped: the note already had a job"),
            }

            // Audio is expendable now; the journal is not. It is the only
            // structured record left once the note is written, and is what
            // makes regenerating notes possible later. Every path reaches here,
            // so "keep audio" holds on exactly the failures it exists to debug.
            release_session_audio(&session_dir);
        })
        .ok();
}

/// The full-quality pass itself. On success the journal and note carry the
/// new transcript; on failure neither has been touched, and the reason says
/// why in words fit for the note.
fn repass(
    app: &AppHandle,
    session_dir: &std::path::Path,
    note_path: &std::path::Path,
    summary: &SessionSummary,
    speech: &'static crate::models::ModelSpec,
) -> Result<(), String> {
    // Loading a second engine only after the live one has been dropped
    // keeps peak memory to one model rather than two.
    let started = std::time::Instant::now();
    let mut engine = Transcriber::load_model(speech)
        .map_err(|e| format!("the transcription model did not load ({e})"))?;

    let mut segments = Vec::new();
    for outcome in &summary.streams {
        if !outcome.is_usable() {
            continue;
        }
        // Abandon rather than half-replace: a transcript missing one whole
        // stream would be worse than the live one it would overwrite. Nothing
        // is journalled until every stream is done, so returning here leaves
        // the journal replaying to the complete live transcript — which is
        // why it is kept. Deleting it, as this once did, lost the one record
        // regenerating notes could start from.
        let mut produced = engine
            .transcribe_stream(&outcome.path, outcome.source, outcome.start_offset_ms)
            .map_err(|e| format!("the full-quality pass failed on {:?} ({e})", outcome.source))?;
        segments.append(&mut produced);
    }

    // Gone before anything else is loaded: the summary model comes next, and
    // the two need never be in memory together.
    drop(engine);

    if segments.is_empty() {
        return Err("the full-quality pass found no speech in the recording".into());
    }

    let usable = || summary.streams.iter().filter(|s| s.is_usable());
    diagnostics::log(format!(
        "full-quality pass done in {:.0}s: {} streams, {:.0}s of audio, {} segments",
        started.elapsed().as_secs_f64(),
        usable().count(),
        usable().map(StreamOutcome::duration_secs).sum::<f64>(),
        segments.len()
    ));

    let segments = crate::transcribe::merge(segments);

    // Journal before rewriting, so a crash between the two leaves a journal
    // that replays to the better transcript.
    if let Ok(mut journal) = Journal::open(session_dir) {
        let _ = journal.append(&JournalEvent::TranscriptReplaced {
            segments: segments.clone(),
        });
    }

    if let Ok(replay) = crate::store::journal::replay(session_dir) {
        if store::rewrite_note(note_path, &replay.meeting).is_ok() {
            let _ = app.emit(
                EVENT_TRANSCRIPT_UPDATED,
                serde_json::json!({
                    "notePath": note_path.display().to_string(),
                    "segments": segments.len(),
                }),
            );
        }
    }
    Ok(())
}

/// Forward captured audio to the transcriber, and its output to disk and UI.
#[allow(clippy::too_many_arguments)]
fn spawn_pump(
    app: AppHandle,
    tap_rx: crossbeam_channel::Receiver<CapturedAudio>,
    live: Option<Arc<LiveTranscriber>>,
    journal: Arc<Mutex<Journal>>,
    segments: Arc<Mutex<Vec<Segment>>>,
    stop: Arc<AtomicBool>,
) -> JoinHandle<()> {
    std::thread::Builder::new()
        .name("trace-pump".into())
        .spawn(move || {
            loop {
                // Drain audio into the transcriber. When no engine is loaded
                // the blocks are discarded, so the channel cannot back up and
                // stall capture.
                let mut got_audio = false;
                while let Ok(block) = tap_rx.try_recv() {
                    got_audio = true;
                    if let Some(live) = &live {
                        live.submit(AudioTap {
                            source: block.source,
                            sample_rate: block.sample_rate,
                            samples: block.samples,
                            leading_silence_frames: block.leading_silence_frames,
                            start_offset_ms: block.start_offset_ms,
                        });
                    }
                }

                if let Some(live) = &live {
                    for event in live.poll() {
                        match event {
                            LiveEvent::Segment(segment) => {
                                // Durable first, visible second.
                                if let Ok(mut journal) = journal.lock() {
                                    let _ = journal.append(&JournalEvent::Segment(segment.clone()));
                                }
                                if let Ok(mut segments) = segments.lock() {
                                    segments.push(segment.clone());
                                }
                                let _ = app.emit(EVENT_SEGMENT, &segment);
                            }
                            LiveEvent::Error { source, message } => {
                                diagnostics::log(format!(
                                    "live transcription error on {source:?}: {message}"
                                ));
                                let _ = app.emit(
                                    EVENT_CAPTURE_ERROR,
                                    serde_json::json!({
                                        "source": source,
                                        "message": message,
                                    }),
                                );
                            }
                        }
                    }
                }

                if stop.load(Ordering::Relaxed) && !got_audio {
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        })
        .expect("failed to spawn pump thread")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_manager_has_no_active_meeting() {
        let m = CaptureManager::default();
        assert!(!m.is_active());
        assert!(m.status().is_none());
    }

    #[test]
    fn operations_on_no_meeting_error_rather_than_panic() {
        let m = CaptureManager::default();
        assert!(matches!(
            m.update_notes("x".into()),
            Err(ManagerError::NotActive)
        ));
        assert!(matches!(m.notes(), Err(ManagerError::NotActive)));
        // `stop` itself needs an AppHandle; this covers the same guard.
        assert!(matches!(m.take_active(), Err(ManagerError::NotActive)));
        assert!(matches!(
            m.set_title("x".into()),
            Err(ManagerError::NotActive)
        ));
    }

    #[test]
    fn the_notes_root_can_be_overridden() {
        let m = CaptureManager::default();
        let custom = PathBuf::from("/tmp/trace-test-root");
        m.set_notes_root(custom.clone());
        assert_eq!(m.notes_root().unwrap(), custom);
        assert_eq!(
            m.sessions_root().unwrap(),
            custom.join(".sessions"),
            "a test's sessions escaped its sandbox"
        );
    }
}
