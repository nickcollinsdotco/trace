//! TRACE — local-first meeting capture.
//!
//! The Rust surface is kept deliberately small: audio capture, transcription,
//! persistence and the command bridge. Everything else is TypeScript.
//!
//! ```text
//! mic + system audio -> transcription -> journal -> Markdown
//!        (audio)          (transcribe)   (store)    (store)
//! ```

pub mod activity;
pub mod audio;
pub mod capture_manager;
pub mod commands;
pub mod diagnostics;
/// Meeting domain types. Distinct from `models`, which manages ASR model files.
pub mod meeting;
pub mod models;
pub mod settings;
pub mod store;
pub mod synthesis;
pub mod system;
pub mod transcribe;

use capture_manager::CaptureManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    diagnostics::install_panic_hook();
    diagnostics::log(format!("TRACE {} started", env!("CARGO_PKG_VERSION")));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        // One meeting at a time, owned by the app rather than any window.
        .manage(CaptureManager::default())
        // Mark development builds in the title bar and taskbar, so a
        // `pnpm tauri dev` window is never mistaken for the installed app —
        // they share the notes folder, so recording into the wrong one is
        // easy and confusing. Set here rather than in `tauri.conf.json`,
        // which has no per-profile title.
        .setup(|app| {
            if cfg!(debug_assertions) {
                use tauri::Manager;
                for window in app.webview_windows().values() {
                    window.set_title("TRACE (dev)")?;
                }
            }
            Ok(())
        })
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
            commands::regenerate_notes,
            commands::can_regenerate,
            commands::activity,
            commands::system_report,
            commands::get_settings,
            commands::set_audio_retention,
            commands::set_summary_memory,
            commands::set_default_mic,
            commands::speech_models,
            commands::set_speech_model,
            commands::delete_speech_model,
            commands::summary_models,
            commands::set_summary_model,
            commands::pull_summary_model,
            commands::open_folder,
            commands::abort_capture,
            commands::delete_note,
            commands::rename_note,
            commands::search_notes,
            commands::note_tags,
            commands::set_note_tags,
            commands::note_context,
            commands::set_note_context,
            commands::llm_status,
            commands::start_ollama,
            commands::app_info,
            commands::diagnostics_report,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TRACE");
}
