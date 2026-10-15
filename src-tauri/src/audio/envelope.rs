//! A meeting's loudness, reduced to a line of block characters.
//!
//! ```text
//! signal: ▁▂▅▇▅▃▂▁▁▂▃▆█▆▃▁▁▁▂▄▆▇▆▄▂▁▁▁▂▃▅▆▅▃▂▁
//! ```
//!
//! Computed once, from the WAVs, before they are deleted — so the library can
//! show the real shape of the last conversation long after its audio is gone,
//! without ever opening a microphone to draw something that moves. Forty-eight
//! characters of frontmatter, readable as a sparkline in any editor, and a
//! string to YAML where a row of digits would have been a number.

use std::path::Path;

/// Columns in the envelope.
pub const BUCKETS: usize = 48;

/// Eighth blocks, quietest first.
const LEVELS: [char; 8] = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/// The envelope of every readable WAV given, loudest stream per column.
///
/// Each file is placed on the meeting's timeline by its offset, so a paused
/// meeting's parts sit where they happened and the pause between them is
/// flat. Bucketed by each file's own length, as this once was, two parts of
/// one stream were each drawn across the whole width, one over the other.
///
/// Streams read one at a time and sample by sample: an hour of 48 kHz audio
/// is 170 million samples, and holding one in memory to draw 48 bars would be
/// absurd. None when nothing readable had any sound in it.
pub fn of_parts(parts: &[(&Path, u64)]) -> Option<String> {
    let span_ms = parts
        .iter()
        .filter_map(|&(path, offset_ms)| Some(offset_ms + length_ms(path)?))
        .max()
        .filter(|&ms| ms > 0)?;

    let mut peaks = [0f32; BUCKETS];
    let mut any = false;
    for &(path, offset_ms) in parts {
        if let Some(levels) = rms_buckets(path, offset_ms, span_ms) {
            any = true;
            for (peak, level) in peaks.iter_mut().zip(levels) {
                *peak = peak.max(level);
            }
        }
    }
    if !any {
        return None;
    }
    render(&peaks)
}

/// How long a WAV runs, from its header.
fn length_ms(path: &Path) -> Option<u64> {
    let reader = super::wav::open_reader(path).ok()?;
    let rate = u64::from(reader.spec().sample_rate.max(1));
    Some(u64::from(reader.duration()) * 1000 / rate)
}

/// Blocks for per-column levels, scaled to the loudest column.
///
/// Scaled rather than absolute, so a quietly recorded meeting still shows its
/// shape — the point is where the talking was, not how hot the gain was set.
/// Square-rooted first, because loudness is closer to logarithmic than linear
/// and raw RMS draws one spike and a flat line.
pub fn render(levels: &[f32]) -> Option<String> {
    let peak = levels.iter().copied().fold(0f32, f32::max);
    if peak <= f32::EPSILON {
        return None;
    }
    let top = peak.sqrt();
    Some(
        levels
            .iter()
            .map(|l| {
                let scaled = (l.max(0.0).sqrt() / top * (LEVELS.len() - 1) as f32).round();
                LEVELS[(scaled as usize).min(LEVELS.len() - 1)]
            })
            .collect(),
    )
}

/// RMS per column for one WAV, streamed, the columns spanning `span_ms` of
/// the meeting and the file starting `offset_ms` into it.
fn rms_buckets(path: &Path, offset_ms: u64, span_ms: u64) -> Option<Vec<f32>> {
    let mut reader = super::wav::open_reader(path).ok()?;
    let spec = reader.spec();
    let channels = usize::from(spec.channels.max(1));
    if reader.duration() == 0 {
        return None;
    }
    // Interleaved sample `i` is frame `i / channels`; frame `f` is at
    // `offset + f / rate` on the meeting's clock.
    let samples_per_ms = f64::from(spec.sample_rate.max(1)) * channels as f64 / 1000.0;
    let ms_per_bucket = span_ms as f64 / BUCKETS as f64;

    let mut sums = vec![0f64; BUCKETS];
    let mut counts = vec![0usize; BUCKETS];
    let mut add = |i: usize, s: f32| {
        let at_ms = offset_ms as f64 + i as f64 / samples_per_ms;
        let b = ((at_ms / ms_per_bucket) as usize).min(BUCKETS - 1);
        sums[b] += f64::from(s) * f64::from(s);
        counts[b] += 1;
    };

    match spec.sample_format {
        hound::SampleFormat::Float => {
            for (i, s) in reader.samples::<f32>().enumerate() {
                add(i, s.ok()?);
            }
        }
        hound::SampleFormat::Int => {
            let scale = (1i64 << (spec.bits_per_sample.max(1) - 1)) as f32;
            for (i, s) in reader.samples::<i32>().enumerate() {
                add(i, s.ok()? as f32 / scale);
            }
        }
    }

    Some(
        sums.iter()
            .zip(&counts)
            .map(|(sum, &n)| {
                if n == 0 {
                    0.0
                } else {
                    (sum / n as f64).sqrt() as f32
                }
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silence_has_no_envelope() {
        assert_eq!(render(&[0.0; BUCKETS]), None);
    }

    #[test]
    fn the_loudest_column_is_a_full_block_and_quiet_is_the_floor() {
        let mut levels = [0.0f32; BUCKETS];
        levels[3] = 0.5;
        levels[10] = 0.125;
        let env = render(&levels).unwrap();
        let chars: Vec<char> = env.chars().collect();
        assert_eq!(chars.len(), BUCKETS);
        assert_eq!(chars[3], '█');
        assert_eq!(chars[0], '▁');
        // Square-rooted: a quarter of the RMS is half the height, not an eighth.
        assert_eq!(chars[10], '▅');
    }

    #[test]
    fn a_wav_is_read_into_columns_where_the_sound_was() {
        let dir = std::env::temp_dir().join(format!("trace-envelope-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("mic.wav");
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 1000,
            bits_per_sample: 32,
            sample_format: hound::SampleFormat::Float,
        };
        let mut w = hound::WavWriter::create(&path, spec).unwrap();
        // Silent first half, a tone in the second.
        for i in 0..4800 {
            let s = if i < 2400 {
                0.0
            } else {
                ((i as f32) * 0.3).sin() * 0.5
            };
            w.write_sample(s).unwrap();
        }
        w.finalize().unwrap();

        let env: Vec<char> = of_parts(&[(path.as_path(), 0)]).unwrap().chars().collect();
        assert!(env[..BUCKETS / 2].iter().all(|&c| c == '▁'), "{env:?}");
        assert!(env[BUCKETS / 2..].iter().all(|&c| c == '█'), "{env:?}");
    }

    #[test]
    fn parts_sit_where_they_happened_and_the_pause_between_is_flat() {
        let dir = std::env::temp_dir().join(format!("trace-envelope-parts-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 1000,
            bits_per_sample: 32,
            sample_format: hound::SampleFormat::Float,
        };
        // Two 12s parts of tone, 0–12s and 36–48s, paused between.
        let tone = |name: &str| {
            let path = dir.join(name);
            let mut w = hound::WavWriter::create(&path, spec).unwrap();
            for i in 0..12_000 {
                w.write_sample(((i as f32) * 0.3).sin() * 0.5).unwrap();
            }
            w.finalize().unwrap();
            path
        };
        let first = tone("mic.wav");
        let second = tone("mic-2.wav");

        let env: Vec<char> = of_parts(&[(first.as_path(), 0), (second.as_path(), 36_000)])
            .unwrap()
            .chars()
            .collect();
        // A column is a second; the pause is columns 12 to 35.
        assert!(env[..12].iter().all(|&c| c == '█'), "{env:?}");
        assert!(env[12..36].iter().all(|&c| c == '▁'), "{env:?}");
        assert!(env[36..].iter().all(|&c| c == '█'), "{env:?}");
    }

    #[test]
    fn unreadable_files_give_nothing() {
        assert_eq!(of_parts(&[(Path::new("/nonexistent/mic.wav"), 0)]), None);
    }
}
