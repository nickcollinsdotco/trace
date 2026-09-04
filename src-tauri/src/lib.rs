//! TRACE — local-first meeting capture.
//!
//! The Rust surface is kept deliberately small: audio capture, transcription,
//! LLM FFI and file writes. Everything else is TypeScript. See the architecture
//! plan — the goal is a small, well-made instrument, not a Rust application
//! with a web skin.
//!
//! Module layout arrives with its milestone rather than up front, so this file
//! grows one `mod` at a time:
//!   M1  audio      — cpal microphone + wasapi loopback, two independent streams
//!   M2  transcribe — transcribe-rs (Parakeet default)
//!   M3  transcribe::chunker — VAD-driven streaming
//!   M4  store      — session journal, Markdown, atomic writes
//!   M6  llm        — LlmProvider trait, Ollama implementation

/// Smoke-test command, so the IPC bridge is proven end to end before any real
/// capability depends on it. Replaced by `commands.rs` in M1.
#[tauri::command]
fn ping() -> &'static str {
    "trace"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .invoke_handler(tauri::generate_handler![ping])
        .run(tauri::generate_context!())
        .expect("error while running TRACE");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_returns_identity() {
        assert_eq!(ping(), "trace");
    }
}
