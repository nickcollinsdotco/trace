import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { formatElapsed, Prompt } from "../../components/ui/terminal";
import { Scope } from "./Scope";
import { isScopeMode, SCOPE_MODE_NOTES, SCOPE_MODES, type ScopeMode } from "./spectrum";

const MODE_KEY = "trace.scope.mode";

/** The scope's last mode, remembered between meetings. */
export function useScopeMode(): [ScopeMode, (mode: ScopeMode) => void] {
  const [mode, setMode] = useState<ScopeMode>(() => {
    try {
      const saved = localStorage.getItem(MODE_KEY);
      return isScopeMode(saved) ? saved : "wave";
    } catch {
      return "wave";
    }
  });
  const set = (next: ScopeMode) => {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // Not worth surfacing — the choice simply does not persist.
    }
  };
  return [mode, set];
}

function ModeChoice({ mode, onMode }: { mode: ScopeMode; onMode: (m: ScopeMode) => void }) {
  return (
    <fieldset className="m-0 flex gap-0.5 border-0 p-0">
      <legend className="sr-only">Scope</legend>
      {SCOPE_MODES.map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          title={SCOPE_MODE_NOTES[m]}
          onClick={() => onMode(m)}
          className={`rounded-xs px-2 py-0.5 font-mono text-2xs trace-press ${
            mode === m ? "bg-phosphor-dim text-phosphor" : "text-ink-faint hover:text-ink"
          }`}
        >
          {m}
        </button>
      ))}
    </fieldset>
  );
}

/** Whose colour is whose, in the transcript's words. */
function Legend() {
  return (
    <span className="flex items-center gap-3 font-mono text-2xs text-ink-faint">
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="inline-block size-1.5 rounded-full bg-phosphor" />
        you
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="inline-block size-1.5 rounded-full bg-ink-muted" />
        them
      </span>
    </span>
  );
}

const label = (mode: ScopeMode) => `Live scope, ${mode}: ${SCOPE_MODE_NOTES[mode]}`;

/**
 * The scope strip (CONTEXT.md): both streams, live, above the notes. Short,
 * so the notes keep the most room; full screen is one press away.
 */
export function ScopeStrip({
  mode,
  onMode,
  onExpand,
}: {
  mode: ScopeMode;
  onMode: (m: ScopeMode) => void;
  onExpand: () => void;
}) {
  return (
    // Controls on a row of their own: laid over the canvas, the traces ran
    // straight through them and neither could be read.
    <div
      className="flex h-24 shrink-0 flex-col border-b border-line bg-surface-1"
      style={{ "--scope-ground": "var(--color-surface-1)" } as CSSProperties}
    >
      <div className="flex h-7 shrink-0 items-center justify-between px-3">
        <Legend />
        <span className="flex items-center gap-2">
          <ModeChoice mode={mode} onMode={onMode} />
          <button
            type="button"
            onClick={onExpand}
            title="Full screen, with a line for notes"
            className="rounded-xs px-2 py-0.5 font-mono text-2xs text-ink-faint trace-press hover:text-ink"
          >
            ⤢ scope view
          </button>
        </span>
      </div>
      <Scope mode={mode} label={label(mode)} className="min-h-0 w-full flex-1" />
    </div>
  );
}

/**
 * The scope view (CONTEXT.md): the meeting as a picture, with one line for
 * notes at the bottom, so writing never has to stop to look (docs/13 Q7).
 * Enter adds the line to the notes; Escape goes back to them.
 */
export function ScopeView({
  mode,
  onMode,
  onClose,
  title,
  elapsedMs,
  notes,
  onAppendNote,
  children,
}: {
  mode: ScopeMode;
  onMode: (m: ScopeMode) => void;
  onClose: () => void;
  title: string;
  elapsedMs: number;
  notes: string;
  onAppendNote: (line: string) => void;
  /** Anything that must stay in reach, e.g. the stop controls. */
  children?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [line, setLine] = useState("");

  useEffect(() => {
    input.current?.focus();
  }, []);

  // The last few lines written, so the prompt has context.
  const recent = notes
    .split("\n")
    .filter((l) => l.trim())
    .slice(-3);

  return (
    <div
      role="dialog"
      aria-label="Scope view"
      className="absolute inset-0 z-30 flex flex-col bg-surface-0"
      style={{ "--scope-ground": "var(--color-surface-0)" } as CSSProperties}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex shrink-0 items-center gap-4 border-b border-line px-5 py-3">
        <span className="font-mono text-sm trace-caps-heading tracking-wide text-ink">{title}</span>
        <span className="font-mono text-sm tabular-nums text-ink-muted">
          {formatElapsed(elapsedMs)}
        </span>
        <span className="ml-auto flex items-center gap-4">
          <Legend />
          <ModeChoice mode={mode} onMode={onMode} />
          <button
            type="button"
            onClick={onClose}
            className="rounded-xs px-2 py-0.5 font-mono text-2xs text-ink-faint trace-press hover:text-ink"
          >
            back to notes · esc
          </button>
        </span>
      </div>

      <Scope mode={mode} label={label(mode)} className="min-h-0 w-full flex-1" />

      <div className="shrink-0 border-t border-line px-5 py-3">
        {recent.map((l, i) => (
          <p
            // biome-ignore lint/suspicious/noArrayIndexKey: lines can repeat; order is the identity
            key={i}
            className="truncate font-mono text-xs text-ink-faint"
          >
            {l}
          </p>
        ))}
        <label className="mt-1 flex items-center gap-2 font-mono text-sm">
          <span className="text-phosphor">
            <Prompt />
          </span>
          <span className="sr-only">Add a line to the notes</span>
          <input
            ref={input}
            value={line}
            onChange={(e) => setLine(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && line.trim()) {
                e.preventDefault();
                onAppendNote(line.trim());
                setLine("");
              }
            }}
            placeholder="a line for the notes, then enter"
            spellCheck={false}
            data-selectable
            className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-faint"
          />
        </label>
        {children}
      </div>
    </div>
  );
}
