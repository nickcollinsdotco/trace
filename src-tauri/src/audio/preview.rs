//! The mic check: a live level from the microphone before a meeting starts.
//!
//! Opening the microphone lights Windows' "in use" indicator, and a
//! local-first tool that listened while nobody was recording would undercut
//! the one promise it makes. So the preview runs only when asked for, from the
//! Record screen, and stops itself the moment nobody is watching: the screen
//! polls the level, and a preview that has not been polled for a couple of
//! seconds — the screen closed, the window hidden — shuts the device.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::{AudioError, StopSignal, StreamStats};

/// Unpolled for this long, the preview assumes nobody is looking.
const DEADMAN: Duration = Duration::from_secs(2);

struct Running {
    stats: Arc<StreamStats>,
    stop: StopSignal,
    last_poll: Arc<Mutex<Instant>>,
}

static PREVIEW: Mutex<Option<Running>> = Mutex::new(None);

/// Start listening, replacing any preview already running.
pub fn start(device: Option<String>) -> Result<(), AudioError> {
    stop();

    let stats = Arc::new(StreamStats::default());
    let stop_signal = StopSignal::new();
    let last_poll = Arc::new(Mutex::new(Instant::now()));

    // The device opens on its own thread, and whether it opened is reported
    // back before this returns, so the screen can say so instead of showing
    // a flat line that looks like silence.
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();
    {
        let stats = Arc::clone(&stats);
        let stop_signal = stop_signal.clone();
        let last_poll = Arc::clone(&last_poll);
        std::thread::Builder::new()
            .name("trace-mic-preview".into())
            .spawn(move || {
                let watchdog = {
                    let stop_signal = stop_signal.clone();
                    std::thread::spawn(move || {
                        while !stop_signal.is_stopped() {
                            std::thread::sleep(Duration::from_millis(250));
                            let idle = last_poll.lock().map(|t| t.elapsed()).unwrap_or(DEADMAN);
                            if idle >= DEADMAN {
                                stop_signal.stop();
                            }
                        }
                    })
                };
                let started = ready_tx.clone();
                let result =
                    super::mic::run_preview(stats, stop_signal.clone(), device, move || {
                        let _ = started.send(Ok(()));
                    });
                stop_signal.stop();
                let _ = watchdog.join();
                if let Err(e) = result {
                    let _ = ready_tx.send(Err(e.to_string()));
                }
            })
            .map_err(|e| AudioError::Backend(e.to_string()))?;
    }
    match ready_rx.recv_timeout(Duration::from_secs(3)) {
        Ok(Ok(())) => {}
        Ok(Err(reason)) => return Err(AudioError::Backend(reason)),
        Err(_) => {
            stop_signal.stop();
            return Err(AudioError::Backend("the microphone did not start".into()));
        }
    }

    if let Ok(mut slot) = PREVIEW.lock() {
        *slot = Some(Running {
            stats,
            stop: stop_signal,
            last_poll,
        });
    }
    Ok(())
}

/// Stop listening. Harmless when nothing is running.
pub fn stop() {
    if let Ok(mut slot) = PREVIEW.lock() {
        if let Some(running) = slot.take() {
            running.stop.stop();
        }
    }
}

/// The current level, 0..1, or None when no preview is running.
///
/// Reading it is what keeps the preview alive.
pub fn level() -> Option<f32> {
    let slot = PREVIEW.lock().ok()?;
    let running = slot.as_ref()?;
    if running.stop.is_stopped() {
        return None;
    }
    if let Ok(mut t) = running.last_poll.lock() {
        *t = Instant::now();
    }
    Some(running.stats.level())
}
