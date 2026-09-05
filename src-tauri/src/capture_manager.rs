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

use crate::audio::session::{CaptureSession, SessionSummary};
use crate::audio::{CapturedAudio, StreamSource};
use crate::meeting::Meeting;
use crate::store::journal::{Journal, JournalEvent};
use crate::store::{self, paths};
use crate::transcribe::live::{AudioTap, LiveEvent, LiveTranscriber};
use crate::transcribe::{Segment, Transcriber};

/// Event names the frontend subscribes to.
pub const EVENT_SEGMENT: &str = "trace://segment";
pub const EVENT_CAPTURE_ERROR: &str = "trace://capture-error";

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
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct StreamLevel {
    pub source: StreamSource,
    pub level: f32,
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
        if let Some(root) = self.notes_root.lock().ok().and_then(|g| g.clone()) {
            return Ok(root);
        }
        if let Some(env) = std::env::var_os("TRACE_NOTES_ROOT") {
            return Ok(PathBuf::from(env));
        }
        paths::default_notes_root()
    }

    pub fn set_notes_root(&self, root: PathBuf) {
        if let Ok(mut guard) = self.notes_root.lock() {
            *guard = Some(root);
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

        let notes_root = self.notes_root()?;
        let now = chrono::Local::now();
        let session_id = format!("sess-{}", now.timestamp_millis());
        let dir = paths::session_dir(&notes_root, &session_id);

        let mut journal = Journal::open(&dir)?;
        journal.append(&JournalEvent::SessionStarted {
            id: session_id.clone(),
            title: title.clone(),
            date: now.format("%Y-%m-%d").to_string(),
            started_at: now.to_rfc3339(),
        })?;
        let journal = Arc::new(Mutex::new(journal));

        // Load the engine before capture starts. It takes about a second, and
        // doing it afterwards would miss the opening of the meeting.
        let live = Transcriber::load()
            .ok()
            .map(LiveTranscriber::start)
            .map(Arc::new);
        let transcribing = live.is_some();

        let (tap_tx, tap_rx) = crossbeam_channel::bounded::<CapturedAudio>(4000);
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
        });

        Ok(status)
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
        })
    }

    /// Persist the user's notes.
    ///
    /// Journalled as a whole snapshot on every call, so the debounce lives in
    /// the UI where it belongs rather than risking a lost final edit here.
    pub fn update_notes(&self, text: String) -> Result<(), ManagerError> {
        let guard = self.active.lock().map_err(|_| ManagerError::NotActive)?;
        let active = guard.as_ref().ok_or(ManagerError::NotActive)?;

        if let Ok(mut journal) = active.journal.lock() {
            journal.append(&JournalEvent::Notes { text })?;
        }
        Ok(())
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

    /// Stop recording, finalise the transcript, and write the note.
    pub fn stop(&self) -> Result<FinishedMeeting, ManagerError> {
        let mut guard = self.active.lock().map_err(|_| ManagerError::NotActive)?;
        let active = guard.take().ok_or(ManagerError::NotActive)?;

        // Stop capture first so the WAVs are finalised and the tap closes,
        // which lets the pump drain and exit on its own.
        let summary = active.capture.stop();

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

        let notes_root = self.notes_root()?;
        let note_path = store::write_note(&notes_root, &meeting)?;

        // Only now that the note is on disk is the journal expendable.
        let _ = store::discard_session(&active.dir);

        Ok(FinishedMeeting {
            meeting,
            note_path,
            summary,
        })
    }
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
        assert!(matches!(m.stop(), Err(ManagerError::NotActive)));
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
    }
}
