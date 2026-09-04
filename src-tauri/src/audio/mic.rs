//! Microphone capture via `cpal`.
//!
//! Threading model, which is the part that matters:
//!
//! ```text
//!   cpal realtime callback ──send()──> bounded channel ──recv()──> writer thread
//!        (never blocks)                (drops when full)          (does file I/O)
//! ```
//!
//! File I/O never happens inside the audio callback. A blocked callback means
//! dropped audio at the driver level, which is unrecoverable; a full channel
//! means we drop a chunk we know about and can report. The channel is bounded
//! for the same reason the WAV sink streams: nothing in the capture path may
//! grow without limit over a two-hour meeting.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use crossbeam_channel::{bounded, TrySendError};

use super::wav::WavSink;
use super::{downmix_to_mono, AudioError, StopSignal, StreamFormat, StreamStats};

/// Chunks the writer may fall behind by before we start dropping audio.
///
/// At a typical ~10 ms callback this is roughly two seconds of slack — enough
/// to ride out a disk stall, small enough that a genuinely stuck writer is
/// caught quickly rather than silently consuming memory.
const CHANNEL_CAPACITY: usize = 200;

/// Capture the default input device until `stop` is signalled.
///
/// Blocks the calling thread, so run it on a dedicated one. `cpal::Stream` is
/// not `Send` on every platform, so it is created and dropped here rather than
/// handed anywhere else.
/// Capture the microphone until `stop` is signalled.
///
/// `preferred` selects a device by name; `None` uses the system default.
/// Device choice is not a nicety. On this machine the default input is
/// "Microphone (NVIDIA Broadcast)", a virtual endpoint that returns *exact
/// digital silence* when its host app is not processing — a recording that
/// succeeds, reports the right duration, and contains nothing. Users with
/// VoiceMeeter, VB-Cable or similar hit the same trap.
pub fn run_capture(
    path: PathBuf,
    stats: Arc<StreamStats>,
    stop: StopSignal,
    clock: Instant,
    preferred: Option<String>,
) -> Result<StreamFormat, AudioError> {
    let host = cpal::default_host();

    let device = match preferred {
        Some(wanted) => host
            .input_devices()
            .ok()
            .and_then(|mut devices| devices.find(|d| d.to_string() == wanted))
            // Falling back to the default would silently ignore an explicit
            // choice; if the named device is gone the user must be told.
            .ok_or(AudioError::NoDevice("named microphone"))?,
        None => host
            .default_input_device()
            .ok_or(AudioError::NoDevice("microphone"))?,
    };

    let supported = device
        .default_input_config()
        .map_err(|e| AudioError::Config(e.to_string()))?;

    let device_name = device.to_string();

    let sample_format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    let source_channels = config.channels;
    let format = StreamFormat {
        sample_rate: config.sample_rate,
        source_channels,
        device_name,
    };

    let (tx, rx) = bounded::<Vec<f32>>(CHANNEL_CAPACITY);

    let cb_stats = Arc::clone(&stats);
    let err_stats = Arc::clone(&stats);

    // The callback does three cheap things: downmix, measure, hand off. No
    // allocation-free guarantee here (downmix allocates), but no I/O and no
    // lock that another thread can hold for an unbounded time.
    let send_chunk = move |samples: &[f32]| {
        // Stamped in the callback, not the writer loop, so the offset reflects
        // when audio actually reached us rather than when we got round to it.
        cb_stats.mark_first_sample(clock);
        let mono = downmix_to_mono(samples, source_channels);
        cb_stats.record_level(&mono);
        if let Err(TrySendError::Full(_)) = tx.try_send(mono) {
            cb_stats
                .chunks_dropped
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
    };

    let error_callback = move |err| {
        // A device error mid-meeting is real and must not be swallowed. The
        // dropped-chunk counter is the channel the UI already watches.
        eprintln!("trace: microphone stream error: {err}");
        err_stats
            .chunks_dropped
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    };

    let stream = build_stream(&device, config, sample_format, send_chunk, error_callback)?;
    stream
        .play()
        .map_err(|e| AudioError::Backend(e.to_string()))?;

    let mut sink = WavSink::create(&path, format.sample_rate)?;

    // Drain until stopped, then drain whatever the callback already queued so
    // the tail of the meeting is not truncated.
    while !stop.is_stopped() {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(chunk) => write_chunk(&mut sink, &chunk, &stats)?,
            Err(crossbeam_channel::RecvTimeoutError::Timeout) => continue,
            Err(crossbeam_channel::RecvTimeoutError::Disconnected) => break,
        }
    }

    drop(stream); // stop the device before draining, so the queue is finite
    while let Ok(chunk) = rx.try_recv() {
        write_chunk(&mut sink, &chunk, &stats)?;
    }

    sink.finalize()?;
    Ok(format)
}

fn write_chunk(sink: &mut WavSink, chunk: &[f32], stats: &StreamStats) -> Result<(), AudioError> {
    sink.write(chunk)?;
    stats
        .frames_captured
        .fetch_add(chunk.len() as u64, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

/// Build an input stream for whichever sample format the device negotiated.
///
/// Devices do not all speak f32. Assuming they do is a silent-recording bug:
/// Voicebox's Windows path only converts when `bytes_per_sample == 4` and
/// discards everything otherwise. Each supported format is converted to f32
/// here; anything unsupported fails loudly at start, not quietly at playback.
fn build_stream<F, E>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    sample_format: cpal::SampleFormat,
    mut on_samples: F,
    error_callback: E,
) -> Result<cpal::Stream, AudioError>
where
    F: FnMut(&[f32]) + Send + 'static,
    E: FnMut(cpal::Error) + Send + 'static,
{
    use cpal::SampleFormat as SF;

    let build_err = |e: cpal::Error| AudioError::BuildStream(e.to_string());

    match sample_format {
        SF::F32 => device
            .build_input_stream(
                config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| on_samples(data),
                error_callback,
                None,
            )
            .map_err(build_err),
        SF::I16 => device
            .build_input_stream(
                config,
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    let converted: Vec<f32> =
                        data.iter().map(|&s| s as f32 / i16::MAX as f32).collect();
                    on_samples(&converted);
                },
                error_callback,
                None,
            )
            .map_err(build_err),
        SF::U16 => device
            .build_input_stream(
                config,
                move |data: &[u16], _: &cpal::InputCallbackInfo| {
                    // u16 is unsigned with 32768 as silence.
                    let converted: Vec<f32> = data
                        .iter()
                        .map(|&s| (s as f32 - 32_768.0) / 32_768.0)
                        .collect();
                    on_samples(&converted);
                },
                error_callback,
                None,
            )
            .map_err(build_err),
        other => Err(AudioError::Config(format!(
            "unsupported sample format {other:?}"
        ))),
    }
}
