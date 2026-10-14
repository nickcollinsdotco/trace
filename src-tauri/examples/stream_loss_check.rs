//! Does a stream that dies mid-meeting say so while the meeting goes on?
//!
//! Records into a temporary folder on the real devices, with the microphone
//! asked for by a name no device has, so that stream ends at once on the same
//! path a full disk takes: the backend returns an error before being stopped.
//! System audio should keep recording. Prints what the recording screen
//! would be told, then what the meeting ended with.
//!
//! A real full disk needs a small volume to fill — a USB stick, or a VHD from
//! an elevated prompt — with `%LOCALAPPDATA%\TRACE\sessions` pointed at it.
//!
//!   cargo run --example stream_loss_check

use std::time::Duration;

use trace_lib::audio::session::CaptureSession;

fn main() {
    trace_lib::diagnostics::terminal_only();
    let dir = std::env::temp_dir().join(format!("trace-stream-loss-{}", std::process::id()));

    let session =
        CaptureSession::start("loss-check", &dir, Some("no such microphone".into()), None);
    std::thread::sleep(Duration::from_secs(3));

    println!("while recording:");
    for (source, end) in session.lost() {
        println!("  lost {source:?} at {} ms: {}", end.at_ms, end.reason);
    }
    let rate = session.bytes_per_second();
    println!(
        "  writing {rate} bytes/s, {:.0} MB an hour",
        rate as f64 * 3600.0 / 1e6
    );
    match trace_lib::system::free_space(&dir) {
        Some(free) => println!(
            "  {:.1} GB free, about {} hours of recording",
            free as f64 / 1e9,
            free / rate.max(1) / 3600
        ),
        None => println!("  free space unreadable"),
    }

    let summary = session.stop();
    println!("after stopping:");
    for s in &summary.streams {
        println!(
            "  {:?}: {:.1}s on \"{}\", error: {}",
            s.source,
            s.duration_secs(),
            s.device_name,
            s.error.as_deref().unwrap_or("none")
        );
    }
    let _ = std::fs::remove_dir_all(&dir);
}
