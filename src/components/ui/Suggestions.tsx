import { type KeyboardEvent, type ReactNode, useEffect, useState } from "react";

/**
 * Suggestions under a text field, driven from the keyboard.
 *
 * Shared by the tag editor and the library's search, which both complete a
 * word from things the library already holds. The field keeps focus the
 * whole time: it is an ARIA combobox, the list its listbox, and the
 * highlighted option is announced through `aria-activedescendant`, so a
 * screen reader follows the arrows without focus ever leaving the text.
 */
export interface Suggestion {
  /** What picking it does to the field — the whole value, or one token. */
  value: string;
  label: ReactNode;
  /** Quiet text on the right: a count, a meaning. */
  hint?: string | undefined;
}

/**
 * The highlighted option, and the keys that move it.
 *
 * `onKeyDown` returns true when it handled the key, so the field's own
 * handler can carry on with anything else. Nothing is highlighted until an
 * arrow is pressed, so Enter keeps meaning "what I typed" until the user
 * says otherwise.
 */
export function useSuggestionKeys(
  items: Suggestion[],
  onPick: (s: Suggestion) => void,
  /** Whether Tab may take the first option unasked: only once something is typed. */
  tabToFirst = true,
): {
  active: number;
  setActive: (i: number) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => boolean;
} {
  const [active, setActive] = useState(-1);

  // A new list is a new question; the old highlight means nothing in it.
  const signature = items.map((i) => i.value).join("\u0000");
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the options change
  useEffect(() => setActive(-1), [signature]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): boolean => {
    if (items.length === 0) return false;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((active + 1) % items.length);
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(active <= 0 ? items.length - 1 : active - 1);
      return true;
    }
    const chosen = items[active];
    if (e.key === "Enter" && chosen) {
      e.preventDefault();
      onPick(chosen);
      return true;
    }
    // Tab completes to the highlighted option, or the first — the shell's
    // habit. The first only while something is typed, so Tab still moves
    // focus out of a field that is merely showing what could go in it.
    const first = chosen ?? (tabToFirst ? items[0] : undefined);
    if (e.key === "Tab" && !e.shiftKey && first) {
      e.preventDefault();
      onPick(first);
      return true;
    }
    return false;
  };

  return { active, setActive, onKeyDown };
}

export function SuggestionList({
  id,
  items,
  active,
  onPick,
  onHover,
  label,
}: {
  id: string;
  items: Suggestion[];
  active: number;
  onPick: (s: Suggestion) => void;
  onHover: (i: number) => void;
  label: string;
}) {
  if (items.length === 0) return null;
  return (
    <div
      id={id}
      role="listbox"
      aria-label={label}
      className="trace-overlay absolute top-full left-0 z-30 mt-1 flex min-w-full flex-col overflow-hidden rounded-sm border border-line-strong bg-surface-3 py-1"
    >
      {items.map((item, i) => (
        <div
          key={item.value}
          id={`${id}-${i}`}
          role="option"
          aria-selected={i === active}
          // Reachable by the arrows through the field, never by Tab: focus
          // stays in the field, as a combobox's does.
          tabIndex={-1}
          // Mouse down, not click, and prevented: a click would blur the field
          // first, and the field treats blur as "done".
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(item);
          }}
          onMouseEnter={() => onHover(i)}
          className={`flex cursor-pointer items-baseline justify-between gap-6 px-3 py-1.5 font-mono text-2xs ${
            i === active ? "bg-phosphor-dim text-phosphor" : "text-ink-muted"
          }`}
        >
          <span className="truncate">{item.label}</span>
          {item.hint && <span className="shrink-0 text-ink-faint">{item.hint}</span>}
        </div>
      ))}
    </div>
  );
}
