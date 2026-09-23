import { useEffect, useId, useRef, useState } from "react";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** The screen this item leads to is the one showing. */
  current?: boolean;
}

/**
 * The app menu: where anything without a place on screen lives.
 *
 * A disclosure, not an ARIA `menu`. Those promise arrow-key roving and
 * type-ahead, and a list of three links does not need them; a button that
 * shows a list of ordinary buttons is honest about what it is, and Tab works.
 *
 * Deliberately small. When TRACE grows a sidebar, these items move into it
 * unchanged — which is why they are data rather than markup.
 */
export function Menu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointer(e: PointerEvent) {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      // Focus goes back where it came from, not to the top of the page.
      trigger.current?.focus();
    }
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 rounded-sm border px-2.5 py-1 font-mono text-2xs uppercase tracking-system trace-press ${
          open
            ? "border-phosphor bg-phosphor-dim text-phosphor"
            : "border-line-strong text-ink-muted hover:border-phosphor hover:text-phosphor"
        }`}
      >
        <span aria-hidden>≡</span>
        Menu
      </button>

      {open && (
        <nav
          id={panelId}
          aria-label="App"
          className="trace-panel absolute top-full right-0 z-20 mt-2 flex min-w-48 flex-col rounded-md border border-line-strong bg-surface-1 py-1"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              aria-current={item.current ? "page" : undefined}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={`flex items-center gap-2 px-3 py-2 text-left font-mono text-2xs uppercase tracking-system trace-press hover:bg-surface-2 hover:text-phosphor ${
                item.current ? "text-phosphor" : "text-ink"
              }`}
            >
              {/* A caret marks where you are, in the terminal's own idiom. */}
              <span aria-hidden className="w-2">
                {item.current ? ">" : ""}
              </span>
              {item.label}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
