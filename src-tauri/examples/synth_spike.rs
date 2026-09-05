//! M6 verification harness: synthesis against a real model.
//!
//! ```text
//! synth_spike                    # a built-in fixture transcript
//! synth_spike <note.md>          # not yet: reads a saved note
//! ```
//!
//! Prints the raw structured output plus what validation dropped, so the
//! anti-fabrication mechanism can be seen working rather than assumed.

use std::time::Instant;

use trace_lib::audio::StreamSource;
use trace_lib::meeting::Meeting;
use trace_lib::synthesis::{generate, ollama::OllamaProvider, LlmProvider};
use trace_lib::transcribe::Segment;

fn main() {
    let model = std::env::args().nth(1).unwrap_or_else(|| "qwen3:8b".into());

    println!("TRACE / SYNTHESIS");
    println!("  model  {model}");

    if !OllamaProvider::service_running() {
        eprintln!("\n[FAIL] Ollama is not running on 127.0.0.1:11434");
        std::process::exit(1);
    }

    let provider = OllamaProvider::new(&model);
    if !provider.available() {
        eprintln!("\n[FAIL] model '{model}' is not pulled. Try: ollama pull {model}");
        match OllamaProvider::list_models() {
            Ok(models) if !models.is_empty() => {
                eprintln!("       available: {}", models.join(", "))
            }
            _ => {}
        }
        std::process::exit(1);
    }

    let meeting = fixture();
    println!("  input  {} transcript lines", meeting.transcript.len());
    println!("\nthinking...\n");

    let started = Instant::now();
    match generate(&provider, &meeting, |p| {
        if p.total > 1 {
            println!("  window {} of {}...", p.window, p.total);
        }
    }) {
        Ok((generated, report)) => {
            println!("  took {:.1}s\n", started.elapsed().as_secs_f64());

            println!("SUMMARY");
            println!("  {}\n", generated.summary);

            section("KEY POINTS", &generated.key_points);
            section("DECISIONS", &generated.decisions);

            println!("ACTION ITEMS");
            if generated.action_items.is_empty() {
                println!("  (none)");
            }
            for item in &generated.action_items {
                println!(
                    "  [ ] {}{}  {:?} ({:.0}%)",
                    item.owner
                        .as_ref()
                        .map(|o| format!("{o}: "))
                        .unwrap_or_default(),
                    item.text,
                    item.evidence.segment_ids,
                    item.confidence * 100.0
                );
            }
            println!();

            section("OPEN QUESTIONS", &generated.open_questions);

            println!("VALIDATION");
            if report.is_clean() {
                println!("  [ OK ] every claim cited a real transcript line.");
            } else {
                println!("  {} item(s) dropped:", report.total_dropped());
                if report.fabricated > 0 {
                    println!("    {} cited segments that do not exist", report.fabricated);
                }
                if report.uncited > 0 {
                    println!("    {} cited nothing at all", report.uncited);
                }
                if report.empty > 0 {
                    println!("    {} had no text", report.empty);
                }
            }
        }
        Err(e) => {
            eprintln!("[FAIL] {e}");
            std::process::exit(1);
        }
    }
}

fn section(title: &str, claims: &[trace_lib::meeting::Claim]) {
    println!("{title}");
    if claims.is_empty() {
        println!("  (none)");
    }
    for c in claims {
        println!(
            "  - {}  {:?} ({:.0}%)",
            c.text,
            c.evidence.segment_ids,
            c.confidence * 100.0
        );
    }
    println!();
}

/// A short meeting with deliberate traps.
///
/// Contains one clear decision, one thing merely *discussed* that a careless
/// model will report as decided, one real commitment, and one question left
/// open. Getting the middle one right is the actual test.
fn fixture() -> Meeting {
    let lines: &[(&str, u64, StreamSource, &str)] = &[
        (
            "sys_0000",
            2_000,
            StreamSource::System,
            "Right, shall we start with the pricing page?",
        ),
        (
            "mic_0001",
            6_000,
            StreamSource::Microphone,
            "Yeah. The main issue is people don't understand the tiers.",
        ),
        (
            "sys_0002",
            12_000,
            StreamSource::System,
            "We could just collapse it to two tiers instead of four.",
        ),
        (
            "mic_0003",
            18_000,
            StreamSource::Microphone,
            "Maybe. I'd want to see what that does to revenue first, I'm not sure.",
        ),
        (
            "sys_0004",
            25_000,
            StreamSource::System,
            "Fair. Let's park that one for now.",
        ),
        (
            "mic_0005",
            30_000,
            StreamSource::Microphone,
            "But we should definitely remove the second setup step, that's clearly hurting us.",
        ),
        (
            "sys_0006",
            36_000,
            StreamSource::System,
            "Agreed, let's do that. I'll get it into next sprint.",
        ),
        (
            "mic_0007",
            42_000,
            StreamSource::Microphone,
            "Great. And can you send me the revised onboarding flow before Thursday?",
        ),
        (
            "sys_0008",
            48_000,
            StreamSource::System,
            "Yes, I'll send it over Wednesday.",
        ),
        (
            "mic_0009",
            54_000,
            StreamSource::Microphone,
            "One thing I still don't know is whether the API rate limits will hold up.",
        ),
        (
            "sys_0010",
            61_000,
            StreamSource::System,
            "No idea. We'd need engineering to weigh in on that.",
        ),
    ];

    let mut m = Meeting::new("fixture", "Pricing and onboarding");
    m.notes = "pricing tiers confusing\nsetup step needs removing".into();
    m.transcript = lines
        .iter()
        .map(|(id, ms, source, text)| Segment {
            id: (*id).into(),
            start_ms: *ms,
            end_ms: ms + 4_000,
            text: (*text).into(),
            source: *source,
        })
        .collect();
    m
}
