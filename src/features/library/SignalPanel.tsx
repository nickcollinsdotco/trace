import { useMemo } from "react";
import { Prompt, Section } from "../../components/ui/terminal";
import { Wave } from "../../components/ui/Wave";
import { formatMeetingLength } from "../../lib/format";
import type { NoteSummary } from "../../lib/ipc";
import {
  ago,
  heights,
  idleHeights,
  isoDay,
  lastTraceEnded,
  milestone,
  thisWeek,
  weekStats,
} from "./signal";

const BOOT_KEY = "trace.signal.boot";

/*
 * The first look at the library each day gets a boot line instead of the
 * usual status — rare enough to be noticed, harmless if missed, which is the
 * whole of the easter-egg policy in docs/05. Per machine, so browser storage.
 */
function firstLookToday(): boolean {
  try {
    const today = isoDay(new Date());
    if (localStorage.getItem(BOOT_KEY) === today) return false;
    localStorage.setItem(BOOT_KEY, today);
    return true;
  } catch {
    return false;
  }
}

/** Shade for a day in the week strip, by how many meetings it held. */
const SHADES = ["·", "░", "▒", "▓", "█"];

/**
 * The block at the top of the library, where a calendar would sit.
 *
 * There is no calendar integration, so it shows what TRACE does know: the
 * shape of the last conversation, played back from the loudness kept when
 * its audio was deleted; this week in meetings and hours; and a status line.
 * It never opens the microphone — a library that listened while you browsed
 * notes would light Windows' mic indicator for nothing. The live version is
 * the mic check on Record.
 */
export function SignalPanel({ notes }: { notes: NoteSummary[] }) {
  const boot = useMemo(firstLookToday, []);
  const last = notes.find((n) => n.signal !== null) ?? null;
  const week = thisWeek(notes);
  const stats = weekStats(notes);
  const ended = lastTraceEnded(notes);
  const mark = milestone(notes.length);
  const month = new Date()
    .toLocaleDateString(undefined, { month: "short", year: "numeric" })
    .toUpperCase();

  return (
    <Section
      title="Signal"
      actions={<span className="font-mono text-2xs tracking-system text-ink-faint">{month}</span>}
    >
      <div className="flex flex-col gap-2">
        {last?.signal ? (
          <Wave levels={heights(last.signal)} playhead label={`Loudness across ${last.title}`} />
        ) : (
          <Wave levels={idleHeights()} breathing label="No recording yet" />
        )}
        <p className="truncate font-mono text-2xs text-ink-faint">
          {last
            ? `last trace · ${last.title}${last.durationMs !== null ? ` · ${formatMeetingLength(last.durationMs)}` : ""}`
            : "carrier · waiting for a first trace"}
        </p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <dl className="flex flex-wrap gap-x-8 gap-y-2">
          <Stat label="This week" value={String(stats.meetings).padStart(2, "0")} unit="meetings" />
          <Stat
            label="Recorded"
            value={stats.totalMs > 0 ? formatMeetingLength(stats.totalMs) : "—"}
          />
          {stats.longest?.durationMs != null && (
            <Stat
              label="Longest"
              value={formatMeetingLength(stats.longest.durationMs)}
              unit={stats.longest.title}
            />
          )}
        </dl>

        <ol aria-label="Meetings per day this week" className="flex gap-1.5">
          {week.map((d) => (
            <li
              key={d.iso}
              title={`${d.iso}: ${d.count} ${d.count === 1 ? "meeting" : "meetings"}`}
              className={`flex w-5 flex-col items-center gap-0.5 font-mono text-sm ${
                d.today ? "text-phosphor" : "text-ink-faint"
              }`}
            >
              <span aria-hidden className={d.count > 0 ? "text-phosphor" : ""}>
                {SHADES[Math.min(d.count, SHADES.length - 1)]}
              </span>
              <span aria-hidden>{d.label}</span>
              <span className="sr-only">
                {d.count} on {d.iso}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <p className="font-mono text-2xs text-ink-muted">
        <Prompt />
        {boot
          ? `good ${partOfDay()}. ${notes.length} ${notes.length === 1 ? "trace" : "traces"} on file`
          : ended !== null
            ? `last trace ${ago(ended)}`
            : "no traces yet"}
        {" · on this machine only"}
        {mark !== null && ` · ◆ ${mark} traces`}
        <span aria-hidden className="trace-cursor" />
      </p>
    </Section>
  );
}

function partOfDay(): string {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="font-mono text-2xs uppercase tracking-system text-ink-faint">{label}</dt>
      <dd className="flex min-w-0 items-baseline gap-2">
        <span className="font-mono text-xl tabular-nums text-ink">{value}</span>
        {unit && <span className="max-w-40 truncate text-xs text-ink-muted">{unit}</span>}
      </dd>
    </div>
  );
}
