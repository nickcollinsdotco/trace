import {
  createContext,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/**
 * Right-click menus, in the app's own voice.
 *
 * Drawn by the page rather than asked of Windows: a native menu cannot take
 * a theme, so in a retro theme it would be the one thing on screen from
 * 2024, and the gallery — which fakes the backend — could not show it. It
 * looks like the popovers because it is the same kind of surface.
 *
 * Without one, right-clicking anywhere gave WebView2's own menu — Back,
 * Refresh, Save as, Print — which belong to a web page and do nothing
 * useful in an app. The provider turns that off except where the browser's
 * menu is the right one: in a field, and over selected text, where Cut,
 * Copy and Paste are what someone reaching for it wants.
 */
export type MenuEntry =
  | {
      label: string;
      /** Shown faint at the right: a shortcut, usually. */
      hint?: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | "divider";

type Open = (e: ReactMouseEvent, entries: MenuEntry[], label: string) => void;

const ContextMenuContext = createContext<Open | null>(null);

/**
 * Props that give an element a right-click menu. `entries` is read at the
 * moment of the click, so it can close over current state.
 *
 * Outside a provider the element keeps the browser's menu, which is what a
 * screen rendered on its own would have had anyway.
 */
export function useContextMenu(
  label: string,
  entries: () => MenuEntry[],
): { onContextMenu?: (e: ReactMouseEvent) => void } {
  const open = useContext(ContextMenuContext);
  if (!open) return {};
  return { onContextMenu: (e) => open(e, entries(), label) };
}

interface Shown {
  x: number;
  y: number;
  entries: MenuEntry[];
  label: string;
  /** Where focus was, so Escape can put it back. */
  from: Element | null;
}

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const close = useCallback(() => setShown(null), []);

  const open = useCallback<Open>((e, entries, label) => {
    // Over selected text the browser's Copy is what is wanted, even inside
    // something with a menu of its own — a section of a note. The target is
    // the paragraph, an ancestor of the selection rather than inside it, so
    // the test is whether they meet, not whether one contains the other.
    const selection = window.getSelection();
    if (
      selection?.toString() &&
      selection.rangeCount > 0 &&
      selection.getRangeAt(0).intersectsNode(e.target as Node)
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    // The menu key and Shift+F10 fire this too, at a point that need not be
    // over the element at all; there it opens at the element instead.
    const box = e.currentTarget.getBoundingClientRect();
    const inside =
      e.clientX >= box.left &&
      e.clientX <= box.right &&
      e.clientY >= box.top &&
      e.clientY <= box.bottom;
    setShown({
      x: inside ? e.clientX : box.left + 12,
      y: inside ? e.clientY : box.top + Math.min(box.height, 32),
      entries,
      label,
      from: document.activeElement,
    });
  }, []);

  useEffect(() => {
    function onMenu(e: MouseEvent) {
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, [contenteditable='true']")) return;
      if (window.getSelection()?.toString()) return;
      e.preventDefault();
    }
    window.addEventListener("contextmenu", onMenu);
    return () => window.removeEventListener("contextmenu", onMenu);
  }, []);

  return (
    <ContextMenuContext.Provider value={open}>
      {children}
      {shown && <Menu shown={shown} onClose={close} />}
    </ContextMenuContext.Provider>
  );
}

function Menu({ shown, onClose }: { shown: Shown; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; origin: string } | null>(null);

  // Shown in the top layer, which escapes any transformed or clipped
  // ancestor — a gallery preview is one — while staying where it is in the
  // page, so it still wears the theme of the shell it was opened from.
  // Then measured before paint, so it never draws once off the edge and
  // jumps. Near the right or bottom it opens the other way from the
  // pointer, and grows from whichever corner sits under it.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    if (typeof el.showPopover === "function") el.showPopover();
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    const flipX = shown.x + width > window.innerWidth - margin;
    const flipY = shown.y + height > window.innerHeight - margin;
    setPlace({
      left: Math.max(margin, flipX ? shown.x - width : shown.x),
      top: Math.max(margin, flipY ? shown.y - height : shown.y),
      origin: `${flipY ? "bottom" : "top"} ${flipX ? "right" : "left"}`,
    });
  }, [shown]);

  // Once placed: before then it is hidden, and a hidden button takes no focus.
  useEffect(() => {
    if (place) items(panel.current)[0]?.focus({ preventScroll: true });
  }, [place]);

  useEffect(() => {
    function onPointer(e: PointerEvent) {
      if (!panel.current?.contains(e.target as Node)) onClose();
    }
    // Anything that moves the page out from under it ends it, as Windows does.
    const close = () => onClose();
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [onClose]);

  function dismiss() {
    onClose();
    if (shown.from instanceof HTMLElement) shown.from.focus({ preventScroll: true });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const all = items(panel.current);
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number) => all[(i + all.length) % all.length]?.focus();
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        dismiss();
        break;
      case "Tab":
        e.preventDefault();
        dismiss();
        break;
      case "ArrowDown":
        e.preventDefault();
        go(at + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        go(at < 0 ? -1 : at - 1);
        break;
      case "Home":
        e.preventDefault();
        go(0);
        break;
      case "End":
        e.preventDefault();
        go(-1);
        break;
    }
  }

  return (
    <div
      ref={panel}
      role="menu"
      aria-label={shown.label}
      onKeyDown={onKeyDown}
      popover="manual"
      // Hidden for the one layout pass it takes to measure it, so the first
      // frame anyone sees is already in place.
      style={
        place
          ? { left: place.left, top: place.top, transformOrigin: place.origin }
          : { left: shown.x, top: shown.y, visibility: "hidden" }
      }
      // `inset-auto m-0`: the browser centres a popover in the window by default.
      className="trace-panel trace-pop inset-auto m-0 flex min-w-48 max-w-72 flex-col rounded-md border border-line-strong bg-surface-1 px-0 py-1 text-ink"
    >
      {shown.entries.map((entry, i) =>
        entry === "divider" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, built per open
          <hr key={i} className="my-1 border-line" />
        ) : (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, built per open
            key={i}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            onClick={() => {
              onClose();
              entry.onSelect();
            }}
            className={`flex items-baseline justify-between gap-6 px-3 py-1.5 text-left font-mono text-2xs trace-press-row hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none disabled:opacity-50 disabled:hover:bg-transparent ${
              entry.danger ? "text-error" : "text-ink"
            }`}
          >
            <span>{entry.label}</span>
            {entry.hint && <span className="text-ink-faint">{entry.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}

/** The menu's items that can be chosen, in order. */
function items(panel: HTMLElement | null): HTMLButtonElement[] {
  return Array.from(panel?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:enabled") ?? []);
}
