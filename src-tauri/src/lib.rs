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
pub mod awake;
pub mod busy;
pub mod capture_manager;
pub mod commands;
pub mod diagnostics;
/// Meeting domain types. Distinct from `models`, which manages ASR model files.
pub mod meeting;
pub mod memory;
pub mod models;
pub mod notes_location;
pub mod notify;
pub mod settings;
pub mod store;
pub mod synthesis;
pub mod system;
pub mod transcribe;
pub mod update;
pub mod upgrade;
pub mod windows;

use capture_manager::CaptureManager;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    diagnostics::install_panic_hook();
    diagnostics::log(format!("TRACE {} started", env!("CARGO_PKG_VERSION")));

    // Before creating webviews: no command or background job can observe a
    // half-copied library. Test roots never read or write the real preference.
    let notes_lock = if std::env::var_os("TRACE_NOTES_ROOT").is_none() {
        notes_location::initialise().map(Some)
    } else {
        Ok(None)
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
        .manage(update::Pending::default())
        // Mark development builds in the title bar and taskbar, so a
        // `pnpm tauri dev` window is never mistaken for the installed app —
        // they share the notes folder, so recording into the wrong one is
        // easy and confusing. Set here rather than in `tauri.conf.json`,
        // which has no per-profile title.
        .setup(move |app| {
            // Holding this until exit prevents a second instance writing notes
            // while the next launch copies them.
            match notes_lock {
                Ok(Some(lock)) => {
                    app.manage(lock);
                }
                Ok(None) => (),
                Err(error) => {
                    use tauri_plugin_dialog::DialogExt;
                    let handle = app.handle().clone();
                    app.dialog()
                        .message(&error)
                        .title("TRACE could not open the notes folder")
                        .kind(tauri_plugin_dialog::MessageDialogKind::Error)
                        .show(move |_| handle.exit(1));
                    return Ok(());
                }
            }
            // Before the page asks what can be recovered, which reads them.
            app.state::<CaptureManager>().move_old_sessions();
            // Configured windows are not created automatically: even a hidden
            // webview mounts the frontend and can invoke data-changing commands.
            // Only the process holding the notes lock may start that frontend.
            for config in &app.config().app.windows {
                tauri::WebviewWindowBuilder::from_config(app, config)?.build()?;
            }
            if cfg!(debug_assertions) {
                for window in app.webview_windows().values() {
                    window.set_title("TRACE (dev)")?;
                }
            }
            // The mini window from anywhere, by the shortcut in Settings.
            windows::register_shortcut(app.handle());
            // Always there while TRACE runs, so it can be seen to be running.
            if let Err(e) = windows::install_tray(app.handle()) {
                diagnostics::log(format!("could not add the tray icon: {e}"));
            }
            // The mini window opening by itself, as the setting says.
            windows::watch_main(app.handle());
            // Interim notes rewritten while nobody is using the machine.
            upgrade::watch(app.handle().clone());
            // The main window is created hidden, so it can be sized to the
            // screen before anyone sees it at the wrong size. It is shown
            // whether or not the sizing worked: a window that never appears
            // is far worse than one that opens too large.
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
            commands::capture_notes,
            commands::set_title,
            commands::stop_capture,
            commands::pause_capture,
            commands::resume_capture,
            commands::list_notes,
            commands::read_note,
            commands::notes_root,
            commands::notes_folder_status,
            commands::choose_notes_folder,
            commands::schedule_notes_folder,
            commands::recoverable_sessions,
            commands::recover_session,
            commands::discard_session,
            commands::interrupted_notes,
            commands::resume_notes,
            commands::dismiss_interrupted,
            commands::memory_wait_choice,
            commands::stop_notes,
            commands::reveal_notes_folder,
            commands::regenerate_notes,
            commands::summary_room,
            commands::can_regenerate,
            commands::note_edited,
            commands::activity,
            commands::system_report,
            commands::get_settings,
            commands::set_audio_retention,
            commands::audio_beyond_retention,
            commands::release_audio_beyond_retention,
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
            commands::reveal_note,
            commands::search_notes,
            commands::note_tags,
            commands::set_note_tags,
            commands::note_context,
            commands::set_note_context,
            commands::llm_status,
            commands::start_ollama,
            commands::open_link,
            commands::app_info,
            commands::check_for_update,
            commands::install_update,
            commands::open_gallery,
            commands::open_mini,
            commands::fit_mini,
            commands::mini_ready,
            commands::protect_mini,
            commands::set_mini_auto,
            commands::set_close_action,
            commands::set_mini_shortcut,
            commands::reset_mini,
            commands::close_mini,
            commands::show_main,
            commands::diagnostics_report,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TRACE");
}

#[cfg(test)]
mod startup_tests {
    #[test]
    fn the_shipped_configuration_cannot_start_webviews_before_the_notes_lock() {
        let context: tauri::Context<tauri::Wry> = tauri::generate_context!();
        let windows = &context.config().app.windows;
        assert!(
            !windows.is_empty(),
            "the successful startup still needs a window"
        );
        assert!(
            windows.iter().all(|window| !window.create),
            "automatic webviews run IPC before setup can reject an unlocked process"
        );
    }
}
