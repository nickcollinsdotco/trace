//! Windows system-audio capture via WASAPI loopback.
//!
//! `cpal` cannot do this on Windows — loopback support was implemented in
//! RustAudio/cpal#339, subsequently lost, and is still open as issue #476 —
//! so the `wasapi` crate is used directly. The approach follows Voicebox
//! (`jamiepine/voicebox`, MIT), which is the only audited project with a
//! working Rust loopback implementation. See NOTICE.
//!
//! # How loopback is actually enabled
//!
//! There is no explicit "loopback" flag to set. The `wasapi` crate infers it
//! from the combination of *device direction* and *stream direction*
//! (`api.rs`, `initialize_client`):
//!
//! ```text
//! (Direction::Render, Direction::Capture, ShareMode::Shared) => AUDCLNT_STREAMFLAGS_LOOPBACK
//! ```
//!
//! So: take the default **Render** (playback) device, then initialise it for
//! **Capture** in **shared** mode. Exclusive mode is rejected outright by the
//! crate, which matches the Windows API — loopback cannot capture an
//! exclusive-mode stream.
//!
//! Event-driven timing *does* combine with loopback: the crate applies
//! `AUDCLNT_STREAMFLAGS_EVENTCALLBACK` unconditionally for `Events*` modes,
//! including alongside the loopback flag. Polling is unnecessary.
//!
//! # COM threading
//!
//! WASAPI objects are COM objects and are **not `Send`**. Every one of them
//! must be created and used on the same thread, and that thread must
//! initialise and uninitialise COM itself. That is why this function owns its
//! whole lifecycle and blocks — it cannot hand a client to anyone else.

use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Instant;

use wasapi::{initialize_mta, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat};

use super::wav::WavSink;
use super::{downmix_to_mono, AudioError, StopSignal, StreamFormat, StreamStats};

/// How long to block on the audio event before re-checking the stop flag.
///
/// A timeout rather than an indefinite wait: a silent render device may not
/// signal for a long time, and without this the thread would not notice that
/// the meeting had ended. 100 ms bounds shutdown latency at a tenth of a
/// second while keeping the loop essentially idle.
const EVENT_TIMEOUT_MS: u32 = 100;

/// Capture system audio until `stop` is signalled.
///
/// Blocks the calling thread and must be given one of its own — it owns a COM
/// apartment for its entire duration.
pub fn run_capture(
    path: PathBuf,
    stats: Arc<StreamStats>,
    stop: StopSignal,
    clock: Instant,
    tap: Option<super::AudioTapSender>,
) -> Result<StreamFormat, AudioError> {
    // Multi-threaded apartment. Never do this on a UI thread.
    initialize_mta()
        .ok()
        .map_err(|e| AudioError::Backend(format!("COM initialisation failed: {e}")))?;

    // COM must be uninitialised on the same thread, on every exit path
    // including the `?` early returns below.
    let _com_guard = scopeguard::guard((), |_| wasapi::deinitialize());

    let enumerator =
        DeviceEnumerator::new().map_err(|e| AudioError::Backend(format!("enumerator: {e}")))?;

    // Render device + Capture direction is what makes this loopback.
    let device = enumerator
        .get_default_device(&Direction::Render)
        .map_err(|_| AudioError::NoDevice("system audio (render) device"))?;

    let mut audio_client = device
        .get_iaudioclient()
        .map_err(|e| AudioError::Backend(format!("audio client: {e}")))?;

    // Ask for the device's own mix format. Requesting anything else risks the
    // engine refusing initialisation on some hardware.
    let mix_format = audio_client
        .get_mixformat()
        .map_err(|e| AudioError::Backend(format!("mix format: {e}")))?;

    let device_name = device
        .get_friendlyname()
        .unwrap_or_else(|_| "<unnamed>".into());

    let source_channels = mix_format.get_nchannels();
    let format = StreamFormat {
        sample_rate: mix_format.get_samplespersec(),
        source_channels,
        device_name,
    };

    // Capture as 32-bit float regardless of what the device reports natively.
    // `autoconvert: true` makes the audio engine handle the conversion, which
    // removes the need to branch on bit depth in the read loop — and avoids
    // the silent-drop bug that comes from handling only one width.
    let desired_format = WaveFormat::new(
        32,
        32,
        &SampleType::Float,
        format.sample_rate as usize,
        source_channels as usize,
        None,
    );

    let (_default_period, min_period) = audio_client
        .get_device_period()
        .map_err(|e| AudioError::Backend(format!("device period: {e}")))?;

    let mode = StreamMode::EventsShared {
        autoconvert: true,
        buffer_duration_hns: min_period,
    };

    audio_client
        .initialize_client(&desired_format, &Direction::Capture, &mode)
        .map_err(|e| AudioError::Backend(format!("initialize loopback client: {e}")))?;

    let h_event = audio_client
        .set_get_eventhandle()
        .map_err(|e| AudioError::Backend(format!("event handle: {e}")))?;

    let capture_client = audio_client
        .get_audiocaptureclient()
        .map_err(|e| AudioError::Backend(format!("capture client: {e}")))?;

    audio_client
        .start_stream()
        .map_err(|e| AudioError::Backend(format!("start stream: {e}")))?;

    // Stop the device on every exit path, so a `?` below cannot leave the
    // endpoint running and block the next session from opening it.
    let _stream_guard = scopeguard::guard((), |_| {
        audio_client.stop_stream().ok();
    });

    let mut sink = WavSink::create(&path, format.sample_rate)?;
    let mut byte_buf: Vec<u8> = Vec::new();

    // Wall-clock instant at which this stream's first sample arrived. Gaps are
    // measured against this.
    //
    // An idle render endpoint delivers *no packets at all*, not silent ones.
    // Measured: 32s capture with audio at 0-3s and 24-29s produced a system
    // file only 11.16s long — the second burst landed at ~11s instead of ~24s.
    // Uncorrected, that desynchronises the transcripts completely.
    //
    // `BufferInfo.index` looks like the natural fix and is not: it counts
    // frames *delivered*, so it does not advance while the endpoint is idle
    // and reports no gap at all. `BufferInfo.timestamp` is a QPC value, but is
    // explicitly unreliable when the engine sets TIMESTAMP_ERROR. The session
    // clock is the one time source that always advances.
    let mut stream_start: Option<std::time::Instant> = None;

    // Only correct discrepancies larger than this. Wall clock and device clock
    // drift slightly against each other; padding every packet would chase that
    // drift and inject constant micro-gaps. Real idle gaps are seconds long.
    let gap_threshold_frames = u64::from(format.sample_rate) / 2; // 500 ms

    // Silence padded since the last block handed to the tap.
    let mut pending_silence: u64 = 0;

    while !stop.is_stopped() {
        // Drain every packet currently queued before waiting again.
        loop {
            let frames = match capture_client.get_next_packet_size() {
                Ok(Some(frames)) if frames > 0 => frames,
                // Ok(None) is exclusive mode, which loopback never is.
                Ok(_) => break,
                Err(e) => return Err(AudioError::Backend(format!("packet size: {e}"))),
            };

            let needed = frames as usize * source_channels as usize * 4; // f32
            byte_buf.resize(needed, 0);

            let (frames_read, _info) = capture_client
                .read_from_device(&mut byte_buf)
                .map_err(|e| AudioError::Backend(format!("read: {e}")))?;

            if frames_read == 0 {
                break;
            }

            // Loopback opens materially later than the microphone; this offset
            // is what lets the two files be aligned afterwards.
            stats.mark_first_sample(clock);

            // Fill any span the engine skipped, so that frame index stays
            // proportional to elapsed time and the file remains a faithful
            // timeline rather than a concatenation of the noisy parts.
            match stream_start {
                // First packet only establishes the baseline. Silence *before*
                // the stream started is carried by `start_offset_ms`, not by
                // padding, so that the file begins at real audio.
                None => stream_start = Some(std::time::Instant::now()),
                Some(started) => {
                    let elapsed_frames = (started.elapsed().as_millis() as u64)
                        .saturating_mul(u64::from(format.sample_rate))
                        / 1000;
                    let written = sink.frames_written();

                    if elapsed_frames > written.saturating_add(gap_threshold_frames) {
                        let gap = elapsed_frames - written;
                        sink.write_silence(gap)?;
                        stats
                            .silence_padded_frames
                            .fetch_add(gap, Ordering::Relaxed);

                        // The tap must know about the padding too, or a live
                        // consumer sees system audio as one unbroken run of
                        // speech with no gaps to split on and can only break at
                        // its length ceiling — measured as segments arriving up
                        // to 16s late. Carried as a count on the next block.
                        pending_silence += gap;
                    }
                }
            }

            let valid = frames_read as usize * source_channels as usize;
            let interleaved = bytes_to_f32(&byte_buf, valid);
            let mono = downmix_to_mono(&interleaved, source_channels);

            stats.record_level(&mono);
            sink.write(&mono)?;
            stats
                .frames_captured
                .fetch_add(mono.len() as u64, Ordering::Relaxed);

            // try_send: a backed-up consumer must not stall capture. The WAV
            // write above has already happened either way.
            if let Some(tap) = tap.as_ref() {
                let _ = tap.try_send(super::CapturedAudio {
                    source: super::StreamSource::System,
                    sample_rate: format.sample_rate,
                    samples: mono.clone(),
                    leading_silence_frames: std::mem::take(&mut pending_silence),
                    start_offset_ms: stats.start_offset_ms().unwrap_or(0),
                });
            }
        }

        // A timeout here is normal and expected: silence means no event.
        let _ = h_event.wait_for_event(EVENT_TIMEOUT_MS);
    }

    sink.finalize()?;
    Ok(format)
}

/// Reinterpret an interleaved little-endian f32 byte buffer as samples.
///
/// `count` is the number of *samples* known to be valid, which may be fewer
/// than the buffer holds — the buffer is reused across packets and is only
/// ever grown, so its tail is stale data from a previous, larger packet.
fn bytes_to_f32(bytes: &[u8], count: usize) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .take(count)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_little_endian_floats() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&1.0f32.to_le_bytes());
        bytes.extend_from_slice(&(-0.5f32).to_le_bytes());
        assert_eq!(bytes_to_f32(&bytes, 2), vec![1.0, -0.5]);
    }

    #[test]
    fn ignores_stale_tail_beyond_the_valid_count() {
        // The byte buffer is reused and only grows, so a short packet leaves
        // the previous packet's audio in the tail. Replaying it would inject
        // a stutter into the recording.
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&0.25f32.to_le_bytes());
        bytes.extend_from_slice(&9.0f32.to_le_bytes()); // stale
        assert_eq!(bytes_to_f32(&bytes, 1), vec![0.25]);
    }

    #[test]
    fn ignores_a_trailing_partial_sample() {
        let mut bytes = 1.0f32.to_le_bytes().to_vec();
        bytes.extend_from_slice(&[0x00, 0x01]); // 2 stray bytes
        assert_eq!(bytes_to_f32(&bytes, 4), vec![1.0]);
    }

    #[test]
    fn empty_buffer_yields_no_samples() {
        assert!(bytes_to_f32(&[], 8).is_empty());
    }
}
