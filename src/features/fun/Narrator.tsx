import { useContext, useEffect, useRef, useState } from "react";
import type { Page } from "../../app/Sidebar";
import { Prompt } from "../../components/ui/terminal";
import { AppearanceContext } from "../../design/appearance";
import { type CaptureStatus, hasBackend, ipc } from "../../lib/ipc";
import { useFun } from "./fun";
import { type Ear, freshEar, listen, type NarratorEvent, narrate, segmentMilestone } from "./lines";

/** At most one idle remark a minute (docs/13 Q17); the cursor fills the gap. */
const IDLE_MS = 60_000;
const TYPE_MS = 22;

const reducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The narrator: Fun mode's running commentary, in the status bar's spare
 * room.
 *
 * It steps aside whenever the bar has something real to say — a job
 * running, a model missing — so nothing that matters is ever hidden behind a
 * joke. During a meeting it speaks only about the meeting (docs/13 Q6).
 */
export function Narrator({ page, busy }: { page: Page | null; busy: boolean }) {
  const fun = useFun();
  const appearance = useContext(AppearanceContext);
  const theme = appearance?.appearance.theme;
  const [line, setLine] = useState<{ text: string; at: number } | null>(null);
  const recording = useRef(false);
  const lastSaid = useRef(0);

  const say = (event: NarratorEvent) => {
    lastSaid.current = Date.now();
    setLine({ text: narrate(event), at: lastSaid.current });
  };

  // Turning fun mode on is the first thing worth remarking on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per switch-on
  useEffect(() => {
    if (fun.on) say({ kind: "awake" });
  }, [fun.on]);

  // Places and themes, but not while a meeting is being recorded.
  const seenPage = useRef(page);
  // biome-ignore lint/correctness/useExhaustiveDependencies: on change only
  useEffect(() => {
    if (!fun.on || page === seenPage.current) return;
    seenPage.current = page;
    if (page && !recording.current) say({ kind: "page", page });
  }, [page, fun.on]);

  const seenTheme = useRef(theme);
  // biome-ignore lint/correctness/useExhaustiveDependencies: on change only
  useEffect(() => {
    if (!fun.on || theme === seenTheme.current) return;
    seenTheme.current = theme;
    if (theme && !recording.current) say({ kind: "theme", theme });
  }, [theme, fun.on]);

  // The meeting itself: starting, every hundred segments, crosstalk, a quiet
  // room, and stopping. Polled, as the sidebar's timer is.
  // biome-ignore lint/correctness/useExhaustiveDependencies: say is stable enough
  useEffect(() => {
    if (!fun.on || !hasBackend()) return;
    let last: CaptureStatus | null = null;
    let ear: Ear = freshEar();
    let cancelled = false;

    const poll = () => {
      void ipc
        .captureStatus()
        .then((s) => {
          if (cancelled) return;
          recording.current = s !== null;
          if (s && !last) say({ kind: "started", hour: new Date().getHours() });
          if (!s && last) {
            say({ kind: "stopped", elapsedMs: last.elapsedMs, segments: last.segmentCount });
          }
          if (s) {
            const milestone = segmentMilestone(last?.segmentCount ?? 0, s.segmentCount);
            const mic = s.levels.find((l) => l.source === "microphone")?.level ?? 0;
            const system = s.levels.find((l) => l.source === "system")?.level ?? 0;
            const result = listen(ear, mic, system, Date.now());
            ear = result.ear;
            if (result.heard) say({ kind: result.heard });
            else if (milestone) say({ kind: "segments", count: milestone });
          } else {
            ear = freshEar();
          }
          last = s;
        })
        .catch(() => {});
    };
    poll();
    const id = window.setInterval(poll, 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [fun.on]);

  // Idle remarks, at most one a minute, never during a meeting.
  // biome-ignore lint/correctness/useExhaustiveDependencies: say is stable enough
  useEffect(() => {
    if (!fun.on) return;
    let notes: number | null = null;
    let tick = 0;
    if (hasBackend()) {
      void ipc
        .listNotes()
        .then((n) => {
          notes = n.length;
        })
        .catch(() => {});
    }
    const id = window.setInterval(() => {
      if (recording.current || Date.now() - lastSaid.current < IDLE_MS - 5_000) return;
      say({ kind: "idle", notes, tick: tick++ });
    }, IDLE_MS);
    return () => window.clearInterval(id);
  }, [fun.on]);

  const typed = useTyped(line?.text ?? "", line?.at ?? 0);

  if (!fun.on || busy || !line) return null;
  return (
    <span
      role="status"
      aria-label={line.text}
      // The gap stands in for the prompt's trailing space, which a flex row
      // collapses: without it the line read ">fun mode".
      className="trace-narrator flex min-w-0 items-center gap-[0.5ch] truncate text-ink-faint"
    >
      <Prompt />
      <span aria-hidden className="truncate">
        {typed}
      </span>
      <span aria-hidden className="trace-cursor" />
    </span>
  );
}

/** A line typed out a character at a time; all at once under reduced motion. */
function useTyped(text: string, key: number): string {
  const [count, setCount] = useState(text.length);

  // biome-ignore lint/correctness/useExhaustiveDependencies: restart per line
  useEffect(() => {
    if (reducedMotion()) {
      setCount(text.length);
      return;
    }
    setCount(0);
    const id = window.setInterval(() => {
      setCount((c) => {
        if (c >= text.length) window.clearInterval(id);
        return Math.min(text.length, c + 1);
      });
    }, TYPE_MS);
    return () => window.clearInterval(id);
  }, [key]);

  return text.slice(0, count);
}
