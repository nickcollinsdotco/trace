import { useEffect, useRef, useState } from "react";
import {
  type CaptureState,
  Elapsed,
  formatElapsed,
  Meter,
  Section,
  StatusDot,
  SystemLabel,
} from "../../components/ui/terminal";
import type { TranscriptSegment } from "../../lib/types";

/**
 * Capture mode — technical, dense, instrument-like (docs/05-DESIGN-DIRECTION.md).
 *
 * Layout priority is deliberate and comes from docs/04-UX.md: the user's own
 * NOTES sit above and get more room than the TRANSCRIPT. The transcript is
 * supporting evidence, not the main event.
 *
 * SCAFFOLD STATE (M0): the timer is real, but levels and segments are inert
 * placeholders. M1 replaces them with Tauri events from the Rust audio layer;
 * M3 streams real segments. Nothing here talks to a backend yet.
 */
export function CaptureScreen({
  meetingId,
  onFinish,
}: {
  meetingId: string;
  onFinish: () => void;
}) {
  const [state] = useState<CaptureState>("capturing");
  const [notes, setNotes] = useState("");
  const startedAt = useRef(Date.now());
  const elapsedMs = useElapsed(state === "capturing");
  const notesRef = useRef<HTMLTextAreaElement>(null);

  // "Just start typing" — the notes field takes focus immediately, so the
  // user never has to aim at anything to capture a thought.
  useEffect(() => {
    notesRef.current?.focus();
  }, []);

  const title = meetingId === "new" ? "Untitled meeting" : "Client Alpha";

  return (
    <div data-mode="capture" className="flex h-full flex-col">
      <div className="flex shrink-0 items-baseline gap-4 border-b border-line px-5 py-3">
        <h1 className="font-mono text-sm uppercase tracking-wide text-ink">{title}</h1>
        <StatusDot state={state} />
        <span aria-hidden className="trace-rule" />
        <Elapsed ms={elapsedMs} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
        {/* Notes get the most room. This ordering is the product's opinion. */}
        <Section title="Notes">
          <textarea
            ref={notesRef}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="type only what matters…"
            spellCheck={false}
            data-selectable
            className="min-h-40 w-full resize-none border-0 bg-transparent p-0 text-base leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none"
          />
        </Section>

        <Section title="Transcript">
          <TranscriptView segments={[]} />
        </Section>

        <Section title="Signal">
          <div className="flex flex-col gap-1.5">
            <Meter label="Mic" level={0} />
            <Meter label="System" level={0} />
          </div>
        </Section>
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-line px-5 py-3">
        <SystemLabel>session_{startedAt.current.toString(16).slice(-4).toUpperCase()}</SystemLabel>
        <button
          type="button"
          onClick={onFinish}
          className="rounded-sm border border-line-strong bg-surface-2 px-4 py-1.5 font-mono text-2xs uppercase tracking-system text-ink transition-colors duration-120 hover:border-error hover:text-error"
        >
          Stop meeting
        </button>
      </div>
    </div>
  );
}

function TranscriptView({ segments }: { segments: TranscriptSegment[] }) {
  if (segments.length === 0) {
    return (
      <p className="font-mono text-xs text-ink-faint">
        &gt; awaiting signal
        <span className="trace-cursor" />
      </p>
    );
  }

  return (
    <div data-selectable className="flex flex-col gap-2">
      {segments.map((segment) => (
        <div key={segment.id} className="trace-segment-in flex gap-3 font-mono text-xs">
          <span className="shrink-0 tabular-nums text-ink-faint">
            {formatElapsed(segment.startMs)}
          </span>
          <span className="w-16 shrink-0 uppercase tracking-system text-phosphor-muted">
            {segment.speaker ?? (segment.source === "microphone" ? "you" : "them")}
          </span>
          {/* Provisional text comes from the fast streaming pass and may be
              revised by the accurate re-pass; show that rather than hide it. */}
          <span className={segment.provisional ? "text-ink-muted italic" : "text-ink"}>
            {segment.text}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Ticks once a second while running. Wall-clock based, so it stays correct
 *  across a sleep/resume rather than counting missed intervals. */
function useElapsed(running: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!running) return;
    startRef.current ??= Date.now();

    const tick = () => setElapsed(Date.now() - (startRef.current ?? Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [running]);

  return elapsed;
}
