//! M1 verification harness.
//!
//! Records both streams for N seconds and reports what each one actually did.
//! Exists so the capture layer can be proven against a real Zoom/Meet call
//! without waiting on any UI wiring.
//!
//! ```text
//! cargo run --example record_spike -- 30
//! ```
//!
//! This is a spike tool, not a product surface. It should be deleted once the
//! Tauri commands and capture UI exist.

use std::path::PathBuf;
use std::time::Duration;

use trace_lib::audio::session::CaptureSession;
use trace_lib::audio::{list_input_devices, list_output_devices};

fn main() {
    let arg = std::env::args().nth(1).unwrap_or_default();

    if arg == "--list" {
        list_devices();
        return;
    }

    let seconds: u64 = arg.parse().unwrap_or(15);
    // Optional second arg names the microphone, so the default virtual device
    // can be bypassed without changing a system-wide Windows setting.
    let mic_device = std::env::args().nth(2);

    let session_id = format!(
        "spike-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    );

    let dir: PathBuf = std::env::temp_dir().join("trace-spikes").join(&session_id);

    println!("TRACE / CAPTURE SPIKE");
    println!("  session   {session_id}");
    println!("  directory {}", dir.display());
    println!("  duration  {seconds}s");
    println!();
    println!("Play audio through your speakers AND speak into the mic.");
    println!("recording...");

    if let Some(d) = &mic_device {
        println!("  mic device {d}");
    }

    let session = CaptureSession::start(&session_id, &dir, mic_device, None);

    // Print levels once a second, so a dead stream is obvious while recording
    // rather than only in the summary.
    for remaining in (1..=seconds).rev() {
        std::thread::sleep(Duration::from_secs(1));
        let levels: Vec<String> = session
            .levels()
            .iter()
            .map(|(src, lvl)| format!("{:?} {}", src, meter(*lvl)))
            .collect();
        println!("  {remaining:>3}s  {}", levels.join("   "));
    }

    let summary = session.stop();

    println!();
    println!("RESULT");
    for stream in &summary.streams {
        println!("  {:?}", stream.source);
        println!("      device        {}", stream.device_name);
        match &stream.error {
            Some(err) => println!("      ERROR         {err}"),
            None => {
                println!("      file          {}", stream.path.display());
                println!("      sample rate   {} Hz", stream.sample_rate);
                println!("      frames        {}", stream.frames_captured);
                println!(
                    "      duration      {:.2}s  ({:.2}s of real audio)",
                    stream.duration_secs(),
                    stream.active_secs()
                );
                println!("      start offset  {} ms", stream.start_offset_ms);
                if stream.chunks_dropped > 0 {
                    println!(
                        "      LOST AUDIO    {} chunks dropped",
                        stream.chunks_dropped
                    );
                }
                if stream.silence_padded_frames > 0 {
                    println!(
                        "      gap padding   {:.2}s of silence filled",
                        stream.silence_padded_frames as f64 / stream.sample_rate.max(1) as f64
                    );
                }
                if stream.stream_errors > 0 {
                    println!(
                        "      device warns  {} (no audio necessarily lost)",
                        stream.stream_errors
                    );
                }
                if stream.frames_captured == 0 {
                    println!("      WARNING       opened but captured silence");
                }
            }
        }
    }

    println!();
    if summary.captured_anything() {
        println!("Now check the result:");
        println!("  cargo run --example wav_check -- \"{}\"", dir.display());
    } else {
        println!("NOTHING CAPTURED — both streams failed.");
        std::process::exit(1);
    }
}

fn meter(level: f32) -> String {
    const CELLS: usize = 16;
    let filled = (level.clamp(0.0, 1.0) * CELLS as f32).round() as usize;
    format!(
        "{}{} {:>5.3}",
        "#".repeat(filled),
        "-".repeat(CELLS - filled),
        level
    )
}

/// Print every capture and playback endpoint, marking the defaults.
///
/// The default is not always the right one. A virtual device that emits
/// digital silence still "records successfully", so being able to see which
/// endpoint was chosen is the difference between a diagnosable problem and a
/// mysteriously empty meeting.
fn list_devices() {
    println!("INPUT DEVICES (microphone)");
    for d in list_input_devices() {
        println!("  {} {}", if d.is_default { "*" } else { " " }, d.name);
    }
    println!();
    println!("OUTPUT DEVICES (loopback captures from the default)");
    for d in list_output_devices() {
        println!("  {} {}", if d.is_default { "*" } else { " " }, d.name);
    }
    println!();
    println!("* = system default");
}
