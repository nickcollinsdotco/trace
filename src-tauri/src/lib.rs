//! TRACE — local-first meeting capture.
//!
//! The Rust surface is kept deliberately small: audio capture, transcription,
//! persistence and the command bridge. Everything else is TypeScript.
//!
//! ```text
//! mic + system audio -> transcription -> journal -> Markdown
//!        (audio)          (transcribe)   (store)    (store)
//! ```

pub mod audio;
pub mod capture_manager;
pub mod commands;
/// Meeting domain types. Distinct from `models`, which manages ASR model files.
pub mod meeting;
pub mod models;
pub mod store;
pub mod transcribe;

use capture_manager::CaptureManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        // One meeting at a time, owned by the app rather than any window.
        .manage(CaptureManager::default())
        .invoke_handler(tauri::generate_handler![
            commands::list_input_devices,
            commands::list_output_devices,
            commands::model_status,
            commands::install_model,
            commands::start_capture,
            commands::capture_status,
            commands::update_notes,
            commands::set_title,
            commands::stop_capture,
            commands::list_notes,
            commands::read_note,
            commands::notes_root,
            commands::recoverable_sessions,
            commands::recover_session,
            commands::discard_session,
            commands::reveal_notes_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TRACE");
}
