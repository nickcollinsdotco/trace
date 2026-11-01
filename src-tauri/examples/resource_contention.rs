//! Bounded, read-only replay; see docs/research/resource-contention.md.
//! No devices, settings, journals, Ollama requests or transcript output.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::json;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
use trace_lib::transcribe::chunker::{chunk_by_silence, Chunk, ChunkConfig};
use trace_lib::transcribe::streaming::StreamingChunker;
use transcribe_rs::onnx::parakeet::{ParakeetModel, ParakeetParams, TimestampGranularity};
use transcribe_rs::onnx::Quantization;

type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
const RATE: usize = 16_000;
const GIB: u64 = 1 << 30;

#[derive(Clone, Copy, Debug, Deserialize, serde::Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum Mode {
    Solo,
    Idle,
    Overlap,
}

#[derive(Debug, Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
struct Pool {
    intra: usize,
    inter: usize,
    spin: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Config {
    model_dir: PathBuf,
    /// Empty means two generated tone streams, for plumbing only.
    wavs: Vec<PathBuf>,
    start_secs: u32,
    duration_secs: u32,
    timeout_secs: u32,
    mode: Mode,
    pool: Option<Pool>,
    cancel_file: PathBuf,
}

impl Config {
    fn validate(&self) -> Result<()> {
        if !(1..=60).contains(&self.duration_secs)
            || self.start_secs > 3600
            || self.timeout_secs < self.duration_secs + 10
            || self.timeout_secs > 180
            || !(self.wavs.is_empty() || self.wavs.len() == 2)
            || self
                .pool
                .as_ref()
                .is_some_and(|p| !(1..=16).contains(&p.intra) || !(1..=16).contains(&p.inter))
        {
            return Err("invalid bounds: 1–60 s, offset <=3600 s, timeout duration+10..180 s, zero or two WAVs, pool threads 1..16".into());
        }
        Ok(())
    }
}

struct Job {
    due: Duration,
    stream: usize,
    chunk: Chunk,
}

/// Feed the actual live chunker in 10 ms blocks. The deadline is when a chunk
/// becomes available, including silence lookahead, rather than its speech end.
fn live_jobs(streams: &[Vec<f32>]) -> Vec<Job> {
    let mut jobs = Vec::new();
    for (stream, samples) in streams.iter().enumerate() {
        let mut chunker = StreamingChunker::new(ChunkConfig::live(RATE as u32));
        let mut consumed = 0;
        for block in samples.chunks(RATE / 100) {
            consumed += block.len();
            for chunk in chunker.push(block) {
                jobs.push(Job {
                    due: Duration::from_secs_f64(consumed as f64 / RATE as f64),
                    stream,
                    chunk,
                });
            }
        }
        for chunk in chunker.flush() {
            jobs.push(Job {
                due: Duration::from_secs_f64(samples.len() as f64 / RATE as f64),
                stream,
                chunk,
            });
        }
    }
    jobs.sort_by_key(|job| job.due);
    jobs
}

fn read_excerpt(path: &Path, start: u32, seconds: u32) -> Result<Vec<f32>> {
    // Do not use TRACE's repair-on-open reader: source evidence is read-only.
    let mut reader = hound::WavReader::open(path)?;
    let spec = reader.spec();
    if !(8_000..=192_000).contains(&spec.sample_rate)
        || !(1..=8).contains(&spec.channels)
        || !(8..=32).contains(&spec.bits_per_sample)
    {
        return Err("unsupported WAV format".into());
    }
    reader.seek(start * spec.sample_rate)?;
    let count = seconds as usize * spec.sample_rate as usize * spec.channels as usize;
    let interleaved = if spec.sample_format == hound::SampleFormat::Float {
        reader
            .samples::<f32>()
            .take(count)
            .collect::<std::result::Result<Vec<_>, _>>()?
    } else {
        let scale = (1u64 << (spec.bits_per_sample - 1)) as f32;
        reader
            .samples::<i32>()
            .take(count)
            .map(|s| s.map(|s| s as f32 / scale))
            .collect::<std::result::Result<Vec<_>, _>>()?
    };
    if interleaved.len() != count || interleaved.iter().any(|s| !s.is_finite()) {
        return Err("excerpt is short or contains non-finite samples".into());
    }
    let mono = trace_lib::audio::downmix_to_mono(&interleaved, spec.channels);
    Ok(trace_lib::audio::resample::to_16k(&mono, spec.sample_rate)?)
}

fn generated(seconds: u32) -> Vec<f32> {
    (0..seconds as usize * RATE)
        .map(|i| {
            if i / RATE % 5 < 4 {
                0.12 * (i as f32 * 180.0 * std::f32::consts::TAU / RATE as f32).sin()
            } else {
                0.0
            }
        })
        .collect()
}

fn refresh(sys: &mut System) {
    sys.refresh_memory();
    sys.refresh_cpu_usage();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_cpu().with_memory(),
    );
}

fn guard(sys: &System, minimum: u64, cancel: &Path) -> Result<()> {
    if cancel.exists() {
        return Err("cancel file present".into());
    }
    if sys.available_memory() < minimum {
        return Err("RAM headroom below safety floor".into());
    }
    // Deliberately conservative: an idle TRACE or Ollama also blocks a run.
    // This avoids relying on a log or marker that can race a new meeting.
    if sys.processes().values().any(|p| {
        let name = p.name().to_string_lossy().to_ascii_lowercase();
        matches!(name.as_str(), "trace" | "trace.exe") || name.starts_with("ollama")
    }) {
        return Err("TRACE or Ollama is running; leave it alone and try when idle".into());
    }
    Ok(())
}

fn infer(model: &mut ParakeetModel, samples: &[f32]) -> Result<bool> {
    let params = ParakeetParams {
        timestamp_granularity: Some(TimestampGranularity::Segment),
        ..Default::default()
    };
    // The words never leave this stack frame, including on the output path.
    Ok(!model
        .transcribe_with(samples, &params)?
        .text
        .trim()
        .is_empty())
}

fn run(config: Config) -> Result<()> {
    config.validate()?;
    let started = Instant::now();
    let mut sys = System::new();
    refresh(&mut sys);
    guard(&sys, 8 * GIB, &config.cancel_file)?;
    println!(
        "{}",
        json!({"event":"start", "mode":config.mode, "pool":config.pool,
        "synthetic":config.wavs.is_empty(), "duration_s":config.duration_secs,
        "ram_total":sys.total_memory(), "ram_available":sys.available_memory(),
        "logical_cpus":std::thread::available_parallelism()?.get()})
    );

    let done = Arc::new(AtomicBool::new(false));
    let monitor_done = done.clone();
    let cancel = config.cancel_file.clone();
    let timeout = Duration::from_secs(u64::from(config.timeout_secs));
    let monitor = std::thread::spawn(move || {
        let pid = sysinfo::Pid::from_u32(std::process::id());
        loop {
            if monitor_done.load(Ordering::Relaxed) {
                break;
            }
            refresh(&mut sys);
            let reason = guard(&sys, 4 * GIB, &cancel)
                .err()
                .map(|e| e.to_string())
                .or_else(|| (started.elapsed() >= timeout).then(|| "hard timeout".into()));
            if let Some(reason) = reason {
                println!("{}", json!({"event":"aborted", "reason":reason}));
                // A process boundary is needed: ORT inference/load cannot be
                // interrupted through Parakeet's public API. Only this process dies.
                std::process::exit(124);
            }
            if let Some(p) = sys.process(pid) {
                println!(
                    "{}",
                    json!({"event":"sample", "at_s":started.elapsed().as_secs_f64(),
                    "cpu_ms":p.accumulated_cpu_time(), "cpu_percent_one_core":p.cpu_usage(),
                    "system_cpu_percent":sys.global_cpu_usage(), "rss_bytes":p.memory(),
                    "ram_available":sys.available_memory()})
                );
            }
            std::thread::sleep(Duration::from_millis(500));
        }
    });

    if let Some(pool) = &config.pool {
        let options = ort::environment::GlobalThreadPoolOptions::default()
            .with_intra_threads(pool.intra)?
            .with_inter_threads(pool.inter)?
            .with_spin_control(pool.spin)?;
        if !ort::init().with_global_thread_pool(options).commit() {
            return Err("ORT was already initialised; experimental pool did not apply".into());
        }
    }
    let streams: Vec<Vec<f32>> = if config.wavs.is_empty() {
        vec![generated(config.duration_secs); 2]
    } else {
        config
            .wavs
            .iter()
            .map(|p| read_excerpt(p, config.start_secs, config.duration_secs))
            .collect::<Result<_>>()?
    };
    let jobs = live_jobs(&streams);
    let background: Vec<_> = streams
        .iter()
        .flat_map(|s| chunk_by_silence(s, &ChunkConfig::default()))
        .collect();
    if jobs.is_empty() || background.is_empty() {
        return Err("excerpt has no speech chunks".into());
    }
    println!(
        "{}",
        json!({"event":"input", "live_chunks":jobs.len(),
        "repass_chunks":background.len(),
        "live_audio_s":jobs.iter().map(|j| j.chunk.samples.len()).sum::<usize>() as f64 / RATE as f64,
        "repass_audio_s":background.iter().map(|j| j.samples.len()).sum::<usize>() as f64 / RATE as f64})
    );
    let load = Instant::now();
    let mut live = ParakeetModel::load(&config.model_dir, &Quantization::Int8)?;
    infer(&mut live, &jobs[0].chunk.samples)?;
    println!(
        "{}",
        json!({"event":"live_ready", "load_and_warmup_s":load.elapsed().as_secs_f64()})
    );
    let mut other = if config.mode == Mode::Solo {
        None
    } else {
        let load = Instant::now();
        let mut model = ParakeetModel::load(&config.model_dir, &Quantization::Int8)?;
        infer(&mut model, &background[0].samples)?;
        println!(
            "{}",
            json!({"event":"repass_ready", "load_and_warmup_s":load.elapsed().as_secs_f64()})
        );
        Some(model)
    };
    // Let cold-load work settle before the measured replay begins.
    std::thread::sleep(Duration::from_secs(1));
    let epoch = Instant::now();
    let stop = Arc::new(AtomicBool::new(false));
    println!(
        "{}",
        json!({"event":"replay_start", "at_s":started.elapsed().as_secs_f64()})
    );
    let background_stop = stop.clone();
    let mode = config.mode;
    let bg = std::thread::spawn(move || -> Result<()> {
        if mode != Mode::Overlap {
            // Keep the idle engine alive for exactly the replay window.
            while !background_stop.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(10));
            }
        } else {
            let mut index = 0;
            while !background_stop.load(Ordering::Relaxed) {
                let chunk = &background[index % background.len()];
                let t = Instant::now();
                let nonempty = infer(other.as_mut().unwrap(), &chunk.samples)?;
                println!(
                    "{}",
                    json!({"event":"repass_chunk", "index":index,
                    "started_s":t.duration_since(epoch).as_secs_f64(),
                    "inference_ms":t.elapsed().as_secs_f64()*1000.0,
                    "audio_ms":chunk.duration_ms(RATE as u32), "nonempty":nonempty})
                );
                index += 1;
            }
        }
        drop(other);
        Ok(())
    });
    for (index, job) in jobs.iter().enumerate() {
        if let Some(wait) = job.due.checked_sub(epoch.elapsed()) {
            std::thread::sleep(wait);
        }
        let t = Instant::now();
        let nonempty = infer(&mut live, &job.chunk.samples)?;
        println!(
            "{}",
            json!({"event":"live_chunk", "index":index, "stream":job.stream,
            "due_s":job.due.as_secs_f64(), "started_s":t.duration_since(epoch).as_secs_f64(),
            "inference_ms":t.elapsed().as_secs_f64()*1000.0,
            "response_ms":epoch.elapsed().saturating_sub(job.due).as_secs_f64()*1000.0,
            "audio_ms":job.chunk.duration_ms(RATE as u32), "nonempty":nonempty})
        );
    }
    let horizon = Duration::from_secs(u64::from(config.duration_secs));
    if let Some(wait) = horizon.checked_sub(epoch.elapsed()) {
        std::thread::sleep(wait);
    }
    println!(
        "{}",
        json!({"event":"live_end", "at_s":started.elapsed().as_secs_f64(),
        "elapsed_s":epoch.elapsed().as_secs_f64()})
    );
    stop.store(true, Ordering::Relaxed);
    bg.join().map_err(|_| "background worker panicked")??;
    println!(
        "{}",
        json!({"event":"replay_end", "at_s":started.elapsed().as_secs_f64()})
    );
    drop(live);
    done.store(true, Ordering::Relaxed);
    monitor.join().map_err(|_| "monitor panicked")?;
    println!("{}", json!({"event":"complete"}));
    Ok(())
}

fn main() {
    let result = (|| -> Result<()> {
        let path = std::env::args_os()
            .nth(1)
            .ok_or("usage: resource_contention <local-config.json>")?;
        run(serde_json::from_slice(&std::fs::read(path)?)?)
    })();
    if let Err(e) = result {
        eprintln!("resource_contention: {e}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_config_rejects_accidental_long_or_unpaired_runs() {
        let mut c = Config {
            model_dir: "unused".into(),
            wavs: vec![],
            start_secs: 0,
            duration_secs: 30,
            timeout_secs: 120,
            mode: Mode::Solo,
            pool: None,
            cancel_file: "unused".into(),
        };
        assert!(c.validate().is_ok());
        c.duration_secs = 61;
        assert!(c.validate().is_err());
        c.duration_secs = 30;
        c.wavs.push("one-stream.wav".into());
        assert!(c.validate().is_err());
        c.wavs.clear();
        c.pool = Some(Pool {
            intra: 0,
            inter: 1,
            spin: false,
        });
        assert!(c.validate().is_err());
        c.pool = None;
        c.timeout_secs = 39;
        assert!(c.validate().is_err());
    }

    #[test]
    fn replay_deadlines_include_lookahead_and_flush_and_merge_both_streams() {
        let streams = vec![generated(12); 2];
        let jobs = live_jobs(&streams);
        assert!(!jobs.is_empty());
        assert!(jobs.windows(2).all(|w| w[0].due <= w[1].due));
        assert_eq!(
            jobs.iter().filter(|j| j.stream == 0).count(),
            jobs.iter().filter(|j| j.stream == 1).count()
        );
        assert_eq!(jobs.last().unwrap().due, Duration::from_secs(12));
        for j in &jobs {
            let end = (j.chunk.start_sample + j.chunk.samples.len()) as f64 / RATE as f64;
            assert!(j.due.as_secs_f64() + 0.0001 >= end);
        }
        assert!(
            jobs[0].due.as_secs_f64() > 4.0,
            "silence must arrive before its chunk is emitted"
        );
    }

    #[test]
    fn excerpt_seeks_downmixes_and_never_repairs_or_rewrites_evidence() {
        let path = std::env::temp_dir().join(format!(
            "trace-contention-fixture-{}.wav",
            std::process::id()
        ));
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .unwrap();
        let _clean = scopeguard::guard(path.clone(), |p| {
            let _ = std::fs::remove_file(p);
        });
        let mut writer = hound::WavWriter::new(
            file,
            hound::WavSpec {
                channels: 2,
                sample_rate: RATE as u32,
                bits_per_sample: 16,
                sample_format: hound::SampleFormat::Int,
            },
        )
        .unwrap();
        for i in 0..RATE * 3 {
            let value = if i < RATE { 0i16 } else { 8192 };
            writer.write_sample(value).unwrap();
            writer.write_sample(0i16).unwrap();
        }
        writer.finalize().unwrap();
        let before = std::fs::read(&path).unwrap();
        let samples = read_excerpt(&path, 1, 1).unwrap();
        assert_eq!(samples.len(), RATE);
        assert!(samples.iter().all(|s| (*s - 0.125).abs() < 0.00001));
        assert!(
            read_excerpt(&path, 2, 2).is_err(),
            "short reads must not silently change the workload"
        );
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }
}
