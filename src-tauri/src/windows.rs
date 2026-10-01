//! The app's windows: the main one's opening size, the gallery, and the
//! mini window.

use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, UserAttentionType, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};

/// Label of the gallery window. Also how the frontend knows to render it.
const GALLERY: &str = "gallery";

/// How much of the screen's work area a window may take when it opens.
///
/// The default sizes are chosen for a desktop monitor. On a small laptop
/// display they would open larger than the screen, with the title bar out of
/// reach, so the default gives way before the screen does.
const MAX_SHARE: f64 = 0.85;

/// The size to open at: the default, unless the work area is too small for it.
///
/// Pure, in logical pixels, so the arithmetic can be tested without a monitor.
pub fn fitted(default: (f64, f64), work_area: (f64, f64)) -> (f64, f64) {
    (
        default.0.min(work_area.0 * MAX_SHARE).round(),
        default.1.min(work_area.1 * MAX_SHARE).round(),
    )
}

/// Resize a window to its default, or less if the screen cannot fit it, and
/// centre it.
///
/// The window opens centred at the same size every time rather than where it
/// was left — a decision in docs/13-DESIGN-UPGRADES.md, not an omission.
pub fn fit_and_centre(window: &WebviewWindow, default: (f64, f64)) -> tauri::Result<()> {
    let monitor = match window.current_monitor()? {
        Some(m) => Some(m),
        None => window.primary_monitor()?,
    };
    if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let area = monitor.work_area().size;
        let (w, h) = fitted(
            default,
            (
                f64::from(area.width) / scale,
                f64::from(area.height) / scale,
            ),
        );
        window.set_size(LogicalSize::new(w, h))?;
    }
    window.center()
}

/// Open the gallery in a window of its own, or bring it forward if it is
/// already open.
///
/// Its own window rather than a route in the main one: the gallery installs
/// a fake backend for the whole page, so sharing a page with the real app
/// would put the app on fake data too.
///
/// It is left out of the capabilities file, which denies it core and plugin
/// APIs. That is not what keeps it off the real backend, though: Tauri lets
/// any window call the app's own commands unless an app manifest says
/// otherwise. The fake backend, installed before any screen mounts, is.
pub fn open_gallery(app: &AppHandle) -> tauri::Result<()> {
    if let Some(existing) = app.get_webview_window(GALLERY) {
        existing.unminimize()?;
        existing.show()?;
        return existing.set_focus();
    }

    let window =
        WebviewWindowBuilder::new(app, GALLERY, WebviewUrl::App("index.html#gallery".into()))
            .title(if cfg!(debug_assertions) {
                "TRACE gallery (dev)"
            } else {
                "TRACE gallery"
            })
            .min_inner_size(900.0, 600.0)
            .theme(Some(tauri::Theme::Dark))
            .visible(false)
            .build()?;
    fit_and_centre(&window, (1440.0, 920.0))?;
    window.show()?;
    window.set_focus()
}

/// Label of the mini window (CONTEXT.md). Also how the frontend knows to
/// render it.
pub const MINI: &str = "mini";

/// The mini window's size, in logical pixels: one bar, idle or recording, so
/// starting a meeting never makes it jump (docs/13, Stage 7). Fixed, never
/// freely resized.
const MINI_SIZE: (f64, f64) = (360.0, 56.0);

/// Where the mini window opens: against the right edge, in the lower third,
/// clear of title bars, close buttons and notifications (docs/13 Q19).
///
/// Pure, in logical pixels, so it can be tested without a monitor.
pub fn mini_spot(area: (f64, f64, f64, f64), size: (f64, f64)) -> (f64, f64) {
    let (x, y, w, h) = area;
    let margin = 16.0;
    (
        (x + w - size.0 - margin).round(),
        (y + h * 0.62).min(y + h - size.1 - margin).round(),
    )
}

/// Open the mini window, or bring it forward.
///
/// Created afresh each time and closed rather than hidden: on this Windows
/// build a window excluded from screen capture and then hidden and re-shown
/// comes back as a black rectangle to anyone watching a share (docs/13, the
/// mini-window research). Excluded from capture by default, because a
/// recording indicator is for the person recording, not the people on the
/// call.
pub fn open_mini(app: &AppHandle) -> tauri::Result<()> {
    if let Some(existing) = app.get_webview_window(MINI) {
        existing.unminimize()?;
        return existing.set_focus();
    }

    let size = MINI_SIZE;
    let window = WebviewWindowBuilder::new(app, MINI, WebviewUrl::App("index.html#mini".into()))
        .title("TRACE")
        .inner_size(size.0, size.1)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .content_protected(true)
        .shadow(true)
        .theme(Some(tauri::Theme::Dark))
        .visible(false)
        .build()?;

    // On the monitor the main window is on: that is where the user is.
    let monitor = app
        .get_webview_window("main")
        .and_then(|m| m.current_monitor().ok().flatten())
        .or(window.primary_monitor()?);
    if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let (x, y) = mini_spot(
            (
                f64::from(area.position.x) / scale,
                f64::from(area.position.y) / scale,
                f64::from(area.size.width) / scale,
                f64::from(area.size.height) / scale,
            ),
            size,
        );
        window.set_position(LogicalPosition::new(x, y))?;
    }
    window.show()?;
    window.set_focus()
}

/// The most the mini window may grow, so it stays a bar beside a call rather
/// than a second app.
const MINI_MAX: (f64, f64) = (640.0, 420.0);

/// The size the mini window takes for content that needs `wanted`: never
/// smaller than the bar, never larger than its cap.
pub fn mini_fit(wanted: (f64, f64)) -> (f64, f64) {
    (
        wanted.0.clamp(MINI_SIZE.0, MINI_MAX.0).round(),
        wanted.1.clamp(MINI_SIZE.1, MINI_MAX.1).round(),
    )
}

/// Resize the mini window to what it is showing, or bring it back to a bar.
///
/// It grows for three reasons: a theme in capitals or a wide typeface that
/// would otherwise wrap a line inside the 56px bar, the options menu, and
/// the details row. It always grows up and to the left, keeping its
/// bottom-right corner, so the bar itself never moves on the screen — it
/// lives against the right edge, usually pinned in a corner.
pub fn fit_mini(app: &AppHandle, wanted: (f64, f64)) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(MINI) else {
        return Ok(());
    };
    let scale = window.scale_factor()?;
    let (width, height) = mini_fit(wanted);
    let current = window.inner_size()?.to_logical::<f64>(scale);
    if (current.width - width).abs() < 1.0 && (current.height - height).abs() < 1.0 {
        return Ok(());
    }
    let at = window.outer_position()?.to_logical::<f64>(scale);
    window.set_size(LogicalSize::new(width, height))?;
    window.set_position(LogicalPosition::new(
        at.x + current.width - width,
        at.y + current.height - height,
    ))
}

/// Whether the mini window shows in screen shares. Hidden unless asked for
/// (docs/13 Q18); switched on the live window, never by hiding and showing
/// it, which is what blacks it out on this Windows build.
pub fn protect_mini(app: &AppHandle, hidden: bool) -> tauri::Result<()> {
    match app.get_webview_window(MINI) {
        Some(window) => window.set_content_protected(hidden),
        None => Ok(()),
    }
}

pub fn close_mini(app: &AppHandle) -> tauri::Result<()> {
    match app.get_webview_window(MINI) {
        Some(window) => window.close(),
        None => Ok(()),
    }
}

/// Bring the main window forward, opening a note in it if one is named.
///
/// After a stop from the mini window the user is usually in another app, so
/// rather than snatching focus, the taskbar button flashes until they come
/// back — and when they do, the note is already open.
pub fn show_main(
    app: &AppHandle,
    note_path: Option<String>,
    attention_only: bool,
) -> tauri::Result<()> {
    let Some(main) = app.get_webview_window("main") else {
        return Ok(());
    };
    if let Some(path) = note_path {
        app.emit_to("main", EVENT_OPEN_NOTE, path)?;
    }
    if attention_only {
        main.request_user_attention(Some(UserAttentionType::Informational))
    } else {
        main.unminimize()?;
        main.show()?;
        main.set_focus()
    }
}

/// Asks the main window to open a note.
pub const EVENT_OPEN_NOTE: &str = "trace://open-note";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_mini_window_sits_right_and_low() {
        // A 1920×1040 work area at the origin, the bar size.
        let (x, y) = mini_spot((0.0, 0.0, 1920.0, 1040.0), (360.0, 56.0));
        assert_eq!(x, 1920.0 - 360.0 - 16.0);
        assert_eq!(y, (1040.0_f64 * 0.62).round());
    }

    #[test]
    fn the_mini_window_grows_only_as_far_as_its_cap() {
        assert_eq!(mini_fit((200.0, 20.0)), (360.0, 56.0));
        assert_eq!(mini_fit((431.4, 180.2)), (431.0, 180.0));
        assert_eq!(mini_fit((5000.0, 5000.0)), (640.0, 420.0));
    }

    #[test]
    fn the_mini_window_never_hangs_off_a_short_screen() {
        let (_, y) = mini_spot((0.0, 0.0, 1366.0, 200.0), (360.0, 156.0));
        assert!(y + 156.0 <= 200.0);
    }

    #[test]
    fn a_big_screen_gets_the_default() {
        assert_eq!(fitted((1200.0, 840.0), (2560.0, 1400.0)), (1200.0, 840.0));
    }

    #[test]
    fn a_small_screen_caps_each_side_on_its_own() {
        // 1366×728 is a common laptop work area at 100%: wide enough for the
        // width, not for the height.
        assert_eq!(fitted((1200.0, 840.0), (1366.0, 728.0)), (1161.0, 619.0));
    }
}
