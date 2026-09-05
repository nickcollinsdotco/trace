//! Show where the chunker splits a recording, and why.
//!
//! ```text
//! cargo run --release --example chunk_check -- <session directory>
//! ```
//!
//! The chunker decides where one unit of transcription ends. When it splits
//! mid-sentence, Parakeet is handed a fragment that does not end at a
//! boundary and finishes it with a plausible word nobody said — which is how
//! "this is where designers never stop learning" became "...designers know."
//!
//! Guessing at thresholds from a transcript is hopeless. This prints the
//! energy profile the VAD actually sees, the chunks it actually produces, and
//! what a different threshold *would* produce, so the numbers in
//! `ChunkConfig` can be chosen against a real recording instead of folklore.

use std::path::{Path, PathBuf};

use trace_lib::transcribe::chunker::{chunk_by_silence, ChunkConfig};

fn main() {
    let Some(dir) = std::env::args().nth(1).map(PathBuf::from) else {
        eprintln!("usage: chunk_check <session directory>");
        std::process::exit(2);
    };

    for name in ["mic.wav", "system.wav"] {
        let path = dir.join(name);
        let Some((samples, rate)) = read(&path) else {
            continue;
        };
        if samples.is_empty() {
            println!("{name}: empty\n");
            continue;
        }

        println!(
            "=== {name} — {:.1}s at {rate} Hz ===",
            duration(&samples, rate)
        );
        energy_profile(&samples, rate);

        let base = ChunkConfig::for_rate(rate);
        println!(
            "  derived threshold: {:.4}
",
            trace_lib::transcribe::chunker::adaptive_threshold(&samples, base.frame_size)
        );

        report("current (adaptive)", &samples, rate, base);
        for t in [0.0025f32, 0.0035, 0.0045, 0.006] {
            report(
                &format!("pinned {t:.4}"),
                &samples,
                rate,
                ChunkConfig {
                    energy_threshold: Some(t),
                    ..base
                },
            );
        }
        report(
            "old fixed 0.012 / 510ms",
            &samples,
            rate,
            ChunkConfig {
                energy_threshold: Some(0.012),
                silence_frames: 17,
                ..base
            },
        );
        println!();
    }
}

/// Per-second RMS, so the threshold can be seen against the actual signal.
///
/// The bar is what matters: anything at or below the threshold line is audio
/// the chunker treats as silence, whether or not somebody was speaking.
fn energy_profile(samples: &[f32], rate: u32) {
    let per_second = rate as usize;
    println!("  second  rms      vs 0.012");
    for (i, window) in samples.chunks(per_second).enumerate() {
        let rms = (window.iter().map(|s| s * s).sum::<f32>() / window.len() as f32).sqrt();
        let bar = "#".repeat(((rms / 0.012) * 8.0).min(40.0) as usize);
        let mark = if rms < 0.012 { "  <- silence" } else { "" };
        println!("  {i:>5}   {rms:.4}   {bar}{mark}");
    }
    println!();
}

fn report(label: &str, samples: &[f32], rate: u32, config: ChunkConfig) {
    let chunks = chunk_by_silence(samples, &config);
    println!(
        "  {label}: {} chunk(s), threshold {}, silence {} frames (~{} ms)",
        chunks.len(),
        config
            .energy_threshold
            .map_or_else(|| "derived".to_string(), |t| format!("{t:.4}")),
        config.silence_frames,
        config.silence_frames * 30,
    );
    for c in &chunks {
        println!(
            "    {:>6.2}s .. {:>6.2}s  ({:.2}s)",
            c.start_ms(rate) as f64 / 1000.0,
            (c.start_ms(rate) + c.duration_ms(rate)) as f64 / 1000.0,
            c.duration_ms(rate) as f64 / 1000.0,
        );
    }
    println!();
}

fn duration(samples: &[f32], rate: u32) -> f64 {
    samples.len() as f64 / rate as f64
}

fn read(path: &Path) -> Option<(Vec<f32>, u32)> {
    let mut reader = hound::WavReader::open(path).ok()?;
    let spec = reader.spec();

    let interleaved: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Int => reader
            .samples::<i16>()
            .filter_map(Result::ok)
            .map(|s| f32::from(s) / f32::from(i16::MAX))
            .collect(),
        hound::SampleFormat::Float => reader.samples::<f32>().filter_map(Result::ok).collect(),
    };

    // The chunker works on mono, as the capture pipeline hands it.
    let mono = if spec.channels > 1 {
        interleaved
            .chunks(spec.channels as usize)
            .map(|f| f.iter().sum::<f32>() / f.len() as f32)
            .collect()
    } else {
        interleaved
    };

    Some((mono, spec.sample_rate))
}
