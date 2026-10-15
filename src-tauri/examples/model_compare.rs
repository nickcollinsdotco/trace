//! Write a real meeting's notes with a model of your choosing.
//!
//! ```text
//! cargo run --release --example model_compare -- <session dir> <model> [out.json] [--no-think]
//! ```
//!
//! For judging whether a smaller model writes notes good enough to fall back
//! on when the preferred one does not fit. Replays the session's journal,
//! writes its notes as the app would, and prints what it cost: time, what
//! survived citation checking, and how much memory the model took once
//! loaded. Save the notes and read them beside the ones already written.
//!
//! Checks memory first, as the app does, and stops rather than load a model
//! there is no room for. Its events go to the terminal, not the app's log.

use std::path::PathBuf;
use std::time::Instant;

use trace_lib::memory::gib;
use trace_lib::synthesis::ollama::OllamaProvider;

fn main() {
    trace_lib::diagnostics::terminal_only();

    // Small models can spend the whole answer budget reasoning, so thinking
    // is worth comparing off as well as on.
    let no_think = std::env::args().any(|a| a == "--no-think");
    let mut args = std::env::args().skip(1).filter(|a| a != "--no-think");
    let (Some(dir), Some(model)) = (args.next().map(PathBuf::from), args.next()) else {
        eprintln!("usage: model_compare <session dir> <model> [out.json] [--no-think]");
        std::process::exit(2);
    };
    let out = args.next().map(PathBuf::from);

    let check = trace_lib::memory::check(&model);
    println!("{}", check.describe("before comparing"));
    if !check.fits() {
        std::process::exit(1);
    }

    let provider = if no_think {
        OllamaProvider::new(&model).thinking(false)
    } else {
        OllamaProvider::new(&model)
    };
    let meeting = trace_lib::store::journal::replay(&dir)
        .expect("journal")
        .meeting;

    let started = Instant::now();
    let (generated, report) =
        trace_lib::synthesis::generate(&provider, &meeting, |_| Ok(())).expect("notes");
    println!(
        "{model}: {:.0}s, {} key points, {} decisions, {} action items, {} open questions, {} discarded ({} fabricated, {} uncited)",
        started.elapsed().as_secs_f64(),
        generated.key_points.len(),
        generated.decisions.len(),
        generated.action_items.len(),
        generated.open_questions.len(),
        report.total_dropped(),
        report.fabricated,
        report.uncited,
    );
    for m in OllamaProvider::loaded().iter().filter(|m| m.name == model) {
        println!(
            "loaded: {} in all, {} of it on the graphics card",
            gib(m.size_bytes),
            gib(m.vram_bytes)
        );
    }
    if let Some(out) = out {
        std::fs::write(&out, serde_json::to_string_pretty(&generated).unwrap()).unwrap();
        println!("notes saved to {}", out.display());
    }
}
