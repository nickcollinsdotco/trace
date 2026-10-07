import { useRef, useState } from "react";

/**
 * A title, edited where it stands.
 *
 * Rename used to be `window.prompt` — a system box titled "tauri.localhost
 * says", in the one place the user was looking at the title anyway. Inline
 * is the decision in docs/13 (Q32): Enter or leaving the field keeps the new
 * title, Escape puts the old one back, and an empty or unchanged title is
 * not a rename at all.
 */
export function RenameInput({
  initial,
  label,
  onCommit,
  onCancel,
  className = "",
}: {
  initial: string;
  /** What is being renamed, for screen readers: "Rename Pricing page rework". */
  label: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(initial);
  // Enter commits and then blurs the field as it unmounts; without this the
  // blur would commit a second time.
  const done = useRef(false);

  const finish = (keep: boolean) => {
    if (done.current) return;
    done.current = true;
    const title = draft.trim();
    if (keep && title !== "" && title !== initial) onCommit(title);
    else onCancel();
  };

  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          // Stopped here, so Escape cancels the rename and nothing else — not
          // a popover, not an overlay sidebar.
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        }
      }}
      aria-label={label}
      // biome-ignore lint/a11y/noAutofocus: appears because the user asked to rename
      autoFocus
      data-selectable
      spellCheck={false}
      className={`w-full min-w-0 rounded-xs bg-surface-2 px-1.5 py-0.5 -mx-1.5 trace-bare-field ring-1 ring-phosphor ${className}`}
    />
  );
}
