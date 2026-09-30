//! The app's windows: the main one's opening size, and the gallery.

use tauri::{AppHandle, LogicalSize, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

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

#[cfg(test)]
mod tests {
    use super::*;

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
