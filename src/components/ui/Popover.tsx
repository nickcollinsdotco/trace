import { type ReactNode, useEffect, useId, useRef, useState } from "react";

/**
 * A button that shows a panel, dismissed by Escape or a click outside.
 *
 * A disclosure, not an ARIA `menu`. Those promise arrow-key roving and
 * type-ahead; a short list of ordinary buttons does not need them, and Tab
 * already works.
 *
 * `children` is a function so an item can close the panel after acting —
 * picking a model should not leave the list hanging open over the screen.
 */
export function Popover({
  label,
  trigger,
  title,
  placement = "below",
  onOpen,
  children,
}: {
  /** Accessible name for the panel. */
  label: string;
  trigger: ReactNode;
  title?: string;
  /** Status-bar popovers open upwards; there is no room below them. */
  placement?: "below" | "above";
  onOpen?: () => void;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointer(e: PointerEvent) {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      // Focus goes back where it came from, not to the top of the page.
      button.current?.focus();
    }
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative min-w-0">
      <button
        ref={button}
        type="button"
        title={title}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen((o) => !o);
        }}
        className="flex min-w-0 items-center gap-2 rounded-xs trace-press hover:text-ink"
      >
        {trigger}
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={label}
          className={`trace-panel absolute left-0 z-30 flex w-72 flex-col rounded-md border border-line-strong bg-surface-1 py-1 ${
            placement === "above" ? "bottom-full mb-2" : "top-full mt-2"
          }`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** A row in a popover list. The caret marks the current choice, in the terminal's own idiom. */
export function PopoverItem({
  current,
  disabled,
  onSelect,
  children,
  detail,
}: {
  current?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-current={current ? "true" : undefined}
      disabled={disabled}
      onClick={onSelect}
      className={`flex items-baseline gap-2 px-3 py-2 text-left font-mono text-2xs trace-press hover:bg-surface-2 disabled:opacity-50 disabled:hover:bg-transparent ${
        current ? "text-phosphor" : "text-ink hover:text-phosphor"
      }`}
    >
      <span aria-hidden className="w-2 shrink-0">
        {current ? ">" : ""}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate">{children}</span>
        {detail && <span className="text-ink-faint">{detail}</span>}
      </span>
    </button>
  );
}

/** A small uppercase heading inside a popover. */
export function PopoverHeading({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 pt-2 pb-1 font-mono text-2xs uppercase tracking-system text-ink-faint">
      {children}
    </p>
  );
}

export function PopoverDivider() {
  return <div aria-hidden className="my-1 border-t border-line" />;
}
