//! Measure what the full-quality pass costs in memory, before inference.
//!
//! ```text
//! cargo run --release --example repass_memory -- whole  [minutes]
//! cargo run --release --example repass_memory -- stream [minutes]
//! ```
//!
//! Writes a synthetic meeting of `minutes` (default 60) at 48 kHz — speech-
//! like tone and pauses, the shape a real stream has — then cuts it into the
//! chunks the engine is given, the old way (`whole`: read, downmix and
//! resample everything at once) or the new (`stream`), and prints the
//! process's peak working set. One mode per run, because a peak is per
//! process. The engine is left out on purpose: it is the same in both, and
//! what changed is everything around it.

use std::path::{Path, PathBuf};
use std::time::Instant;

use trace_lib::transcribe::chunker::{chunk_by_silence, ChunkConfig};

fn main() {
    let mut args = std::env::args().skip(1);
    let mode = args.next().unwrap_or_default();
    let minutes: u64 = args.next().and_then(|m| m.parse().ok()).unwrap_or(60);
    if mode != "whole" && mode != "stream" {
        eprintln!("usage: repass_memory <whole|stream> [minutes]");
        std::process::exit(2);
    }

    let path = std::env::temp_dir().join(format!("trace-repass-{minutes}min.wav"));
    if !path.exists() {
        write_meeting(&path, minutes);
    }
    let baseline = peak_mib();

    let started = Instant::now();
    let (chunks, speech_samples) = if mode == "whole" {
        whole(&path)
    } else {
        stream(&path)
    };

    println!(
        "{mode:6} {minutes} min: {chunks} chunks, {:.0} s of speech, {:.1} s, peak working set {} MiB ({} MiB before)",
        speech_samples as f64 / 16_000.0,
        started.elapsed().as_secs_f64(),
        peak_mib(),
        baseline
    );
}

/// What `transcribe_stream` did before: every copy alive at once.
fn whole(path: &Path) -> (usize, usize) {
    let mut reader = hound::WavReader::open(path).unwrap();
    let spec = reader.spec();
    let interleaved: Vec<f32> = reader
        .samples::<i32>()
        .filter_map(Result::ok)
        .map(|s| s as f32 / (1i64 << (spec.bits_per_sample - 1)) as f32)
        .collect();
    let samples = trace_lib::audio::downmix_to_mono(&interleaved, spec.channels);
    let samples16 = trace_lib::audio::resample::to_16k(&samples, spec.sample_rate).unwrap();
    let chunks = chunk_by_silence(&samples16, &ChunkConfig::default());
    let speech = chunks.iter().map(|c| c.samples.len()).sum();
    // Held until here, as the old function held them until it returned.
    drop((interleaved, samples, samples16));
    (chunks.len(), speech)
}

/// What it does now: one chunk at a time, handed to the engine and dropped.
fn stream(path: &Path) -> (usize, usize) {
    let (mut n, mut speech) = (0, 0);
    trace_lib::transcribe::stream_chunks(path, |chunk| {
        n += 1;
        speech += chunk.samples.len();
        Ok(())
    })
    .unwrap();
    (n, speech)
}

/// Bursts of tone between pauses, roughly how one side of a call looks.
fn write_meeting(path: &PathBuf, minutes: u64) {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 48_000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut w = hound::WavWriter::create(path, spec).unwrap();
    let total = minutes * 60 * 48_000;
    for i in 0..total {
        let t = i as f32 / 48_000.0;
        // 7 s of "speech" then 3 s of room tone, with a slow wobble.
        let talking = (i / 48_000) % 10 < 7;
        let hiss = ((i.wrapping_mul(2_654_435_761)) % 1000) as f32 / 1000.0 - 0.5;
        let tone = if talking {
            0.15 * (2.0 * std::f32::consts::PI * (180.0 + 40.0 * (t * 0.3).sin()) * t).sin()
        } else {
            0.0
        };
        w.write_sample(((tone + 0.003 * hiss) * 32767.0) as i16)
            .unwrap();
    }
    w.finalize().unwrap();
}

fn peak_mib() -> u64 {
    #[cfg(windows)]
    {
        use windows::Win32::System::ProcessStatus::{
            GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
        };
        use windows::Win32::System::Threading::GetCurrentProcess;

        let mut counters = PROCESS_MEMORY_COUNTERS::default();
        // SAFETY: the pseudo-handle needs no closing; the struct is ours.
        unsafe {
            GetProcessMemoryInfo(
                GetCurrentProcess(),
                &mut counters,
                std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
            )
            .ok();
        }
        counters.PeakWorkingSetSize as u64 >> 20
    }
    #[cfg(not(windows))]
    0
}
