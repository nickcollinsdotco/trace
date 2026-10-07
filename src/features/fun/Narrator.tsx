import { useContext, useEffect, useRef, useState } from "react";
import type { Page } from "../../app/Sidebar";
import { Prompt } from "../../components/ui/terminal";
import { AppearanceContext } from "../../design/appearance";
import { THEME_TYPE } from "../../design/theme";
import { type CaptureStatus, hasBackend, ipc } from "../../lib/ipc";
import { useFun } from "./fun";
import {
  type Ear,
  freshEar,
  keyDelay,
  listen,
  type NarratorEvent,
  narrate,
  segmentMilestone,
} from "./lines";

/** At most one idle remark a minute (docs/13 Q17); the cursor fills the gap. */
const IDLE_MS = 60_000;
/** How often the clock is looked at, for the word on the hour. */
const CLOCK_MS = 20_000;

const reducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The narrator: a running commentary in the status bar's spare room, on
 * unless turned off. Dry reports of what the app is doing, machine thoughts
 * between them, a word on the hour, and an answer when it is poked. It was
 * Fun mode's, and plain without it; the jokes are the point of it, so they
 * come with it.
 *
 * It steps aside whenever the bar has something real to say — a job
 * running, a model missing — so nothing that matters is ever hidden behind a
 * joke. During a meeting it speaks only about the meeting (docs/13 Q6).
 */
export function Narrator({ page, busy }: { page: Page | null; busy: boolean }) {
  const fun = useFun();
  const appearance = useContext(AppearanceContext);
  const theme = appearance?.appearance.theme;
  // The step on the capitals ladder in force: the theme's own, or as adjusted.
  const step = theme
    ? (appearance?.appearance.adjustments[theme]?.case ?? THEME_TYPE[theme].case)
    : undefined;
  const [line, setLine] = useState<{ text: string; at: number } | null>(null);
  const recording = useRef(false);
  const lastSaid = useRef(0);
  const pokes = useRef(0);
  const speaking = fun.narrator;

  const say = (event: NarratorEvent) => {
    if (event.kind !== "poke") pokes.current = 0;
    // Two lines in one millisecond would share a key and the second would
    // not type out.
    lastSaid.current = Math.max(Date.now(), lastSaid.current + 1);
    setLine({ text: narrate(event), at: lastSaid.current });
  };

  // Coming on is the first thing worth remarking on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per switch-on
  useEffect(() => {
    if (speaking) say({ kind: "online" });
  }, [speaking]);

  // Fun mode switched, after the narrator was already speaking.
  const seenFun = useRef(fun.on);
  // biome-ignore lint/correctness/useExhaustiveDependencies: on change only
  useEffect(() => {
    if (fun.on === seenFun.current) return;
    seenFun.current = fun.on;
    if (speaking && !recording.current) say({ kind: fun.on ? "awake" : "asleep" });
  }, [fun.on]);

  // Places and themes, but not while a meeting is being recorded.
  const seenPage = useRef(page);
  // biome-ignore lint/correctness/useExhaustiveDependencies: on change only
  useEffect(() => {
    if (!speaking || page === seenPage.current) return;
    seenPage.current = page;
    if (page && !recording.current) say({ kind: "page", page });
  }, [page, speaking]);

  const seenTheme = useRef(theme);
  // biome-ignore lint/correctness/useExhaustiveDependencies: on change only
  useEffect(() => {
    if (!speaking || theme === seenTheme.current) return;
    seenTheme.current = theme;
    if (theme && !recording.current) say({ kind: "theme", theme });
  }, [theme, speaking]);

  // Capitals moved on the same theme — a theme change says its own line.
  const seenStep = useRef({ theme, step });
  // biome-ignore lint/correctness/useExhaustiveDependencies: say is stable enough
  useEffect(() => {
    const before = seenStep.current;
    seenStep.current = { theme, step };
    if (!speaking || !step || before.theme !== theme || before.step === step) return;
    if (!recording.current) say({ kind: "case", step });
  }, [theme, step, speaking]);

  // The meeting itself: starting, every hundred segments, crosstalk, a quiet
  // room, and stopping. Polled, as the sidebar's timer is.
  // biome-ignore lint/correctness/useExhaustiveDependencies: say is stable enough
  useEffect(() => {
    if (!speaking || !hasBackend()) return;
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
  }, [speaking]);

  // Idle remarks, at most one a minute, never during a meeting.
  // biome-ignore lint/correctness/useExhaustiveDependencies: say is stable enough
  useEffect(() => {
    if (!speaking) return;
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
  }, [speaking]);

  // A word on the hour, unless a meeting has the floor.
  // biome-ignore lint/correctness/useExhaustiveDependencies: say is stable enough
  useEffect(() => {
    if (!speaking) return;
    let saidFor = new Date().getHours();
    const id = window.setInterval(() => {
      const now = new Date();
      if (now.getMinutes() !== 0 || now.getHours() === saidFor || recording.current) return;
      saidFor = now.getHours();
      say({ kind: "hour", hour: saidFor });
    }, CLOCK_MS);
    return () => window.clearInterval(id);
  }, [speaking]);

  const typed = useTyped(line?.text ?? "", line?.at ?? 0);

  if (!speaking || busy || !line) return null;

  const body = (
    // Keyed by the line, so each one arrives in the accent and settles.
    <span key={line.at} aria-hidden className="trace-narrator-line grid min-w-0">
      {/* The whole line, unseen, holds its room, so the words type out left
          to right in place. Without it the line grew from the middle of the
          bar, both ways at once, as it was typed. */}
      <span className="invisible col-start-1 row-start-1 truncate pr-[1ch]">{line.text}</span>
      <span className="col-start-1 row-start-1 truncate">
        {typed}
        <span className="trace-cursor trace-cursor-quiet" />
      </span>
    </span>
  );

  return (
    <span
      role="status"
      aria-label={line.text}
      // The gap stands in for the prompt's trailing space, which a flex row
      // collapses: without it the line read ">fun mode".
      className="trace-narrator flex max-w-[96ch] min-w-0 items-center gap-[0.5ch] font-mono text-xs"
    >
      <span className="text-phosphor">
        <Prompt />
      </span>
      {/* Not during a meeting: then it speaks only of the meeting. */}
      {!recording.current ? (
        <button
          type="button"
          title="Poke the narrator"
          onClick={() => {
            pokes.current += 1;
            say({ kind: "poke", count: pokes.current });
          }}
          className="min-w-0 cursor-default rounded-xs text-left"
        >
          {body}
        </button>
      ) : (
        body
      )}
    </span>
  );
}

/**
 * A line typed out as a person types it — quick inside a word, a beat at a
 * space, a pause after a full stop — rather than at a printer's even rate.
 * All at once under reduced motion.
 */
function useTyped(text: string, key: number): string {
  const [count, setCount] = useState(text.length);

  // biome-ignore lint/correctness/useExhaustiveDependencies: restart per line
  useEffect(() => {
    if (reducedMotion()) {
      setCount(text.length);
      return;
    }
    let shown = 0;
    let timer = 0;
    setCount(0);
    const next = () => {
      shown += 1;
      setCount(shown);
      if (shown < text.length)
        timer = window.setTimeout(next, keyDelay(text[shown - 1] ?? "", Math.random()));
    };
    timer = window.setTimeout(next, 120);
    return () => window.clearTimeout(timer);
  }, [key]);

  return text.slice(0, count);
}
