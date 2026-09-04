//! M3 verification harness: live transcription during capture.
//!
//! ```text
//! cargo run --release --bin live_spike -- 30 "Microphone (3- Arctis Nova 7)"
//! ```
//!
//! Prints segments as they are produced, not at the end. The point is to see
//! the transcript arrive *while* audio is still being captured.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use trace_lib::audio::session::CaptureSession;
use trace_lib::models::{is_installed, PARAKEET_V3_INT8};
use trace_lib::transcribe::live::{LiveEvent, LiveTranscriber};
use trace_lib::transcribe::Transcriber;

fn main() {
    let seconds: u64 = std::env::args()
        .nth(1)
        .and_then(|a| a.parse().ok())
        .unwrap_or(30);
    let mic_device = std::env::args().nth(2);

    if !is_installed(&PARAKEET_V3_INT8) {
        eprintln!("model not installed — run transcribe_spike once first");
        std::process::exit(1);
    }

    // Load before capture starts. Loading takes about a second, and doing it
    // after the first utterance would mean missing it.
    print!("loading engine... ");
    use std::io::Write;
    std::io::stdout().flush().ok();
    let load = Instant::now();
    let engine = match Transcriber::load() {
        Ok(e) => e,
        Err(e) => {
            eprintln!("FAILED: {e}");
            std::process::exit(1);
        }
    };
    println!("{:.1}s", load.elapsed().as_secs_f64());

    let live = LiveTranscriber::start(engine);
    // Matched to the worker queue: the forwarding loop below runs every 50ms,
    // so this must absorb everything two streams produce in between, plus
    // slack for any hitch in the loop itself.
    let (tap_tx, tap_rx) = crossbeam_channel::bounded(4000);

    let session_id = format!(
        "live-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    );
    let dir: PathBuf = std::env::temp_dir().join("trace-spikes").join(&session_id);

    println!("\nTRACE / LIVE CAPTURE");
    println!("  {}", dir.display());
    if let Some(d) = &mic_device {
        println!("  mic  {d}");
    }
    println!("  {seconds}s — talk, and play something with speech\n");

    let session = CaptureSession::start(&session_id, &dir, mic_device, Some(tap_tx));

    let deadline = Instant::now() + Duration::from_secs(seconds);
    let started = Instant::now();

    while Instant::now() < deadline {
        // Forward captured audio to the transcription worker.
        while let Ok(block) = tap_rx.try_recv() {
            live.submit(trace_lib::transcribe::live::AudioTap {
                source: block.source,
                sample_rate: block.sample_rate,
                samples: block.samples,
                leading_silence_frames: block.leading_silence_frames,
                start_offset_ms: block.start_offset_ms,
            });
        }

        // Print whatever the worker has finished.
        for event in live.poll() {
            print_event(&event, started);
        }

        std::thread::sleep(Duration::from_millis(50));
    }

    println!("\n[ stopping ]\n");
    let summary = session.stop();

    // Drain any audio captured after the last forward.
    while let Ok(block) = tap_rx.try_recv() {
        live.submit(trace_lib::transcribe::live::AudioTap {
            source: block.source,
            sample_rate: block.sample_rate,
            samples: block.samples,
            leading_silence_frames: block.leading_silence_frames,
            start_offset_ms: block.start_offset_ms,
        });
    }

    let dropped = live.dropped_audio();
    for event in live.stop() {
        print_event(&event, started);
    }

    println!("\nRESULT");
    for s in &summary.streams {
        println!(
            "  {:?}: {:.1}s captured ({:.1}s real audio)",
            s.source,
            s.duration_secs(),
            s.active_secs()
        );
    }
    if dropped {
        println!("\n  NOTE: the worker fell behind and some audio was skipped");
        println!("        for the LIVE transcript only. The WAVs are complete.");
    }
    println!("\n  full-quality pass:");
    println!(
        "    cargo run --release --bin transcribe_spike -- \"{}\"",
        dir.display()
    );
}

fn print_event(event: &LiveEvent, started: Instant) {
    match event {
        LiveEvent::Segment(s) => {
            // Elapsed-at-print vs the segment's own time shows the lag.
            let lag = started.elapsed().as_millis() as i64 - s.end_ms as i64;
            println!(
                "  [{:>5}ms lag]  {:<5}  {}",
                lag.max(0),
                s.speaker_label(),
                s.text
            );
        }
        LiveEvent::Error { source, message } => {
            println!("  [{source:?}] ERROR: {message}");
        }
    }
}
