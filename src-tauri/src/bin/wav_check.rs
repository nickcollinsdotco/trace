//! Verify a captured session without needing an audio editor.
//!
//! Reads the two WAVs a session produced and reports, per stream, whether it
//! actually contains speech-like audio — and critically, whether the two
//! streams are *distinct*. Distinctness is the whole premise of TRACE's
//! speaker attribution: if the microphone has simply picked up the speakers,
//! both files contain the same thing and the attribution is worthless.
//!
//! ```text
//! cargo run --bin wav_check -- <session directory>
//! ```

use std::path::{Path, PathBuf};

struct Analysis {
    samples: usize,
    sample_rate: u32,
    peak: f32,
    rms: f32,
    /// Fraction of samples that are not exact digital zero. A virtual device
    /// with no source produces 0.0 here; any real microphone produces ~1.0
    /// because of its noise floor.
    non_zero: f64,
    /// Normalised samples, retained for the cross-stream comparison.
    data: Vec<f32>,
}

fn main() {
    let dir: PathBuf = match std::env::args().nth(1) {
        Some(d) => PathBuf::from(d),
        None => {
            eprintln!("usage: wav_check <session directory>");
            std::process::exit(2);
        }
    };

    println!("TRACE / CAPTURE CHECK");
    println!("  {}", dir.display());
    println!();

    let mic = analyse(&dir.join("mic.wav"));
    let system = analyse(&dir.join("system.wav"));

    report("MIC     (you)", &mic);
    report("SYSTEM  (them)", &system);

    let mut problems: Vec<String> = Vec::new();

    for (label, a) in [("mic", &mic), ("system", &system)] {
        match a {
            None => problems.push(format!("{label}.wav is missing or unreadable")),
            Some(a) if a.samples == 0 => problems.push(format!("{label}.wav contains no samples")),
            Some(a) if a.non_zero < 0.01 => problems.push(format!(
                "{label}.wav is digital silence — wrong device, or a virtual device with no source"
            )),
            Some(a) if a.peak < 0.005 => problems.push(format!(
                "{label}.wav is far too quiet to transcribe (peak {:.4})",
                a.peak
            )),
            _ => {}
        }
    }

    // The decisive test: are the two streams actually different signals?
    if let (Some(m), Some(s)) = (&mic, &system) {
        if let Some(r) = correlation(m, s) {
            println!("STREAM SEPARATION");
            println!("  correlation   {r:+.3}");
            let verdict = if r.abs() > 0.5 {
                problems.push(
                    "the two streams are near-duplicates — likely recording speakers through the mic"
                        .to_string(),
                );
                "BAD — same audio in both streams"
            } else if r.abs() > 0.2 {
                "OK — some bleed, attribution still workable (headphones would improve it)"
            } else {
                "GOOD — genuinely independent streams"
            };
            println!("  {verdict}");
            println!();
        }
    }

    println!("VERDICT");
    if problems.is_empty() {
        println!("  [ OK ] both streams captured usable, independent audio.");
        println!();
        println!("  Listen to confirm who is on each:");
        println!("    start \"\" \"{}\"", dir.join("mic.wav").display());
        println!("    start \"\" \"{}\"", dir.join("system.wav").display());
    } else {
        for p in &problems {
            println!("  [FAIL] {p}");
        }
        std::process::exit(1);
    }
}

fn report(label: &str, a: &Option<Analysis>) {
    match a {
        None => println!("{label}\n  MISSING\n"),
        Some(a) => {
            let dbfs = if a.peak > 0.0 {
                format!("{:.1} dBFS", 20.0 * a.peak.log10())
            } else {
                "silent".to_string()
            };
            println!("{label}");
            println!(
                "  {:.2}s at {} Hz  ({} samples)",
                a.samples as f64 / a.sample_rate.max(1) as f64,
                a.sample_rate,
                a.samples
            );
            println!("  peak          {:.4}  ({dbfs})", a.peak);
            println!("  rms           {:.4}", a.rms);
            println!("  non-silent    {:.1}%", a.non_zero * 100.0);
            println!();
        }
    }
}

fn analyse(path: &Path) -> Option<Analysis> {
    let mut reader = hound::WavReader::open(path).ok()?;
    let spec = reader.spec();

    let data: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Int => reader
            .samples::<i16>()
            .filter_map(Result::ok)
            .map(|s| s as f32 / i16::MAX as f32)
            .collect(),
        hound::SampleFormat::Float => reader.samples::<f32>().filter_map(Result::ok).collect(),
    };

    if data.is_empty() {
        return Some(Analysis {
            samples: 0,
            sample_rate: spec.sample_rate,
            peak: 0.0,
            rms: 0.0,
            non_zero: 0.0,
            data,
        });
    }

    let peak = data.iter().fold(0.0f32, |m, s| m.max(s.abs()));
    let rms = (data.iter().map(|s| s * s).sum::<f32>() / data.len() as f32).sqrt();
    let non_zero = data.iter().filter(|s| **s != 0.0).count() as f64 / data.len() as f64;

    Some(Analysis {
        samples: data.len(),
        sample_rate: spec.sample_rate,
        peak,
        rms,
        non_zero,
        data,
    })
}

/// Pearson correlation over the overlapping span of two streams.
///
/// Deliberately ignores the start-offset difference: we are asking "is this
/// broadly the same signal?", not measuring precise delay. Speaker bleed
/// produces a high magnitude here even without sample-accurate alignment.
fn correlation(a: &Analysis, b: &Analysis) -> Option<f64> {
    // Comparing across different sample rates would be meaningless.
    if a.sample_rate != b.sample_rate {
        return None;
    }
    let n = a.data.len().min(b.data.len());
    if n < 1000 {
        return None;
    }

    // Subsample: full resolution is unnecessary and slow on long meetings.
    let step = (n / 200_000).max(1);
    let xs: Vec<f64> = a.data[..n]
        .iter()
        .step_by(step)
        .map(|v| *v as f64)
        .collect();
    let ys: Vec<f64> = b.data[..n]
        .iter()
        .step_by(step)
        .map(|v| *v as f64)
        .collect();

    let len = xs.len() as f64;
    let mx = xs.iter().sum::<f64>() / len;
    let my = ys.iter().sum::<f64>() / len;

    let mut num = 0.0;
    let mut dx = 0.0;
    let mut dy = 0.0;
    for (x, y) in xs.iter().zip(&ys) {
        let a = x - mx;
        let b = y - my;
        num += a * b;
        dx += a * a;
        dy += b * b;
    }

    let den = (dx * dy).sqrt();
    if den == 0.0 {
        return None;
    }
    Some(num / den)
}
