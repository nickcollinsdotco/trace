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
pub mod windows;

use capture_manager::CaptureManager;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    diagnostics::install_panic_hook();
    diagnostics::log(format!("TRACE {} started", env!("CARGO_PKG_VERSION")));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    use tauri_plugin_global_shortcut::ShortcutState;
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    // From anywhere: the mini window. Never a stop —
                    // stopping by accident loses the end of a meeting
                    // (docs/13 Q21).
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = windows::open_mini(&app, windows::Open::Asked) {
                            diagnostics::log(format!("could not open the mini window: {e}"));
                        }
                    });
                })
                .build(),
        )
        // One meeting at a time, owned by the app rather than any window.
        .manage(CaptureManager::default())
        .manage(windows::MiniState::default())
        // Mark development builds in the title bar and taskbar, so a
        // `pnpm tauri dev` window is never mistaken for the installed app —
        // they share the notes folder, so recording into the wrong one is
        // easy and confusing. Set here rather than in `tauri.conf.json`,
        // which has no per-profile title.
        .setup(|app| {
            if cfg!(debug_assertions) {
                for window in app.webview_windows().values() {
                    window.set_title("TRACE (dev)")?;
                }
            }
            // The main window is created hidden, so it can be sized to the
            // screen before anyone sees it at the wrong size. It is shown
            // whether or not the sizing worked: a window that never appears
            // is far worse than one that opens too large.
            // Ctrl+Alt+R, the mini window from anywhere. Another app may own
            // the combination already; that costs the shortcut, not the app.
            {
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
                let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyR);
                if let Err(e) = app.global_shortcut().register(shortcut) {
                    diagnostics::log(format!("Ctrl+Alt+R is taken; no mini-window shortcut: {e}"));
                }
            }
            // The mini window opening by itself, as the setting says.
            windows::watch_main(app.handle());
            if let Some(main) = app.get_webview_window("main") {
                if let Err(e) = windows::fit_and_centre(&main, (1200.0, 840.0)) {
                    diagnostics::log(format!("could not size the main window: {e}"));
                }
                main.show()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_input_devices,
            commands::list_output_devices,
            commands::model_status,
            commands::install_model,
            commands::start_capture,
            commands::start_mic_preview,
            commands::stop_mic_preview,
            commands::mic_preview_level,
            commands::capture_status,
            commands::scope_frame,
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
            commands::open_gallery,
            commands::open_mini,
            commands::fit_mini,
            commands::protect_mini,
            commands::set_mini_auto,
            commands::close_mini,
            commands::show_main,
            commands::diagnostics_report,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TRACE");
}
