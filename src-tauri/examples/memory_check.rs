//! What TRACE sees before it loads the summary model, and what it decides.
//!
//! ```text
//! cargo run --release --example memory_check -- [model]
//! ```
//!
//! The same check notes run before every load, printed as the diagnostics
//! log records it. Run it with the call, the browser and everything else
//! open to see whether notes would be written now or wait for memory, and
//! which apps the wait would name.

fn main() {
    let model = std::env::args().nth(1).unwrap_or_else(|| {
        match trace_lib::synthesis::ollama::Readiness::check() {
            trace_lib::synthesis::ollama::Readiness::Ready { model } => model,
            other => {
                eprintln!("no summary model to check: {other:?}");
                std::process::exit(1);
            }
        }
    });
    let check = trace_lib::memory::check(&model);
    println!("{}", check.describe("now"));
    println!("{:#?}", check.machine);
    // What notes after a meeting would do now: the chosen model, interim
    // notes from a smaller one, or a wait.
    let installed = trace_lib::synthesis::ollama::OllamaProvider::list_models().unwrap_or_default();
    let ladder = trace_lib::synthesis::ollama::ladder(&model, &installed, |m| {
        trace_lib::synthesis::ollama::footprint(m).bytes
    });
    let fits = ladder.iter().find(|m| trace_lib::memory::check(m).fits());
    match fits {
        Some(m) if *m == model => println!("notes now: written with {m}"),
        Some(m) => println!("notes now: interim notes with {m}"),
        None => println!(
            "notes now: waiting for memory (tried {})",
            ladder.join(", ")
        ),
    }
    for hog in trace_lib::memory::hogs(5) {
        println!(
            "{}: {} graphics, {} memory",
            hog.name,
            trace_lib::memory::gib(hog.gpu_bytes),
            trace_lib::memory::gib(hog.ram_bytes)
        );
    }
}
