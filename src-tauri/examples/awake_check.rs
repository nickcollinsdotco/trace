//! Does TRACE's keep-awake request reach Windows?
//!
//! Asks for the system's execution state before, while and after holding
//! `awake::hold()`. While held, `ES_SYSTEM_REQUIRED` (0x1) should be set;
//! after, it should be gone unless something else on the machine asks too.
//!
//! The state is the whole system's, so a "before" that already reads 0x1 —
//! a browser playing media, a call — proves nothing either way. Then, from
//! an elevated prompt during a meeting, `powercfg /requests` should list
//! trace.exe under SYSTEM.
//!
//!   cargo run --example awake_check

#[cfg(windows)]
fn state() -> u32 {
    use windows::Win32::System::Power::{CallNtPowerInformation, SystemExecutionState};
    let mut out: u32 = 0;
    // SAFETY: no input; the output buffer is a u32, as this level returns.
    let status = unsafe {
        CallNtPowerInformation(
            SystemExecutionState,
            None,
            0,
            Some(std::ptr::addr_of_mut!(out).cast()),
            std::mem::size_of::<u32>() as u32,
        )
    };
    assert!(status.is_ok(), "CallNtPowerInformation failed: {status:?}");
    out
}

#[cfg(windows)]
fn main() {
    let show = |when: &str| println!("{when:<8} 0x{:08x}", state());
    show("before");
    let guard = trace_lib::awake::hold();
    std::thread::sleep(std::time::Duration::from_millis(200));
    show("held");
    drop(guard);
    std::thread::sleep(std::time::Duration::from_millis(200));
    show("after");
}

#[cfg(not(windows))]
fn main() {}
