import { useCallback, useEffect, useRef, useState } from "react";
import { Prompt } from "../../components/ui/terminal";
import type { Job } from "../../lib/ipc";

/** Long enough to notice from the corner of an eye, short enough to not nag. */
const SHOWN_MS = 12_000;

/** How long it takes to leave; matches the exit in layout.css. */
const LEAVE_MS = 150;

/**
 * Says a note has finished, when the user is somewhere else.
 *
 * Only then. On the note itself, the notice line already says so, and the
 * status bar already said it was working — a toast there would be the same
 * news three times. This covers the one gap: the meeting ended, the user went
 * to the library, and minutes later the notes are ready with nothing to say
 * so except a status bar entry quietly disappearing.
 *
 * Built here rather than taken from a toast library: it is one line of
 * terminal output with a button, and a library would bring a second visual
 * language to keep in step with the themes.
 */
export function ActivityToast({
  jobs,
  openNote,
  onOpenNote,
}: {
  jobs: Job[];
  /** The note on screen, if any. */
  openNote: string | null;
  onOpenNote?: ((path: string) => void) | undefined;
}) {
  const [shown, setShown] = useState<Job | null>(null);
  // Leaving the way it came, rather than vanishing: held for the length of
  // the exit, then gone. Fresh news while it leaves turns it back round.
  const [leaving, setLeaving] = useState(false);
  const dismiss = useCallback(() => setLeaving(true), []);
  const seen = useRef<Map<number, boolean>>(new Map());
  const box = useRef<HTMLDivElement>(null);

  // Only a transition counts. A job already finished when the app first saw
  // it — on mount, or in the initial read — is history, not news.
  useEffect(() => {
    const previous = seen.current;
    const next = new Map<number, boolean>();
    for (const job of jobs) {
      const done = job.outcome !== null;
      next.set(job.id, done);
      // A stop is the user's own doing, from wherever they pressed it:
      // nothing to tell them.
      const news = done && job.outcome?.state !== "stopped";
      if (news && previous.get(job.id) === false && job.notePath !== openNote) {
        setShown(job);
        setLeaving(false);
      }
    }
    seen.current = next;
  }, [jobs, openNote]);

  // Opening the note answers it.
  useEffect(() => {
    if (shown && shown.notePath === openNote) dismiss();
  }, [shown, openNote, dismiss]);

  useEffect(() => {
    if (!leaving) return;
    const id = window.setTimeout(() => {
      setShown(null);
      setLeaving(false);
    }, LEAVE_MS);
    return () => window.clearTimeout(id);
  }, [leaving]);

  // Holds while pointed at or focused, so it cannot vanish under someone
  // reaching for Open. Asked at the moment it would close rather than
  // tracked with hover handlers, which would make the box itself interactive.
  useEffect(() => {
    if (!shown) return;
    let id = 0;
    const expire = () => {
      if (box.current?.matches(":hover, :focus-within")) id = window.setTimeout(expire, 2_000);
      else dismiss();
    };
    id = window.setTimeout(expire, SHOWN_MS);
    return () => window.clearTimeout(id);
  }, [shown, dismiss]);

  if (!shown) return null;
  const failed = shown.outcome?.state === "failed";
  const title = shown.title || "Untitled meeting";

  return (
    <div
      ref={box}
      data-leaving={leaving || undefined}
      className="trace-overlay trace-toast pointer-events-auto flex max-w-sm items-baseline gap-3 rounded-md border border-line-strong bg-surface-1 px-3 py-2 font-mono text-2xs"
    >
      <span className={`min-w-0 ${failed ? "text-warn" : "text-phosphor"}`}>
        <Prompt />
        {failed ? "notes could not be written" : "notes ready"}
        <span className="text-ink-muted"> · {title}</span>
      </span>
      {onOpenNote && (
        <button
          type="button"
          onClick={() => {
            dismiss();
            onOpenNote(shown.notePath);
          }}
          className="trace-control shrink-0 tracking-system text-phosphor trace-press hover:text-ink"
        >
          Open
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismiss}
        className="shrink-0 text-ink-faint trace-press hover:text-ink"
      >
        ×
      </button>
    </div>
  );
}
