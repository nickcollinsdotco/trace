//! What TRACE sees before it loads the summary model, and what it decides.
//!
//! ```text
//! cargo run --release --example memory_check -- [model]
//! ```
//!
//! The same check notes run before every load, printed as the diagnostics
//! log records it. Run it with the call, the browser and everything else
//! open to see whether notes would be written now or wait for memory.

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
}
