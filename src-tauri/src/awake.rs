//! Keeping Windows from sleeping while TRACE has work it cannot resume.
//!
//! A call app usually keeps the machine awake; an in-person meeting with
//! only TRACE running did not, least of all on battery, and an idle sleep
//! mid-recording ended the meeting wherever it was. Writing notes is the
//! same: minutes of work with nobody at the keyboard.
//!
//! Only idle sleep. Closing the lid or choosing Sleep still sleeps, as it
//! should: that is someone deciding to.

/// Held while the machine must stay awake; dropping it lets it sleep again.
pub struct Awake {
    // Dropped with the guard, which is what ends the thread's wait.
    _release: std::sync::mpsc::Sender<()>,
}

/// Ask Windows not to idle-sleep until the guard is dropped.
///
/// On a thread of its own, because the request belongs to the thread that
/// made it and ends when that thread does. The callers' threads are pooled
/// or short-lived, so neither would hold it for as long as it is needed.
pub fn hold() -> Awake {
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    let _ = std::thread::Builder::new()
        .name("trace-awake".into())
        .spawn(move || {
            request(true);
            // Returns once the guard's sender is dropped.
            let _ = rx.recv();
            request(false);
        });
    Awake { _release: tx }
}

#[cfg(windows)]
fn request(awake: bool) {
    use windows::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED,
    };
    let flags = if awake {
        ES_CONTINUOUS | ES_SYSTEM_REQUIRED
    } else {
        ES_CONTINUOUS
    };
    // SAFETY: takes flags only, and affects nothing but this thread's request.
    unsafe {
        SetThreadExecutionState(flags);
    }
}

#[cfg(not(windows))]
fn request(_awake: bool) {}
