//! M2 verification harness: transcribe a captured session.
//!
//! ```text
//! cargo run --release --bin transcribe_spike -- <session directory>
//! ```
//!
//! Downloads the model on first run. Use `--release`: int8 ONNX inference in a
//! debug build is roughly an order of magnitude slower and will look broken.
//!
//! Temporary, like `record_spike` — delete once the Tauri commands exist.

use std::path::PathBuf;
use std::time::Instant;

use trace_lib::audio::StreamSource;
use trace_lib::models::{self, install, PARAKEET_V3_INT8};
use trace_lib::transcribe::{merge, Transcriber};

fn main() {
    let dir: PathBuf = match std::env::args().nth(1) {
        Some(d) => PathBuf::from(d),
        None => {
            eprintln!("usage: transcribe_spike <session directory>");
            std::process::exit(2);
        }
    };

    if let Err(e) = ensure_model() {
        eprintln!("\n[FAIL] {e}");
        std::process::exit(1);
    }

    println!("\nTRACE / TRANSCRIBE");
    println!("  {}", dir.display());

    let load_start = Instant::now();
    let mut engine = match Transcriber::load() {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[FAIL] loading engine: {e}");
            std::process::exit(1);
        }
    };
    println!(
        "  engine loaded in {:.1}s\n",
        load_start.elapsed().as_secs_f64()
    );

    // NOTE: offsets are hard-coded to 0 here. The real pipeline takes them
    // from the capture session's StreamOutcome; the spike has no access to
    // that, so cross-stream alignment is approximate in this tool only.
    let streams = [
        (StreamSource::Microphone, dir.join("mic.wav")),
        (StreamSource::System, dir.join("system.wav")),
    ];

    let mut all = Vec::new();
    for (source, path) in streams {
        if !path.exists() {
            println!("  {source:?}: no file, skipped");
            continue;
        }
        let start = Instant::now();
        match engine.transcribe_stream(&path, source, 0) {
            Ok(segments) => {
                println!(
                    "  {source:?}: {} segments in {:.1}s",
                    segments.len(),
                    start.elapsed().as_secs_f64()
                );
                all.extend(segments);
            }
            Err(e) => println!("  {source:?}: FAILED — {e}"),
        }
    }

    let merged = merge(all);

    println!("\nTRANSCRIPT ({} segments)\n", merged.len());
    if merged.is_empty() {
        println!("  (nothing transcribed)");
        return;
    }

    for s in &merged {
        println!(
            "  {}  {:<5}  {}",
            fmt_ms(s.start_ms),
            s.speaker_label(),
            s.text
        );
    }
}

/// Download the model if it is not already present.
fn ensure_model() -> Result<(), models::ModelError> {
    if models::is_installed(&PARAKEET_V3_INT8) {
        println!(
            "model ready: {}",
            models::model_dir(&PARAKEET_V3_INT8)?.display()
        );
        return Ok(());
    }

    println!("TRACE / INITIALIZING\n");
    println!("> model    {}", PARAKEET_V3_INT8.display_name);
    println!(
        "> target   {}",
        models::model_dir(&PARAKEET_V3_INT8)?.display()
    );
    println!(
        "> size     {:.0} MB\n",
        PARAKEET_V3_INT8.approx_download_bytes as f64 / 1_048_576.0
    );

    let mut last_pct = -1i64;
    install::install(&PARAKEET_V3_INT8, |p| match p {
        install::Progress::Downloading { received, total } => {
            if let Some(total) = total {
                let pct = (received * 100 / total.max(1)) as i64;
                // Only redraw on whole-percent changes; a 478 MB download
                // otherwise emits tens of thousands of lines.
                if pct != last_pct {
                    last_pct = pct;
                    print!("\r> downloading............. {pct:>3}%");
                    use std::io::Write;
                    std::io::stdout().flush().ok();
                }
            }
        }
        install::Progress::Extracting => println!("\n> extracting.............. "),
        install::Progress::Verifying => println!("> verifying............... "),
        install::Progress::Done => println!("\nREADY.\n"),
    })
}

fn fmt_ms(ms: u64) -> String {
    let total = ms / 1000;
    format!("{:02}:{:02}", total / 60, total % 60)
}
