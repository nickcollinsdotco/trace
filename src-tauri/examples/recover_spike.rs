//! M4 verification harness: crash recovery.
//!
//! ```text
//! recover_spike record 60        # capture + journal; kill this process
//! recover_spike scan             # find and recover interrupted sessions
//! recover_spike finalize         # recover, write Markdown, discard session
//! ```
//!
//! `record` deliberately never writes `session_ended`, so killing it with
//! `taskkill /F` reproduces exactly what a crash leaves behind.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use trace_lib::audio::session::CaptureSession;
use trace_lib::models::{is_installed, PARAKEET_V3_INT8};
use trace_lib::store::journal::{Journal, JournalEvent};
use trace_lib::store::{self, paths};
use trace_lib::transcribe::live::{LiveEvent, LiveTranscriber};
use trace_lib::transcribe::Transcriber;

fn main() {
    let mode = std::env::args().nth(1).unwrap_or_else(|| "scan".into());
    let notes_root = notes_root();

    match mode.as_str() {
        "record" => {
            let secs: u64 = std::env::args()
                .nth(2)
                .and_then(|a| a.parse().ok())
                .unwrap_or(60);
            record(&notes_root, secs, std::env::args().nth(3));
        }
        "scan" => scan(&notes_root, false),
        "finalize" => scan(&notes_root, true),
        other => {
            eprintln!("unknown mode '{other}' — use record | scan | finalize");
            std::process::exit(2);
        }
    }
}

/// Notes root, overridable so the spike does not scribble in real notes.
fn notes_root() -> PathBuf {
    match std::env::var_os("TRACE_NOTES_ROOT") {
        Some(v) => PathBuf::from(v),
        None => paths::default_notes_root().expect("no documents directory"),
    }
}

fn record(notes_root: &std::path::Path, secs: u64, mic_device: Option<String>) {
    let session_id = format!(
        "sess-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    );
    let dir = paths::session_dir(notes_root, &session_id);

    let mut journal = Journal::open(&dir).expect("open journal");
    let now = chrono::Local::now();
    journal
        .append(&JournalEvent::SessionStarted {
            id: session_id.clone(),
            title: "Recovery Test".into(),
            date: now.format("%Y-%m-%d").to_string(),
            started_at: now.to_rfc3339(),
        })
        .expect("journal start");

    println!("TRACE / RECORDING");
    println!("  session  {session_id}");
    println!("  journal  {}", journal.path().display());
    println!("  {secs}s — kill this process to simulate a crash:");
    println!("    taskkill /F /PID {}\n", std::process::id());

    let live = if is_installed(&PARAKEET_V3_INT8) {
        Transcriber::load().ok().map(LiveTranscriber::start)
    } else {
        println!("  (no model installed — journalling notes only)\n");
        None
    };

    let (tap_tx, tap_rx) = crossbeam_channel::bounded(4000);
    let session = CaptureSession::start(&session_id, &dir, mic_device, Some(tap_tx));

    let deadline = Instant::now() + Duration::from_secs(secs);
    let mut note_lines = 0;

    while Instant::now() < deadline {
        if let Some(live) = &live {
            while let Ok(block) = tap_rx.try_recv() {
                live.submit(trace_lib::transcribe::live::AudioTap {
                    source: block.source,
                    sample_rate: block.sample_rate,
                    samples: block.samples,
                    leading_silence_frames: block.leading_silence_frames,
                    start_offset_ms: block.start_offset_ms,
                });
            }
            for event in live.poll() {
                if let LiveEvent::Segment(segment) = event {
                    println!("  journalled: {} {}", segment.speaker_label(), segment.text);
                    journal
                        .append(&JournalEvent::Segment(segment))
                        .expect("journal segment");
                }
            }
        } else {
            while tap_rx.try_recv().is_ok() {}
        }

        // Stand-in for the user typing. Journalled as whole snapshots.
        note_lines += 1;
        journal
            .append(&JournalEvent::Notes {
                text: format!("note line {note_lines}"),
            })
            .expect("journal notes");

        std::thread::sleep(Duration::from_millis(500));
    }

    // Reached only if never killed. A real crash skips everything below.
    let _ = session.stop();
    journal
        .append(&JournalEvent::SessionEnded {
            ended_at: chrono::Local::now().to_rfc3339(),
        })
        .expect("journal end");
    println!("\ncompleted normally — nothing to recover");
}

fn scan(notes_root: &std::path::Path, finalize: bool) {
    println!("TRACE / RECOVERY");
    println!("  {}\n", paths::sessions_root(notes_root).display());

    let found = store::scan_recoverable(notes_root);
    if found.is_empty() {
        println!("  nothing to recover.");
        return;
    }

    for item in &found {
        let m = &item.replay.meeting;
        println!("  {}", item.session_dir.display());
        println!("    title       {}", m.title);
        println!("    date        {}", m.date);
        println!("    status      {:?}", m.status);
        println!("    segments    {}", m.transcript.len());
        println!("    notes       {} chars", m.notes.len());
        if item.replay.corrupt_lines > 0 {
            println!(
                "    RECOVERED   {} corrupt line(s) skipped (expected: 1 from a crash)",
                item.replay.corrupt_lines
            );
        }

        if finalize {
            match store::write_note(notes_root, m) {
                Ok(path) => {
                    println!("    written     {}", path.display());
                    // Only now is it safe to discard the journal.
                    match store::discard_session(&item.session_dir) {
                        Ok(()) => println!("    discarded   session directory"),
                        Err(e) => println!("    WARNING     could not discard: {e}"),
                    }
                }
                Err(e) => println!("    FAILED      {e}"),
            }
        }
        println!();
    }

    if !finalize {
        println!("  run with `finalize` to write these to Markdown.");
    }
}
