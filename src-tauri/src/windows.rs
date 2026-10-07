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

/// How the mini window is being opened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Open {
    /// Asked for: the sidebar, the palette, the shortcut. Takes focus, so a
    /// name can be typed at once.
    Asked,
    /// By itself, because TRACE was left during a meeting. Never takes focus:
    /// the user has just switched to their call, and pulling them back out
    /// of it would be exactly the wrong thing.
    Auto,
    /// The one-time offer (docs/13 Q16): the same, with a line asking
    /// whether it should do this every time.
    Offer,
}

/// What the app remembers about the mini window while it runs.
#[derive(Default)]
pub struct MiniState {
    inner: std::sync::Mutex<MiniInner>,
    /// Held for the whole of a resize or a settle. Fits arrive as commands
    /// that run at once on different threads, and Windows applies a move or
    /// a resize later than asked (tao posts them asynchronously): one fit
    /// read the size from before another's resize and the position from
    /// after its move, and the window crept up by the menu's height.
    turn: std::sync::Mutex<()>,
}

#[derive(Default)]
struct MiniInner {
    /// Opened by itself, so coming back to TRACE may close it again.
    auto: bool,
    /// The setting, kept here so focus changes do not read the disk.
    mode: Option<crate::settings::MiniAuto>,
    /// Bumped by every move; a settle only acts if no move followed it.
    moves: u64,
    /// The logical size last asked for by what the window shows. Held here
    /// because Windows rescales a window that crosses between monitors of
    /// different scaling, and nothing in the page notices: between a 100%
    /// and a 150% screen it lost a third of its height each crossing, until
    /// it was gone. Settling puts this size back.
    wanted: Option<(f64, f64)>,
    /// The bottom-right corner the window is anchored to, in logical pixels.
    /// Every resize is placed from this rather than from where the window
    /// seems to be at that instant, which may be a move not yet applied. Set
    /// where TRACE puts the window, and where a drag leaves it.
    corner: Option<(f64, f64)>,
    /// Asked for, so it takes focus once it is shown.
    focus_on_show: bool,
}

impl MiniState {
    fn with<T>(&self, f: impl FnOnce(&mut MiniInner) -> T) -> T {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        f(&mut guard)
    }

    fn turn(&self) -> std::sync::MutexGuard<'_, ()> {
        self.turn.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// Where a window of `size` sits to keep its bottom-right at `corner`.
pub fn from_corner(corner: (f64, f64), size: (f64, f64)) -> (f64, f64) {
    ((corner.0 - size.0).round(), (corner.1 - size.1).round())
}

fn mode(app: &AppHandle) -> crate::settings::MiniAuto {
    let state = app.state::<MiniState>();
    if let Some(mode) = state.with(|s| s.mode) {
        return mode;
    }
    let mode = crate::settings::load().mini_auto;
    state.with(|s| s.mode = Some(mode));
    mode
}

/// The setting changed: keep the copy here in step with the file.
pub fn remember_auto(app: &AppHandle, mode: crate::settings::MiniAuto) {
    app.state::<MiniState>().with(|s| s.mode = Some(mode));
}

/// Open the mini window, or bring it forward.
///
/// Created afresh each time and closed rather than hidden: on this Windows
/// build a window excluded from screen capture and then hidden and re-shown
/// comes back as a black rectangle to anyone watching a share (docs/13, the
/// mini-window research). Excluded from capture by default, because a
/// recording indicator is for the person recording, not the people on the
/// call.
pub fn open_mini(app: &AppHandle, how: Open) -> tauri::Result<()> {
    let state = app.state::<MiniState>();
    if let Some(existing) = app.get_webview_window(MINI) {
        if how == Open::Asked {
            // Asked for now, so it is no longer the automatic one.
            state.with(|s| s.auto = false);
            existing.unminimize()?;
            // Asked for because it cannot be seen, quite possibly: whatever
            // left it off every screen or shrunk to nothing, asking for it
            // brings it back.
            let _turn = state.turn();
            keep_size(app, &existing)?;
            if !reachable(&existing)? {
                place_default(app, &existing)?;
            }
            existing.set_focus()?;
        }
        return Ok(());
    }

    let url = if how == Open::Offer {
        "index.html#mini/offer"
    } else {
        "index.html#mini"
    };
    let size = MINI_SIZE;
    let window = WebviewWindowBuilder::new(app, MINI, WebviewUrl::App(url.into()))
        .title("TRACE")
        .inner_size(size.0, size.1)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .content_protected(true)
        // See-through, so the menu floats over whatever is behind it rather
        // than on a band of window (docs/13, phase 6); the page draws the
        // bar's frame itself. No system shadow: Windows draws it round the
        // whole rectangle, outlining the empty part too.
        .transparent(true)
        .shadow(false)
        .focused(how == Open::Asked)
        .theme(Some(tauri::Theme::Dark))
        .visible(false)
        .build()?;
    state.with(|s| {
        s.auto = how != Open::Asked;
        s.wanted = None;
        s.corner = None;
    });

    // On the monitor the main window is on: that is where the user is. Where
    // it was last left on that monitor, if it was, and the spot still lies
    // on the screen; otherwise against the right edge, in the lower third.
    if let Some(monitor) = main_monitor(app, &window)? {
        let area = logical_area(&monitor);
        let name = monitor.name().cloned().unwrap_or_default();
        let saved = crate::settings::load().mini_places;
        let (x, y) = remembered(&saved, &name, area, size).unwrap_or_else(|| mini_spot(area, size));
        window.set_position(LogicalPosition::new(x, y))?;
        state.with(|s| s.corner = Some((x + size.0, y + size.1)));
    }

    // Snap, restore its size, and remember the place once a drag has come
    // to rest — including a drag onto a screen with different scaling.
    let handle = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Moved(_) | tauri::WindowEvent::ScaleFactorChanged { .. } = event
        {
            settle_later(&handle);
        }
    });

    // Shown once the page has sized it (`reveal_mini`), not now: shown at
    // once, it appeared at the bar's default size, empty, and then jumped to
    // fit what it held. A page that never says so is shown anyway.
    state.with(|s| s.focus_on_show = how == Open::Asked);
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(REVEAL_FALLBACK_MS));
        if let Err(e) = reveal_mini(&handle) {
            crate::diagnostics::log(format!("could not show the mini window: {e}"));
        }
    });
    Ok(())
}

/// How long the mini window waits for its page before showing regardless.
const REVEAL_FALLBACK_MS: u64 = 1_500;

/// Show the mini window, once its page has sized it. Waits a moment for the
/// resize to land first: Windows applies it later than asked, and showing
/// sooner showed the jump this exists to hide. Does nothing if it is shown.
pub fn reveal_mini(app: &AppHandle) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(MINI) else {
        return Ok(());
    };
    if window.is_visible()? {
        return Ok(());
    }
    let state = app.state::<MiniState>();
    {
        let _turn = state.turn();
        let wanted = state.with(|s| s.wanted).unwrap_or(MINI_SIZE);
        for _ in 0..10 {
            let scale = window.scale_factor()?;
            let size = window.inner_size()?.to_logical::<f64>(scale);
            if (size.width - wanted.0).abs() < 1.0 && (size.height - wanted.1).abs() < 1.0 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }
    window.show()?;
    if state.with(|s| std::mem::take(&mut s.focus_on_show)) {
        window.set_focus()?;
    }
    Ok(())
}

/// The monitor the main window is on, where the user is; else the primary.
fn main_monitor(app: &AppHandle, window: &WebviewWindow) -> tauri::Result<Option<tauri::Monitor>> {
    Ok(app
        .get_webview_window("main")
        .and_then(|m| m.current_monitor().ok().flatten())
        .or(window.primary_monitor()?))
}

/// Put the window back to the size its content asked for, keeping its
/// bottom-right corner, if Windows has rescaled it since. The caller holds
/// the turn.
fn keep_size(app: &AppHandle, window: &WebviewWindow) -> tauri::Result<()> {
    let wanted = app
        .state::<MiniState>()
        .with(|s| s.wanted)
        .unwrap_or(MINI_SIZE);
    resize_from_corner(app, window, wanted)
}

/// Size the window, keeping its bottom-right corner where it is anchored.
/// The caller holds the turn.
fn resize_from_corner(
    app: &AppHandle,
    window: &WebviewWindow,
    (width, height): (f64, f64),
) -> tauri::Result<()> {
    let state = app.state::<MiniState>();
    let scale = window.scale_factor()?;
    let current = window.inner_size()?.to_logical::<f64>(scale);
    let at = window.outer_position()?.to_logical::<f64>(scale);
    // No corner yet only before the window was ever placed: then where it is
    // now is the best there is.
    let corner = state
        .with(|s| s.corner)
        .unwrap_or((at.x + current.width, at.y + current.height));
    state.with(|s| s.corner = Some(corner));
    let (x, y) = from_corner(corner, (width, height));
    let sized = (current.width - width).abs() < 1.0 && (current.height - height).abs() < 1.0;
    if sized && (at.x - x).abs() < 1.0 && (at.y - y).abs() < 1.0 {
        return Ok(());
    }
    window.set_size(LogicalSize::new(width, height))?;
    window.set_position(LogicalPosition::new(x, y))
}

/// Whether the window can be found: its middle on some screen's work area.
/// In physical pixels, which every monitor shares whatever its scaling.
pub fn on_some_screen(window: (i32, i32, u32, u32), areas: &[(i32, i32, u32, u32)]) -> bool {
    let (x, y, w, h) = window;
    let (cx, cy) = (
        i64::from(x) + i64::from(w) / 2,
        i64::from(y) + i64::from(h) / 2,
    );
    areas.iter().any(|&(ax, ay, aw, ah)| {
        let (ax, ay) = (i64::from(ax), i64::from(ay));
        cx >= ax && cy >= ay && cx < ax + i64::from(aw) && cy < ay + i64::from(ah)
    })
}

fn reachable(window: &WebviewWindow) -> tauri::Result<bool> {
    let at = window.outer_position()?;
    let size = window.outer_size()?;
    let areas: Vec<_> = window
        .available_monitors()?
        .iter()
        .map(|m| {
            let a = m.work_area();
            (a.position.x, a.position.y, a.size.width, a.size.height)
        })
        .collect();
    Ok(on_some_screen(
        (at.x, at.y, size.width, size.height),
        &areas,
    ))
}

/// The default spot, on the screen the main window is on.
fn place_default(app: &AppHandle, window: &WebviewWindow) -> tauri::Result<()> {
    let Some(monitor) = main_monitor(app, window)? else {
        return Ok(());
    };
    let size = app
        .state::<MiniState>()
        .with(|s| s.wanted)
        .unwrap_or(MINI_SIZE);
    let (x, y) = mini_spot(logical_area(&monitor), size);
    app.state::<MiniState>()
        .with(|s| s.corner = Some((x + size.0, y + size.1)));
    window.set_position(LogicalPosition::new(x, y))
}

/// Forget where the mini window was left on every screen, and bring it to
/// the default spot — opening it there if it was closed. The way back from
/// anywhere it was lost to.
pub fn reset_mini(app: &AppHandle) -> tauri::Result<()> {
    let _ = crate::settings::update(|s| s.mini_places.clear());
    let Some(window) = app.get_webview_window(MINI) else {
        return open_mini(app, Open::Asked);
    };
    {
        let state = app.state::<MiniState>();
        let _turn = state.turn();
        keep_size(app, &window)?;
        place_default(app, &window)?;
    }
    window.unminimize()?;
    window.show()?;
    window.set_focus()
}

fn logical_area(monitor: &tauri::Monitor) -> (f64, f64, f64, f64) {
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    (
        f64::from(area.position.x) / scale,
        f64::from(area.position.y) / scale,
        f64::from(area.size.width) / scale,
        f64::from(area.size.height) / scale,
    )
}

/// Where the mini window was left on a monitor, if anywhere, and if that
/// spot is still wholly on the screen — a monitor rearranged or resized
/// since must not leave the window out of reach.
pub fn remembered(
    places: &[crate::settings::MiniPlace],
    monitor: &str,
    area: (f64, f64, f64, f64),
    size: (f64, f64),
) -> Option<(f64, f64)> {
    let place = places.iter().find(|p| p.monitor == monitor)?;
    let (x, y) = (place.right - size.0, place.bottom - size.1);
    let (ax, ay, aw, ah) = area;
    let inside = x >= ax && y >= ay && place.right <= ax + aw && place.bottom <= ay + ah;
    inside.then_some((x.round(), y.round()))
}

/// How near an edge counts as meaning it, and how far from it to sit.
const SNAP_REACH: f64 = 28.0;
const SNAP_MARGIN: f64 = 16.0;

/// Where a window at `at` comes to rest: against an edge it was dropped
/// near, at the same margin the default spot keeps; otherwise where it is.
pub fn snapped(at: (f64, f64), size: (f64, f64), area: (f64, f64, f64, f64)) -> (f64, f64) {
    let (ax, ay, aw, ah) = area;
    let (mut x, mut y) = at;
    if x - ax < SNAP_REACH {
        x = ax + SNAP_MARGIN;
    } else if ax + aw - (x + size.0) < SNAP_REACH {
        x = ax + aw - size.0 - SNAP_MARGIN;
    }
    if y - ay < SNAP_REACH {
        y = ay + SNAP_MARGIN;
    } else if ay + ah - (y + size.1) < SNAP_REACH {
        y = ay + ah - size.1 - SNAP_MARGIN;
    }
    (x.round(), y.round())
}

/// A drag sends a stream of moves; act only once it has stopped.
fn settle_later(app: &AppHandle) {
    let state = app.state::<MiniState>();
    let this = state.with(|s| {
        s.moves += 1;
        s.moves
    });
    let app = app.clone();
    // A thread rather than a timer on the async runtime: it only sleeps, and
    // Tauri's window calls are safe from any thread.
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(350));
        let latest = app.state::<MiniState>().with(|s| s.moves);
        if latest == this {
            if let Err(e) = settle(&app) {
                crate::diagnostics::log(format!("could not settle the mini window: {e}"));
            }
        }
    });
}

/// Snap to an edge if it was dropped near one, and remember the place.
fn settle(app: &AppHandle) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(MINI) else {
        return Ok(());
    };
    let Some(monitor) = window.current_monitor()? else {
        return Ok(());
    };
    let state = app.state::<MiniState>();
    let _turn = state.turn();
    // Where the window has come to rest is now its corner: a drag moved it,
    // or TRACE did and this agrees. Read from where it is and the size it
    // should be, not the size it reports — Windows may have rescaled it on
    // the way to a screen of different scaling, which keep_size undoes.
    let scale = window.scale_factor()?;
    let at = window.outer_position()?.to_logical::<f64>(scale);
    let current = window.inner_size()?.to_logical::<f64>(scale);
    let size = state.with(|s| s.wanted).unwrap_or(MINI_SIZE);
    state.with(|s| s.corner = Some((at.x + current.width, at.y + current.height)));
    keep_size(app, &window)?;
    let (left, top) = from_corner((at.x + current.width, at.y + current.height), size);
    let (x, y) = snapped((left, top), size, logical_area(&monitor));
    if (x - left).abs() >= 1.0 || (y - top).abs() >= 1.0 {
        state.with(|s| s.corner = Some((x + size.0, y + size.1)));
        window.set_position(LogicalPosition::new(x, y))?;
    }
    let name = monitor.name().cloned().unwrap_or_default();
    let place = crate::settings::MiniPlace {
        monitor: name.clone(),
        right: x + size.0,
        bottom: y + size.1,
    };
    let _ = crate::settings::update(|s| {
        s.mini_places.retain(|p| p.monitor != name);
        s.mini_places.push(place);
    });
    Ok(())
}

/// What a change in the main window means for the mini window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trigger {
    Minimised,
    LostFocus,
    MeetingStarted,
}

/// Whether, and how, the mini window should open by itself. Pure, so the
/// rules can be tested without windows.
pub fn auto_open(
    mode: crate::settings::MiniAuto,
    trigger: Trigger,
    recording: bool,
    offered: bool,
) -> Option<Open> {
    use crate::settings::MiniAuto::{Always, Minimised, Off, SwitchAway};
    if !recording {
        return None;
    }
    match (mode, trigger) {
        // Asked once, the first time TRACE is minimised during a meeting.
        (Off, Trigger::Minimised) if !offered => Some(Open::Offer),
        (Off, _) => None,
        (Minimised, Trigger::Minimised) => Some(Open::Auto),
        (SwitchAway, Trigger::Minimised | Trigger::LostFocus) => Some(Open::Auto),
        (Always, _) => Some(Open::Auto),
        _ => None,
    }
}

/// React to the main window being left during a meeting, or a meeting
/// starting, as the setting says.
pub fn on_trigger(app: &AppHandle, trigger: Trigger) {
    let recording = app
        .state::<crate::capture_manager::CaptureManager>()
        .status()
        .is_some();
    let offered = if mode(app) == crate::settings::MiniAuto::Off {
        crate::settings::load().mini_offered
    } else {
        true
    };
    let Some(how) = auto_open(mode(app), trigger, recording, offered) else {
        return;
    };
    if how == Open::Offer {
        // Offered once, whatever the answer: a question asked every time is
        // the nagging the setting exists to avoid.
        let _ = crate::settings::update(|s| s.mini_offered = true);
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = open_mini(&app, how) {
            crate::diagnostics::log(format!("could not open the mini window: {e}"));
        }
    });
}

/// Back in TRACE: a mini window that opened by itself has done its job, and
/// two of the same meeting on screen would only compete (docs/13 Q16). One
/// that was asked for, or "always" set, stays.
pub fn on_return(app: &AppHandle) {
    let auto = app.state::<MiniState>().with(|s| s.auto);
    if auto && mode(app) != crate::settings::MiniAuto::Always {
        let _ = close_mini(app);
    }
}

/// Watch the main window for being minimised, left or returned to.
pub fn watch_main(app: &AppHandle) {
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let handle = app.clone();
    let watched = main.clone();
    main.on_window_event(move |event| match event {
        tauri::WindowEvent::Focused(true) => on_return(&handle),
        tauri::WindowEvent::Focused(false) => {
            // Minimising also takes focus away; tell the two apart.
            let minimised = watched.is_minimized().unwrap_or(false);
            on_trigger(
                &handle,
                if minimised {
                    Trigger::Minimised
                } else {
                    Trigger::LostFocus
                },
            );
        }
        tauri::WindowEvent::Resized(_) if watched.is_minimized().unwrap_or(false) => {
            on_trigger(&handle, Trigger::Minimised);
        }
        _ => {}
    });
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
    let size = mini_fit(wanted);
    let state = app.state::<MiniState>();
    let _turn = state.turn();
    state.with(|s| s.wanted = Some(size));
    resize_from_corner(app, &window, size)
}

/// Whether the shortcut failed to register: another app holds it.
static SHORTCUT_TAKEN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn shortcut_taken() -> bool {
    SHORTCUT_TAKEN.load(std::sync::atomic::Ordering::Relaxed)
}

/// Whether a shortcut is one a user can have: it parses, and it holds Ctrl,
/// Alt or the Windows key. Shift alone is typing — Shift+M taken globally
/// would make capital Ms impossible in every other app.
pub fn usable_shortcut(shortcut: &str) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{Modifiers, Shortcut};
    let parsed: Shortcut = shortcut
        .parse()
        .map_err(|_| format!("{shortcut} is not a key combination"))?;
    if !parsed
        .mods
        .intersects(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER)
    {
        return Err("hold Ctrl, Alt or the Windows key with it".into());
    }
    Ok(())
}

/// Register the mini window's shortcut at startup. One that another app
/// holds costs the shortcut, never the app; Settings says so.
pub fn register_shortcut(app: &AppHandle) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let shortcut = crate::settings::load().mini_shortcut();
    if shortcut.is_empty() {
        return;
    }
    if let Err(e) = app.global_shortcut().register(shortcut.as_str()) {
        SHORTCUT_TAKEN.store(true, std::sync::atomic::Ordering::Relaxed);
        crate::diagnostics::log(format!("{shortcut} is taken; no mini-window shortcut: {e}"));
    }
}

/// Swap the shortcut for another, or for none. The new one is registered
/// before the old is let go for good, so a taken combination leaves the
/// working one in place rather than leaving none.
pub fn change_shortcut(app: &AppHandle, next: &str) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let next = next.trim();
    if !next.is_empty() {
        usable_shortcut(next)?;
    }
    let old = crate::settings::load().mini_shortcut();
    if next == old && !shortcut_taken() {
        return Ok(());
    }
    let shortcuts = app.global_shortcut();
    if !old.is_empty() && shortcuts.is_registered(old.as_str()) {
        shortcuts
            .unregister(old.as_str())
            .map_err(|e| e.to_string())?;
    }
    if !next.is_empty() {
        if let Err(e) = shortcuts.register(next) {
            if !old.is_empty() && !shortcut_taken() {
                let _ = shortcuts.register(old.as_str());
            }
            crate::diagnostics::log(format!("{next} is taken: {e}"));
            return Err(format!("{next} is already used by another app"));
        }
    }
    SHORTCUT_TAKEN.store(false, std::sync::atomic::Ordering::Relaxed);
    crate::settings::update(|s| s.mini_shortcut = Some(next.to_string()))?;
    crate::diagnostics::log(if next.is_empty() {
        "mini-window shortcut removed".to_string()
    } else {
        format!("mini-window shortcut set to {next}")
    });
    Ok(())
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
    fn the_menu_opening_and_closing_never_moves_the_bar() {
        // Anchored at one corner, however often the menu comes and goes: the
        // window used to creep up by the menu's height on a race.
        let corner = (1904.0, 1000.0);
        let bar = from_corner(corner, MINI_SIZE);
        for _ in 0..5 {
            let tall = from_corner(corner, (360.0, 220.0));
            assert_eq!(tall, (1544.0, 780.0));
            assert_eq!(from_corner(corner, MINI_SIZE), bar);
        }
        assert_eq!(bar, (1544.0, 944.0));
    }

    #[test]
    fn the_mini_window_sits_right_and_low() {
        // A 1920×1040 work area at the origin, the bar size.
        let (x, y) = mini_spot((0.0, 0.0, 1920.0, 1040.0), (360.0, 56.0));
        assert_eq!(x, 1920.0 - 360.0 - 16.0);
        assert_eq!(y, (1040.0_f64 * 0.62).round());
    }

    use crate::settings::{MiniAuto, MiniPlace};

    #[test]
    fn nothing_opens_by_itself_outside_a_meeting() {
        for mode in [
            MiniAuto::Off,
            MiniAuto::Minimised,
            MiniAuto::SwitchAway,
            MiniAuto::Always,
        ] {
            assert_eq!(auto_open(mode, Trigger::Minimised, false, false), None);
        }
    }

    #[test]
    fn off_asks_once_on_the_first_minimise_and_never_again() {
        assert_eq!(
            auto_open(MiniAuto::Off, Trigger::Minimised, true, false),
            Some(Open::Offer)
        );
        assert_eq!(
            auto_open(MiniAuto::Off, Trigger::Minimised, true, true),
            None
        );
        // Losing focus is not the moment to ask; minimising is.
        assert_eq!(
            auto_open(MiniAuto::Off, Trigger::LostFocus, true, false),
            None
        );
    }

    #[test]
    fn each_setting_opens_on_its_own_trigger() {
        assert_eq!(
            auto_open(MiniAuto::Minimised, Trigger::Minimised, true, true),
            Some(Open::Auto)
        );
        assert_eq!(
            auto_open(MiniAuto::Minimised, Trigger::LostFocus, true, true),
            None
        );
        assert_eq!(
            auto_open(MiniAuto::SwitchAway, Trigger::LostFocus, true, true),
            Some(Open::Auto)
        );
        assert_eq!(
            auto_open(MiniAuto::SwitchAway, Trigger::Minimised, true, true),
            Some(Open::Auto)
        );
        assert_eq!(
            auto_open(MiniAuto::Always, Trigger::MeetingStarted, true, true),
            Some(Open::Auto)
        );
        assert_eq!(
            auto_open(MiniAuto::SwitchAway, Trigger::MeetingStarted, true, true),
            None
        );
    }

    #[test]
    fn a_window_off_every_screen_counts_as_lost() {
        // A 1440p screen at 100%, and a 4K one at 150% to its right.
        let screens = [(0, 0, 2560, 1400), (2560, 0, 3840, 2100)];
        assert!(on_some_screen((2000, 1200, 360, 56), &screens));
        assert!(on_some_screen((5000, 1800, 540, 84), &screens));
        // Left beyond the far edge of the second screen, or above both.
        assert!(!on_some_screen((6500, 1800, 360, 56), &screens));
        assert!(!on_some_screen((800, -300, 360, 56), &screens));
        // Mostly off, its middle past the edge: no way to reach the grip.
        assert!(!on_some_screen((6300, 1800, 360, 56), &screens));
    }

    #[test]
    fn a_shortcut_needs_a_real_modifier() {
        assert!(usable_shortcut(crate::settings::DEFAULT_MINI_SHORTCUT).is_ok());
        assert!(usable_shortcut("Ctrl+Alt+R").is_ok());
        assert!(usable_shortcut("Super+Shift+F9").is_ok());
        // Shift alone would take a capital letter from every other app.
        assert!(usable_shortcut("Shift+M").is_err());
        assert!(usable_shortcut("M").is_err());
        assert!(usable_shortcut("Ctrl+Banana").is_err());
    }

    #[test]
    fn a_window_dropped_near_an_edge_settles_against_it() {
        let area = (0.0, 0.0, 1920.0, 1040.0);
        // Dropped 10px from the right and 20px from the bottom.
        let (x, y) = snapped(
            (1920.0 - 360.0 - 10.0, 1040.0 - 56.0 - 20.0),
            (360.0, 56.0),
            area,
        );
        assert_eq!((x, y), (1920.0 - 360.0 - 16.0, 1040.0 - 56.0 - 16.0));
        // Dropped in the middle, it stays.
        assert_eq!(snapped((700.0, 500.0), (360.0, 56.0), area), (700.0, 500.0));
    }

    #[test]
    fn a_remembered_place_is_kept_by_its_corner_and_dropped_if_off_screen() {
        let places = vec![MiniPlace {
            monitor: "A".into(),
            right: 1900.0,
            bottom: 1000.0,
        }];
        let area = (0.0, 0.0, 1920.0, 1040.0);
        // Same corner whatever the size it opens at.
        assert_eq!(
            remembered(&places, "A", area, (360.0, 56.0)),
            Some((1540.0, 944.0))
        );
        assert_eq!(
            remembered(&places, "A", area, (420.0, 200.0)),
            Some((1480.0, 800.0))
        );
        // Another monitor, or a smaller screen than it was left on.
        assert_eq!(remembered(&places, "B", area, (360.0, 56.0)), None);
        assert_eq!(
            remembered(&places, "A", (0.0, 0.0, 1366.0, 728.0), (360.0, 56.0)),
            None
        );
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
