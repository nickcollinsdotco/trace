//! Streaming WAV sink.
//!
//! Audio goes to disk as it arrives. It is never accumulated in memory.
//!
//! This is the one place TRACE deliberately diverges from Voicebox's otherwise
//! excellent capture layer, which collects every sample into an unbounded
//! `Arc<Mutex<Vec<f32>>>`. That is fine for the short, bounded dictation clips
//! Voicebox records; for a two-hour meeting at 48 kHz stereo f32 it is roughly
//! 2.7 GB of resident memory. A meeting recorder cannot work that way.
//!
//! Format is 16-bit PCM mono at the device's native rate:
//!   * 16-bit halves the file size versus f32 and is below the noise floor of
//!     any real microphone, so nothing audible is lost.
//!   * Mono because both ASR and the meters want one channel.
//!   * Native rate because resampling belongs downstream of capture, not
//!     inside a realtime path.
//!
//! A WAV header states its own length, and hound writes that length as zero
//! until the file is finalised. A hard kill or a power cut mid-meeting used to
//! leave a file whose header claimed no audio at all, so every reader saw an
//! empty recording sitting on top of an hour of samples. Two things now cover
//! that: the sink rewrites the header every second while it records, and
//! `open_reader` mends a header that still disagrees with the file before
//! anything reads it.

use std::fs::{File, OpenOptions};
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use hound::{SampleFormat, WavReader, WavSpec, WavWriter};

use super::AudioError;

/// Seconds of audio between header rewrites while recording.
///
/// A rewrite is two small writes into the OS cache, so this could be much
/// shorter; a second is already well inside what anyone would miss, and
/// `repair` recovers the rest from the file's length anyway. The header only
/// has to be close for tools that never go through `repair`.
const CHECKPOINT_SECS: u64 = 1;

/// Mono 16-bit: what a second of one stream costs on disk is its rate times
/// this. Read by the free-space estimate, so the two cannot drift apart.
pub const BYTES_PER_SAMPLE: u64 = 2;

pub struct WavSink {
    writer: Option<WavWriter<BufWriter<File>>>,
    path: PathBuf,
    frames_written: u64,
    checkpoint_every: u64,
    since_checkpoint: u64,
}

impl WavSink {
    pub fn create(path: impl AsRef<Path>, sample_rate: u32) -> Result<Self, AudioError> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let spec = WavSpec {
            channels: 1,
            sample_rate,
            bits_per_sample: (BYTES_PER_SAMPLE * 8) as u16,
            sample_format: SampleFormat::Int,
        };

        let file = create_owned(&path)?;
        Ok(Self {
            writer: Some(WavWriter::new(BufWriter::new(file), spec)?),
            path,
            frames_written: 0,
            checkpoint_every: u64::from(sample_rate.max(1)) * CHECKPOINT_SECS,
            since_checkpoint: 0,
        })
    }

    /// Append mono samples in the range -1.0..=1.0.
    pub fn write(&mut self, samples: &[f32]) -> Result<(), AudioError> {
        let Some(writer) = self.writer.as_mut() else {
            return Ok(()); // already finalised; dropping late audio is correct
        };

        for &sample in samples {
            writer.write_sample(f32_to_i16(sample))?;
        }
        self.frames_written += samples.len() as u64;
        self.checkpoint(samples.len() as u64)
    }

    /// Append `frames` of digital silence.
    ///
    /// Used to fill gaps where a backend delivered no audio but time still
    /// passed. WASAPI loopback does exactly this: an idle render endpoint
    /// produces *no packets at all* rather than silent ones, so without
    /// padding, every quiet stretch in a meeting would be cut out of the file
    /// and everything after it would shift earlier in time.
    pub fn write_silence(&mut self, frames: u64) -> Result<(), AudioError> {
        let Some(writer) = self.writer.as_mut() else {
            return Ok(());
        };

        for _ in 0..frames {
            writer.write_sample(0i16)?;
        }
        self.frames_written += frames;
        self.checkpoint(frames)
    }

    /// Rewrite the header to cover everything written so far, once a
    /// second's worth has accumulated since the last time.
    fn checkpoint(&mut self, frames: u64) -> Result<(), AudioError> {
        self.since_checkpoint += frames;
        if self.since_checkpoint < self.checkpoint_every {
            return Ok(());
        }
        if let Some(writer) = self.writer.as_mut() {
            writer.flush()?;
        }
        self.since_checkpoint = 0;
        Ok(())
    }

    pub fn frames_written(&self) -> u64 {
        self.frames_written
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Flush and rewrite the RIFF header with the true length.
    ///
    /// Must be called explicitly. `Drop` would do it too, but cannot report
    /// an error, and a header left behind the data reads as a shorter meeting
    /// than was recorded until something repairs it.
    pub fn finalize(&mut self) -> Result<(), AudioError> {
        if let Some(writer) = self.writer.take() {
            writer.finalize()?;
        }
        Ok(())
    }
}

/// Create a recording so that nothing else can write to it while it is open.
///
/// Readers are still let in, and so is deletion. Writers are not, which is
/// what makes `repair` safe to call on any path: on a file still being
/// recorded it fails to open rather than racing the sink for the header.
#[cfg(windows)]
fn create_owned(path: &Path) -> std::io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_SHARE_READ: u32 = 0x1;
    const FILE_SHARE_DELETE: u32 = 0x4;
    OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_DELETE)
        .open(path)
}

#[cfg(not(windows))]
fn create_owned(path: &Path) -> std::io::Result<File> {
    File::create(path)
}

/// What `repair` found.
#[derive(Debug, PartialEq, Eq)]
pub enum Repair {
    /// The header already agreed with the file. Nothing was written.
    Intact,
    /// The header's lengths were rewritten to cover this many whole frames.
    Repaired { frames: u64 },
}

/// Make a WAV's header agree with the audio actually in the file.
///
/// Only the two length fields are ever written. Audio is never moved,
/// truncated or deleted, so the worst a wrong guess could do is mislabel how
/// much of the file is audio — and the guess is the file itself:
///   * A header claiming less than the file holds, with a RIFF size that does
///     not match the file either, is one a crash stopped updating. It grows to
///     cover every whole frame on disk; a torn final sample stays outside it.
///   * A header claiming more than the file holds is a file cut short. It
///     shrinks to what is there, so readers stop at the end instead of
///     failing on samples that never arrived.
///   * A header claiming less, with a RIFF size that does match, is complete
///     with other chunks after the audio, as files from other tools can be.
///     It is left alone.
///
/// Anything that is not recognisably a WAV, or is still open for recording,
/// is an error and is not touched.
pub fn repair(path: &Path) -> Result<Repair, AudioError> {
    let mut file = OpenOptions::new().read(true).write(true).open(path)?;
    let len = file.metadata()?.len();
    let layout = read_layout(&mut file, len)?;

    let align = u64::from(layout.block_align);
    let on_disk = len.saturating_sub(layout.data_start);
    // Both lengths are u32; past that the file is beyond what a header can
    // describe, and claiming the first 4 GiB beats claiming none.
    let ceiling = u64::from(u32::MAX) - (layout.data_start - 8);
    let actual = on_disk.min(ceiling) / align * align;
    let declared = u64::from(layout.data_len);
    let riff_matches = u64::from(layout.riff_size) + 8 == len;

    if declared == actual || (declared < actual && riff_matches) {
        return Ok(Repair::Intact);
    }

    let riff = (layout.data_start - 8 + actual) as u32;
    file.seek(SeekFrom::Start(4))?;
    file.write_all(&riff.to_le_bytes())?;
    file.seek(SeekFrom::Start(layout.data_len_offset))?;
    file.write_all(&(actual as u32).to_le_bytes())?;
    file.sync_data()?;
    Ok(Repair::Repaired {
        frames: actual / align,
    })
}

/// Open a recording for reading, mending its header first if a crash left it
/// behind the audio.
///
/// Repair is best effort. A file it cannot open for writing — still being
/// recorded, read-only, or not a WAV at all — is read exactly as it is, and
/// hound reports whatever is really wrong with it.
pub fn open_reader(path: &Path) -> Result<WavReader<BufReader<File>>, hound::Error> {
    if let Ok(Repair::Repaired { frames }) = repair(path) {
        crate::diagnostics::log(format!(
            "repaired a cut-off WAV header: {} now {frames} frames",
            path.file_name().unwrap_or_default().to_string_lossy()
        ));
    }
    WavReader::open(path)
}

/// Where a WAV's length fields are, and what they say.
struct Layout {
    riff_size: u32,
    block_align: u16,
    data_len_offset: u64,
    data_start: u64,
    data_len: u32,
}

/// Walk the chunks up to `data`, reading only what `repair` needs.
///
/// Hand-rolled because hound's reader neither says where the fields are nor
/// opens a file whose lengths disagree with it.
fn read_layout(file: &mut File, len: u64) -> Result<Layout, AudioError> {
    let malformed = |why| AudioError::Wav(hound::Error::FormatError(why));

    let mut head = [0u8; 12];
    file.read_exact(&mut head)
        .map_err(|_| malformed("too short for a RIFF header"))?;
    if &head[0..4] != b"RIFF" || &head[8..12] != b"WAVE" {
        return Err(malformed("not a RIFF WAVE file"));
    }
    let riff_size = u32::from_le_bytes([head[4], head[5], head[6], head[7]]);

    let mut block_align = None;
    let mut pos = 12u64;
    loop {
        if pos + 8 > len {
            return Err(malformed("no data chunk"));
        }
        file.seek(SeekFrom::Start(pos))?;
        let mut chunk = [0u8; 8];
        file.read_exact(&mut chunk)?;
        let size = u32::from_le_bytes([chunk[4], chunk[5], chunk[6], chunk[7]]);

        match &chunk[0..4] {
            b"fmt " => {
                if size < 16 {
                    return Err(malformed("fmt chunk too short"));
                }
                let mut fmt = [0u8; 16];
                file.read_exact(&mut fmt)
                    .map_err(|_| malformed("fmt chunk cut short"))?;
                block_align = Some(u16::from_le_bytes([fmt[12], fmt[13]]));
            }
            b"data" => {
                let block_align = match block_align {
                    Some(align) if align > 0 => align,
                    Some(_) => return Err(malformed("fmt chunk has no frame size")),
                    None => return Err(malformed("data chunk before fmt chunk")),
                };
                return Ok(Layout {
                    riff_size,
                    block_align,
                    data_len_offset: pos + 4,
                    data_start: pos + 8,
                    data_len: size,
                });
            }
            _ => {}
        }
        // Chunks are word-aligned: an odd-sized one is followed by a pad byte.
        pos += 8 + u64::from(size) + u64::from(size & 1);
    }
}

/// Convert a float sample to 16-bit PCM.
///
/// Clamps before scaling: a value beyond ±1.0 would otherwise wrap around and
/// turn a loud passage into harsh noise rather than clean clipping. Scales by
/// 32767 so that +1.0 maps to i16::MAX without overflowing.
#[inline]
fn f32_to_i16(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_full_scale_without_overflow() {
        assert_eq!(f32_to_i16(1.0), i16::MAX);
        assert_eq!(f32_to_i16(-1.0), -i16::MAX);
        assert_eq!(f32_to_i16(0.0), 0);
    }

    #[test]
    fn clamps_rather_than_wrapping() {
        // Without the clamp these would wrap to large negative values, turning
        // a loud moment into noise instead of clipping.
        assert_eq!(f32_to_i16(2.5), i16::MAX);
        assert_eq!(f32_to_i16(-2.5), -i16::MAX);
    }

    #[test]
    fn handles_non_finite_samples() {
        // f32::clamp propagates NaN, and `NaN as i16` saturates to 0 in Rust.
        // Asserting the behaviour so a future change to the cast is noticed.
        assert_eq!(f32_to_i16(f32::NAN), 0);
        assert_eq!(f32_to_i16(f32::INFINITY), i16::MAX);
        assert_eq!(f32_to_i16(f32::NEG_INFINITY), -i16::MAX);
    }

    #[test]
    fn writes_a_readable_wav_with_correct_length() {
        let dir = std::env::temp_dir().join(format!("trace-wav-{}", std::process::id()));
        let path = dir.join("t.wav");

        let mut sink = WavSink::create(&path, 48_000).expect("create");
        sink.write(&[0.0, 0.5, -0.5]).expect("write");
        sink.write(&[1.0]).expect("write");
        assert_eq!(sink.frames_written(), 4);
        sink.finalize().expect("finalize");

        let reader = hound::WavReader::open(&path).expect("reopen");
        assert_eq!(reader.spec().channels, 1);
        assert_eq!(reader.spec().sample_rate, 48_000);
        assert_eq!(reader.len(), 4, "header must report the true sample count");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn writing_after_finalize_is_a_no_op_not_an_error() {
        // A capture thread may deliver one last buffer after stop was
        // signalled. Losing those samples is correct; panicking is not.
        let dir = std::env::temp_dir().join(format!("trace-wav-late-{}", std::process::id()));
        let path = dir.join("t.wav");

        let mut sink = WavSink::create(&path, 16_000).expect("create");
        sink.write(&[0.1]).expect("write");
        sink.finalize().expect("finalize");
        assert!(sink.write(&[0.2]).is_ok(), "late write must not error");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn creates_missing_parent_directories() {
        let dir = std::env::temp_dir().join(format!("trace-wav-deep-{}", std::process::id()));
        let path = dir.join("nested").join("deeper").join("t.wav");

        let mut sink = WavSink::create(&path, 16_000).expect("create nested");
        sink.finalize().expect("finalize");
        assert!(path.exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("trace-wav-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A 16-bit mono WAV as raw bytes, with whatever lengths the header is
    /// told to claim — so a crash's leftovers can be built exactly.
    fn raw_wav(riff: u32, data_len: u32, data: &[u8]) -> Vec<u8> {
        let mut b = Vec::new();
        b.extend_from_slice(b"RIFF");
        b.extend_from_slice(&riff.to_le_bytes());
        b.extend_from_slice(b"WAVEfmt ");
        b.extend_from_slice(&16u32.to_le_bytes());
        b.extend_from_slice(&1u16.to_le_bytes()); // PCM
        b.extend_from_slice(&1u16.to_le_bytes()); // mono
        b.extend_from_slice(&16_000u32.to_le_bytes());
        b.extend_from_slice(&32_000u32.to_le_bytes());
        b.extend_from_slice(&2u16.to_le_bytes()); // block align
        b.extend_from_slice(&16u16.to_le_bytes());
        b.extend_from_slice(b"data");
        b.extend_from_slice(&data_len.to_le_bytes());
        b.extend_from_slice(data);
        b
    }

    fn pcm(samples: &[i16]) -> Vec<u8> {
        samples.iter().flat_map(|s| s.to_le_bytes()).collect()
    }

    fn read_all(path: &Path) -> Vec<i16> {
        WavReader::open(path)
            .unwrap()
            .samples::<i16>()
            .map(|s| s.expect("every sample the header claims is there"))
            .collect()
    }

    /// Record 2.5 s at 16 kHz in 100 ms blocks, then kill the process: what
    /// is on disk at that instant, copied aside, is all a restart would find.
    /// No finalize, no Drop, and whatever sat in the write buffer is lost.
    fn killed_recording(dir: &Path) -> PathBuf {
        let mut sink = WavSink::create(dir.join("live.wav"), 16_000).unwrap();
        for _ in 0..25 {
            sink.write(&[0.25; 1_600]).unwrap();
        }
        let crashed = dir.join("mic.wav");
        std::fs::write(&crashed, std::fs::read(sink.path()).unwrap()).unwrap();
        crashed
    }

    #[test]
    fn a_killed_recording_keeps_its_header_within_a_second() {
        // The bug: killed mid-meeting, the header still said zero, and every
        // reader saw an empty file.
        let dir = scratch("killed");
        let path = killed_recording(&dir);

        // Checkpoints at 1 s and 2 s; the half-second since is what repair is for.
        assert_eq!(WavReader::open(&path).unwrap().len(), 32_000);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn repair_recovers_audio_written_after_the_last_checkpoint() {
        let dir = scratch("past-checkpoint");
        let path = killed_recording(&dir);

        let on_disk = (std::fs::metadata(&path).unwrap().len() - 44) / 2;
        assert!(
            on_disk > 32_000,
            "some audio reached disk past the checkpoint"
        );
        assert_eq!(repair(&path).unwrap(), Repair::Repaired { frames: on_disk });
        let samples = read_all(&path);
        assert_eq!(samples.len() as u64, on_disk);
        assert!(samples.iter().all(|&s| s == f32_to_i16(0.25)));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_header_that_never_left_zero_is_rebuilt_from_the_file() {
        let dir = scratch("zero");
        let path = dir.join("mic.wav");
        let audio: Vec<i16> = (0..5_000).map(|i| (i % 300) as i16).collect();
        std::fs::write(&path, raw_wav(0, 0, &pcm(&audio))).unwrap();

        assert_eq!(WavReader::open(&path).unwrap().len(), 0, "the failure");
        assert_eq!(repair(&path).unwrap(), Repair::Repaired { frames: 5_000 });
        assert_eq!(read_all(&path), audio);
        // RIFF size is the file less its first eight bytes.
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(&bytes[4..8], &(bytes.len() as u32 - 8).to_le_bytes());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_torn_final_sample_is_left_out_but_not_deleted() {
        let dir = scratch("torn");
        let path = dir.join("mic.wav");
        let mut data = pcm(&[100, 200, 300]);
        data.push(0x7f); // half a sample: the kill landed mid-write
        std::fs::write(&path, raw_wav(0, 0, &data)).unwrap();
        let len = std::fs::metadata(&path).unwrap().len();

        assert_eq!(repair(&path).unwrap(), Repair::Repaired { frames: 3 });
        assert_eq!(read_all(&path), vec![100, 200, 300]);
        assert_eq!(std::fs::metadata(&path).unwrap().len(), len);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_file_cut_short_shrinks_to_what_is_there() {
        // A header checkpointed ahead of data that never reached the disk.
        let dir = scratch("short");
        let path = dir.join("mic.wav");
        let audio: Vec<i16> = (0..400).collect();
        std::fs::write(&path, raw_wav(36 + 2_000, 2_000, &pcm(&audio))).unwrap();

        assert_eq!(repair(&path).unwrap(), Repair::Repaired { frames: 400 });
        assert_eq!(read_all(&path), audio);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_finished_recording_is_left_byte_for_byte() {
        let dir = scratch("finished");
        let path = dir.join("mic.wav");
        let mut sink = WavSink::create(&path, 48_000).unwrap();
        sink.write(&[0.1; 70_000]).unwrap();
        sink.finalize().unwrap();
        let before = std::fs::read(&path).unwrap();

        assert_eq!(repair(&path).unwrap(), Repair::Intact);
        assert_eq!(std::fs::read(&path).unwrap(), before);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn chunks_after_the_audio_are_not_taken_for_audio() {
        // Files from other tools can carry metadata after `data`. The RIFF
        // size says so, and growing the audio over it would play it as noise.
        let dir = scratch("trailing");
        let path = dir.join("mic.wav");
        let mut tail = pcm(&[1, 2, 3, 4]);
        tail.extend_from_slice(b"LIST");
        tail.extend_from_slice(&4u32.to_le_bytes());
        tail.extend_from_slice(b"INFO");
        let bytes = raw_wav(36 + tail.len() as u32, 8, &tail);
        std::fs::write(&path, &bytes).unwrap();

        assert_eq!(repair(&path).unwrap(), Repair::Intact);
        assert_eq!(std::fs::read(&path).unwrap(), bytes);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn chunks_before_the_audio_are_walked_past_with_their_padding() {
        let dir = scratch("leading");
        let path = dir.join("mic.wav");
        let plain = raw_wav(0, 0, &[]);
        let mut bytes = plain[..36].to_vec();
        bytes.extend_from_slice(b"junk");
        bytes.extend_from_slice(&3u32.to_le_bytes());
        bytes.extend_from_slice(&[9, 9, 9, 0]); // odd size, then the pad byte
        bytes.extend_from_slice(&plain[36..]);
        bytes.extend_from_slice(&pcm(&[7, 8]));
        std::fs::write(&path, &bytes).unwrap();

        assert_eq!(repair(&path).unwrap(), Repair::Repaired { frames: 2 });
        // Checked as bytes: hound skips an odd chunk without its pad byte, so
        // it cannot read this file whatever its header says. TRACE never
        // writes one; the walk only has to find the right field to fix.
        let fixed = std::fs::read(&path).unwrap();
        assert_eq!(&fixed[48..52], b"data");
        assert_eq!(&fixed[52..56], &4u32.to_le_bytes());
        assert_eq!(&fixed[4..8], &(fixed.len() as u32 - 8).to_le_bytes());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn what_is_not_a_wav_is_refused_and_left_alone() {
        let dir = scratch("malformed");
        let full = raw_wav(0, 0, &pcm(&[1, 2]));
        let mut no_data = full[..36].to_vec();
        no_data.extend_from_slice(b"LIST");
        no_data.extend_from_slice(&0u32.to_le_bytes());
        let mut data_first = full[..12].to_vec();
        data_first.extend_from_slice(&full[36..]);
        let mut no_frame_size = full.clone();
        no_frame_size[32..34].copy_from_slice(&0u16.to_le_bytes());

        let cases: [(&str, Vec<u8>); 7] = [
            ("empty", Vec::new()),
            (
                "not-riff",
                b"this is not a wav file at all, honest".to_vec(),
            ),
            ("cut-in-fmt", full[..20].to_vec()),
            ("cut-before-data", full[..36].to_vec()),
            ("no-data", no_data),
            ("data-first", data_first),
            ("no-frame-size", no_frame_size),
        ];
        for (name, bytes) in cases {
            let path = dir.join(format!("{name}.wav"));
            std::fs::write(&path, &bytes).unwrap();
            assert!(repair(&path).is_err(), "{name} must be refused");
            assert_eq!(std::fs::read(&path).unwrap(), bytes, "{name} untouched");
        }
        assert!(repair(&dir.join("missing.wav")).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn opening_a_crashed_recording_repairs_it_first() {
        let dir = scratch("open");
        let path = dir.join("system.wav");
        std::fs::write(&path, raw_wav(0, 0, &pcm(&[5; 1_000]))).unwrap();

        assert_eq!(open_reader(&path).unwrap().len(), 1_000);
        assert_eq!(repair(&path).unwrap(), Repair::Intact, "mended on disk");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[cfg(windows)]
    #[test]
    fn a_recording_in_progress_cannot_be_repaired_under_it() {
        // The sink owns the header while it records. Repair has to fail to
        // open the file, not race the next checkpoint for those bytes.
        let dir = scratch("live");
        let path = dir.join("mic.wav");
        let mut sink = WavSink::create(&path, 16_000).unwrap();
        sink.write(&[0.5; 20_000]).unwrap(); // checkpointed after the block
        sink.write(&[0.5; 1_000]).unwrap(); // not yet
        let before = std::fs::read(&path).unwrap();

        assert!(repair(&path).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
        // Readers are still let in, and see up to the last checkpoint.
        assert_eq!(open_reader(&path).unwrap().len(), 20_000);

        sink.finalize().unwrap();
        drop(sink);
        assert_eq!(repair(&path).unwrap(), Repair::Intact);
        assert_eq!(read_all(&path).len(), 21_000);

        std::fs::remove_dir_all(&dir).ok();
    }
}
