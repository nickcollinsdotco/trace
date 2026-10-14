//! Does Stop let go of Ollama at once, and does Ollama stop generating?
//!
//! Summarises a real session's journal and presses Stop `secs` seconds in,
//! then prints how long the summary took to give up. Afterwards, Ollama's
//! own log (`%LOCALAPPDATA%\Ollama\server.log`) should show the request
//! ending early — a 499 or an abort when the client went away — rather than
//! a 200 a minute later.
//!
//!   cargo run --release --example stop_check -- <session dir> [secs] [model]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use trace_lib::synthesis::{generate, ollama::OllamaProvider, SynthesisError};

fn main() {
    trace_lib::diagnostics::terminal_only();
    let mut args = std::env::args().skip(1);
    let dir = args
        .next()
        .expect("usage: stop_check <session dir> [secs] [model]");
    let secs: u64 = args.next().and_then(|s| s.parse().ok()).unwrap_or(20);
    let model = args.next().unwrap_or_else(|| "qwen3:8b".into());

    let replay = trace_lib::store::journal::replay(std::path::Path::new(&dir))
        .expect("the session's journal could not be read");
    println!(
        "{} segments, model {model}, stopping {secs}s in",
        replay.meeting.transcript.len()
    );

    let stop = Arc::new(AtomicBool::new(false));
    let pressed = Arc::new(std::sync::Mutex::new(None::<Instant>));
    {
        let (stop, pressed) = (Arc::clone(&stop), Arc::clone(&pressed));
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(secs));
            *pressed.lock().unwrap() = Some(Instant::now());
            stop.store(true, Ordering::Relaxed);
            println!("stop pressed");
        });
    }

    let flag = Arc::clone(&stop);
    let provider =
        OllamaProvider::new(&model).stop_when(Arc::new(move || flag.load(Ordering::Relaxed)));
    let started = Instant::now();
    let result = generate(&provider, &replay.meeting, |p| {
        println!("  part {} of {}", p.window, p.total);
        Ok(())
    });
    let ended = Instant::now();

    match result {
        Err(SynthesisError::Stopped(_)) => {
            let after = pressed
                .lock()
                .unwrap()
                .map(|p| ended.duration_since(p).as_millis())
                .unwrap_or(0);
            println!("stopped {after} ms after the press");
        }
        Ok(_) => println!(
            "finished in {:.0}s before the press — try fewer seconds",
            started.elapsed().as_secs_f64()
        ),
        Err(e) => println!("failed: {e}"),
    }
    println!("ended at {}", chrono::Local::now().format("%H:%M:%S"));
    // Alive a while longer, as the app would be: a request that had not
    // really let go would carry on and show in Ollama's log meanwhile,
    // instead of being cut off by this process exiting.
    std::thread::sleep(Duration::from_secs(15));
}
