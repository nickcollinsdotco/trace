import { useState } from "react";
import { Gauge, Spinner } from "../../components/ui/terminal";
import { formatBytes } from "../../lib/format";
import { type Hog, ipc, type Job, type MemoryWait, type WaitChoice } from "../../lib/ipc";
import { JobSteps } from "../activity/JobSteps";
import {
  formatDuration,
  headline,
  isWaitingForMemory,
  liveFallback,
  partsDone,
  startedAt,
} from "../activity/jobs";
import { useNow } from "../activity/useActivity";

/**
 * Explains what is still happening to a note after the meeting ended.
 *
 * A note is written immediately and then improved twice in the background.
 * Without this the text simply changes under the reader with no explanation,
 * which is unsettling in a tool whose job is keeping an accurate record.
 *
 * One line, which opens into the steps with their timings — the same idea as
 * expanding a collapsed tool call. Closed by default: most people want to
 * know that it is working, and a few want to know where the time went.
 *
 * The dropped-item count is shown deliberately. When the model invents a
 * decision and validation discards it, saying so is more honest than quietly
 * presenting a shorter list — and it tells the user something true about how
 * much to trust what remains.
 */
export function RefinementNotice({ job }: { job: Job | null }) {
  const [open, setOpen] = useState(false);
  const running = job !== null && job.outcome === null;
  const now = useNow(running);

  if (job === null) return null;

  const outcome = job.outcome;
  const waiting = isWaitingForMemory(job) ? job.waiting : null;
  const warn = outcome?.state === "failed" || waiting !== null;
  // Notes written from the live transcript because the full-quality pass
  // failed. Said on the line itself; the reason is one click away.
  const fromLive = liveFallback(job) !== null;

  return (
    <div className="flex flex-col gap-2">
      {/* The announcement, apart from the visible line: that one carries a
          clock, and a live region round a clock is read out every second. */}
      <span role="status" className="sr-only">
        {outcome === null
          ? headline(job)
          : outcome.state === "failed"
            ? `Notes could not be generated: ${outcome.message}`
            : outcome.state === "stopped"
              ? "Notes stopped"
              : `${fromLive ? "Notes generated from the live transcript" : "Notes generated"}${
                  outcome.kept ? `. The note as it was is kept beside it, as “${outcome.kept}”` : ""
                }`}
      </span>
      {/* Stop sits beside the line rather than in it: the line is itself
          a button, which opens the steps. */}
      <div className="flex flex-wrap items-baseline gap-x-3">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={`flex w-fit max-w-full items-baseline gap-2 rounded-xs text-left font-mono text-2xs trace-press-text ${
            warn ? "text-warn" : "text-phosphor"
          }`}
        >
          {running ? <Spinner /> : <span aria-hidden>&gt;</span>}
          <span className="min-w-0">
            {outcome === null ? (
              <Running job={job} now={now} />
            ) : outcome.state === "failed" ? (
              // Not an error state for the note itself — the transcript and the
              // user's own notes are intact and saved. Only the summary is missing.
              <>notes could not be generated — {outcome.message}. The transcript is saved.</>
            ) : outcome.state === "stopped" ? (
              <span className="text-ink-muted">
                notes stopped — ↻ writes them when you like. The transcript is saved.
              </span>
            ) : (
              <>
                notes generated
                {fromLive && <span className="text-warn"> from the live transcript</span>}
                {outcome.dropped > 0 && (
                  <>
                    {" — "}
                    <span className="text-warn">
                      {outcome.dropped} item{outcome.dropped === 1 ? "" : "s"} discarded
                      {outcome.fabricated > 0 && " for citing something not in the transcript"}
                    </span>
                  </>
                )}
                {/* Regenerating wrote the body afresh; where the old one went
                  is the one thing someone who edited it needs to know. */}
                {outcome.kept && (
                  <>
                    {" — "}
                    <span className="text-warn">
                      the note as it was is kept beside it, as “{outcome.kept}”
                    </span>
                  </>
                )}
              </>
            )}
          </span>
          <span aria-hidden className="text-ink-faint">
            {open ? "▾" : "▸"}
          </span>
        </button>
        {running && <StopButton job={job} />}
      </div>

      {waiting && <MemoryWaitPanel notePath={job.notePath} wait={waiting} />}

      {open && (
        <div className="border-l border-line pl-3">
          <JobSteps job={job} now={now} />
        </div>
      )}
    </div>
  );
}

/**
 * Notes held back because loading the summary model now could tip the
 * machine over — the freeze this exists to prevent happened mid-load, on a
 * computer already busy with a call.
 *
 * Open rather than behind the toggle: the user has something to decide, and
 * the numbers are what let them decide it. Both ways out are theirs. Writing
 * anyway is allowed, because TRACE only knows what is free, not what the
 * user is willing to slow down; putting it off ends the wait with the
 * transcript saved and ↻ to come back to.
 */
function MemoryWaitPanel({ notePath, wait }: { notePath: string; wait: MemoryWait }) {
  const [sent, setSent] = useState<WaitChoice | null>(null);
  const choose = (choice: WaitChoice) => {
    setSent(choice);
    void ipc.memoryWaitChoice(notePath, choice).catch(() => setSent(null));
  };

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-warn/40 bg-warn-dim px-3 py-2.5">
      <p className="text-xs text-ink">
        Waiting for memory: close {wait.hogs[0]?.name ?? "some apps"}, or write notes anyway.
      </p>
      <p className="font-mono text-2xs text-ink-muted">
        {wait.model} needs {formatBytes(wait.neededBytes)}. Free now:{" "}
        {formatBytes(wait.ramAvailableBytes)} of memory
        {wait.gpuFreeBytes !== null && <>, {formatBytes(wait.gpuFreeBytes)} on the graphics card</>}
        . TRACE checks again every few seconds and carries on by itself when there is room.
      </p>
      {wait.hogs.length > 0 && (
        <p className="font-mono text-2xs text-ink-muted">Using the most: {hogList(wait.hogs)}.</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={sent !== null}
          onClick={() => choose("anyway")}
          className="trace-btn trace-btn-secondary trace-press disabled:opacity-50"
        >
          Write notes anyway
        </button>
        <button
          type="button"
          disabled={sent !== null}
          onClick={() => choose("later")}
          className="trace-btn trace-btn-quiet trace-press disabled:opacity-50"
        >
          Later
        </button>
        <span className="text-2xs text-ink-faint">
          Anyway may slow this computer right down while the model loads.
        </span>
      </div>
    </div>
  );
}

/**
 * "Figma 4.4 GB graphics, 3.4 GB memory · chrome 2.7 GB memory". The kind
 * of memory matters: it says whether closing the app frees the card, the
 * system memory, or both.
 */
export function hogList(hogs: Hog[]): string {
  return hogs
    .map((h) => {
      const held = [
        h.gpuBytes >= 2 ** 28 && `${formatBytes(h.gpuBytes)} graphics`,
        h.ramBytes >= 2 ** 28 && `${formatBytes(h.ramBytes)} memory`,
      ].filter(Boolean);
      return `${h.name} ${held.join(", ")}`;
    })
    .join(" · ");
}

/**
 * Stop the notes being written. No confirmation: nothing is lost by it — the
 * transcript is saved and ↻ starts again — and a question in the way of
 * stopping something slowing the computer down is the wrong way round.
 */
function StopButton({ job }: { job: Job }) {
  const [sent, setSent] = useState(false);
  const stopping = sent || job.stopping;
  return (
    <button
      type="button"
      disabled={stopping}
      onClick={() => {
        setSent(true);
        void ipc.stopNotes(job.notePath).catch(() => setSent(false));
      }}
      className="trace-control shrink-0 font-mono text-2xs tracking-system text-ink-muted trace-press-text hover:text-ink disabled:opacity-60"
    >
      {stopping ? "stopping…" : "stop"}
    </button>
  );
}

function Running({ job, now }: { job: Job; now: number }) {
  const since = startedAt(job);
  const parts = partsDone(job);

  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span>{headline(job)}</span>
      {parts && (
        <span className="inline-flex items-baseline gap-1.5 text-ink-muted">
          <Gauge
            value={parts.done / parts.total}
            label={`${parts.done} of ${parts.total} parts written`}
          />
          <span aria-hidden className="tabular-nums">
            {parts.done}/{parts.total}
          </span>
        </span>
      )}
      {since !== null && (
        <span className="tabular-nums text-ink-muted">{formatDuration(now - since)}</span>
      )}
    </span>
  );
}
