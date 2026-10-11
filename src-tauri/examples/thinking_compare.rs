//! Write a real meeting's notes with the model's thinking on, then off.
//!
//! ```text
//! cargo run --release --example thinking_compare -- <session dir> <on|off|default> [out.json]
//! ```
//!
//! qwen3 writes a reasoning pass before every answer unless told not to —
//! 2–7k characters per part on an hour-long meeting, counted against the
//! answer's token budget and the time. This replays a session's journal and
//! writes its notes with Ollama's `think` option set, printing what each part
//! cost and, if asked, saving the notes for a side-by-side read. One mode per
//! run, so each starts from the same loaded model.
//!
//! Checks memory first, as the app does, and stops rather than load a model
//! there is no room for. Its events go to the terminal, not the app's log.

use std::path::PathBuf;
use std::time::Instant;

use trace_lib::synthesis::ollama::{OllamaProvider, Readiness};

fn main() {
    trace_lib::diagnostics::terminal_only();

    let mut args = std::env::args().skip(1);
    let (Some(dir), Some(mode)) = (args.next().map(PathBuf::from), args.next()) else {
        eprintln!("usage: thinking_compare <session dir> <on|off|default> [out.json]");
        std::process::exit(2);
    };
    let out = args.next().map(PathBuf::from);

    let Readiness::Ready { model } = Readiness::check() else {
        eprintln!("Ollama is not ready");
        std::process::exit(1);
    };
    let check = trace_lib::memory::check(&model);
    println!("{}", check.describe("before comparing"));
    if !check.fits() {
        std::process::exit(1);
    }

    let provider = match mode.as_str() {
        "on" => OllamaProvider::new(&model).thinking(true),
        "off" => OllamaProvider::new(&model).thinking(false),
        _ => OllamaProvider::new(&model),
    };
    let meeting = trace_lib::store::journal::replay(&dir)
        .expect("journal")
        .meeting;

    let started = Instant::now();
    let (generated, report) =
        trace_lib::synthesis::generate(&provider, &meeting, |_| Ok(())).expect("notes");
    println!(
        "thinking {mode}: {:.0}s, {} key points, {} decisions, {} action items, {} open questions, {} discarded ({} fabricated, {} uncited)",
        started.elapsed().as_secs_f64(),
        generated.key_points.len(),
        generated.decisions.len(),
        generated.action_items.len(),
        generated.open_questions.len(),
        report.total_dropped(),
        report.fabricated,
        report.uncited,
    );
    if let Some(out) = out {
        std::fs::write(&out, serde_json::to_string_pretty(&generated).unwrap()).unwrap();
        println!("notes saved to {}", out.display());
    }
}
