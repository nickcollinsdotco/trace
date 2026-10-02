import { useState } from "react";
import { hasRealModifier, shortcutFromEvent, shortcutLabel } from "../mini/shortcut";

/**
 * Records a shortcut by having it pressed, as every app that lets you pick
 * one does — typing "Ctrl+Shift+Alt+M" out by hand is how typos get saved.
 *
 * Whether another app already holds it is only known by trying, so the
 * backend's refusal is said here, beside the keys that were refused.
 */
export function ShortcutField({
  shortcut,
  taken,
  onChange,
}: {
  shortcut: string;
  /** Held by another app since TRACE started, so it does nothing. */
  taken: boolean;
  /** Resolves when stored; rejects with the reason it was refused. */
  onChange: (next: string) => Promise<unknown>;
}) {
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const offer = (next: string) => {
    setListening(false);
    setProblem(null);
    void onChange(next).catch((e) => setProblem(String(e)));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label={
            listening
              ? "Press the new shortcut, or Escape to cancel"
              : `Shortcut: ${shortcut ? shortcutLabel(shortcut) : "none"}. Change it`
          }
          onClick={() => {
            setProblem(null);
            setListening(true);
          }}
          onBlur={() => setListening(false)}
          onKeyDown={(e) => {
            if (!listening) return;
            e.preventDefault();
            e.stopPropagation();
            if (e.key === "Escape") {
              setListening(false);
              return;
            }
            const next = shortcutFromEvent(e);
            if (!next) return;
            if (!hasRealModifier(next)) {
              setProblem("Hold Ctrl, Alt or the Windows key with it.");
              return;
            }
            offer(next);
          }}
          className={`trace-field w-auto min-w-48 py-1.5 text-left font-mono text-sm ${
            listening ? "text-phosphor" : taken ? "text-ink-faint line-through" : "text-ink"
          }`}
        >
          {listening ? "press the keys…" : shortcut ? shortcutLabel(shortcut) : "none"}
        </button>
        {shortcut && !listening && (
          <button
            type="button"
            onClick={() => offer("")}
            className="rounded-sm px-2 py-1.5 font-mono text-2xs text-ink-faint trace-press hover:bg-surface-2 hover:text-ink"
          >
            Remove
          </button>
        )}
      </div>
      {problem ? (
        <p role="alert" className="text-2xs text-error">
          {problem}
        </p>
      ) : taken ? (
        <p role="alert" className="text-2xs text-warn">
          Another app already uses this, so it does nothing. Click it and press another.
        </p>
      ) : (
        <p className="text-2xs text-ink-faint">
          Opens the mini window from anywhere. Click and press new keys to change it.
        </p>
      )}
    </div>
  );
}
