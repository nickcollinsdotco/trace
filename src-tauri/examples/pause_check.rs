//! Does a paused meeting's audio land where it happened?
//!
//! Records on the real devices for `secs`, pauses as long, then records as
//! long again — the way the capture manager does it: one session per
//! stretch, both on the meeting's clock. Prints each part's file and offset,
//! the envelope the library would draw, and, when a speech model is
//! installed, the full-quality transcript with its ids.
//!
//!   cargo run --release --example pause_check -- [secs]
//!
//! Say something in each stretch, and something during the pause: the first
//! two should be in the transcript at the time they were said, the last
//! nowhere. Every id should be different.

use std::time::{Duration, Instant};

use trace_lib::audio::session::{CaptureSession, StreamOutcome};
use trace_lib::audio::StreamSource;

fn main() {
    trace_lib::diagnostics::terminal_only();
    let secs: u64 = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(5);
    let dir = std::env::temp_dir().join(format!("trace-pause-check-{}", std::process::id()));
    let stretch = Duration::from_secs(secs);
    let clock = Instant::now();

    let mut parts: Vec<StreamOutcome> = Vec::new();
    for part in 1..=2 {
        if part > 1 {
            println!(
                "paused at {} ms — speak now; none of it should be kept",
                ms(clock)
            );
            std::thread::sleep(stretch);
        }
        println!("recording part {part} from {} ms — speak", ms(clock));
        let session = CaptureSession::start_part("pause-check", &dir, None, None, clock, part);
        std::thread::sleep(stretch);
        parts.extend(session.stop().streams);
    }
    println!("stopped at {} ms\n", ms(clock));

    let mut problems = Vec::new();
    for s in &parts {
        let name = s.path.file_name().unwrap_or_default().to_string_lossy();
        println!(
            "  {name:<14} {:?} from {:>6} ms, {:>5.1}s, {}",
            s.source,
            s.start_offset_ms,
            s.duration_secs(),
            s.error.as_deref().unwrap_or("ok")
        );
    }

    // Part 2 starts after part 1 and the pause, not where part 1 ended.
    let mic = |n: usize| {
        parts
            .iter()
            .filter(|s| s.source == StreamSource::Microphone)
            .nth(n)
    };
    if let (Some(first), Some(second)) = (mic(0), mic(1)) {
        let expected = 2 * secs * 1000;
        let gap = second.start_offset_ms.abs_diff(expected);
        println!("\n  mic part 2 starts {gap} ms from where it was resumed");
        if gap > 1000 {
            problems.push(format!(
                "part 2 placed at {} ms, resumed at about {expected} ms",
                second.start_offset_ms
            ));
        }
        if second.path == first.path {
            problems.push("both parts wrote the same file".into());
        }
    }

    let envelope: Vec<(&std::path::Path, u64)> = parts
        .iter()
        .map(|s| (s.path.as_path(), s.start_offset_ms))
        .collect();
    println!(
        "  signal: {}",
        trace_lib::audio::envelope::of_parts(&envelope).unwrap_or_else(|| "(silent)".into())
    );

    match trace_lib::transcribe::Transcriber::load() {
        Err(e) => println!("\n  no transcript: {e}"),
        Ok(mut engine) => {
            let mut next = (0usize, 0usize);
            let mut segments = Vec::new();
            for s in parts.iter().filter(|s| s.is_usable()) {
                let n = match s.source {
                    StreamSource::Microphone => &mut next.0,
                    StreamSource::System => &mut next.1,
                };
                match engine.transcribe_stream(&s.path, s.source, s.start_offset_ms, *n, &|| false)
                {
                    Ok(mut produced) => {
                        *n += produced.len();
                        segments.append(&mut produced);
                    }
                    Err(e) => problems.push(format!("{}: {e}", s.path.display())),
                }
            }
            let segments = trace_lib::transcribe::merge(segments);
            println!("\n  transcript:");
            for s in &segments {
                println!("    [{}] {:>6} ms  {}", s.id, s.start_ms, s.text);
            }
            let mut ids: Vec<&str> = segments.iter().map(|s| s.id.as_str()).collect();
            ids.sort_unstable();
            if ids.windows(2).any(|w| w[0] == w[1]) {
                problems.push("two segments share an id".into());
            }
            let paused = (secs * 1000)..(2 * secs * 1000);
            if let Some(s) = segments.iter().find(|s| paused.contains(&s.start_ms)) {
                problems.push(format!("[{}] starts inside the pause", s.id));
            }
        }
    }

    let _ = std::fs::remove_dir_all(&dir);
    println!();
    if problems.is_empty() {
        println!("[ OK ] each stretch in its own files, placed where it happened");
    } else {
        for p in &problems {
            println!("[FAIL] {p}");
        }
        std::process::exit(1);
    }
}

fn ms(clock: Instant) -> u128 {
    clock.elapsed().as_millis()
}
