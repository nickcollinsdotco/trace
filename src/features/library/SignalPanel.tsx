import { useMemo, useState } from "react";
import { Prompt, Section } from "../../components/ui/terminal";
import { Wave } from "../../components/ui/Wave";
import { formatMeetingLength } from "../../lib/format";
import type { NoteSummary } from "../../lib/ipc";
import { useFun } from "../fun/fun";
import {
  ago,
  heatLevel,
  heights,
  idleHeights,
  isoDay,
  isoWeek,
  lastTraceEnded,
  milestone,
  mondayOf,
  thisWeek,
  type WeekDay,
  weekStats,
  weeksOnFile,
  yearGrid,
  yearStats,
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

const VIEW_KEY = "trace.signal.view";
export type View = "week" | "year";

function loadView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "year" ? "year" : "week";
  } catch {
    return "week";
  }
}

/** Fun mode's sign-off for the status line, one a day (docs/09 §17). */
const QUOTES = [
  "signal over noise.",
  "remember what matters.",
  "conversations leave traces.",
  "context restored.",
  "input received.",
  "extracting the signal.",
];

/**
 * The block at the top of the library, where a calendar would sit.
 *
 * There is no calendar integration, so it shows what TRACE does know: the
 * shape of the last conversation, played back from the loudness kept when
 * its audio was deleted; a week in meetings and hours; and a status line.
 * The week can be flicked back through, or the whole past year shown at
 * once as a grid of days — the shape of a working year, from what is on
 * file and nothing else.
 *
 * It never opens the microphone — a library that listened while you browsed
 * notes would light Windows' mic indicator for nothing. The live version is
 * the mic check on Record.
 */
export function SignalPanel({
  notes,
  initial,
}: {
  notes: NoteSummary[];
  /** Where to open, for the gallery; otherwise the view last chosen, this week. */
  initial?: { view?: View; back?: number } | undefined;
}) {
  const boot = useMemo(firstLookToday, []);
  const fun = useFun();
  const [view, setView] = useState<View>(() => initial?.view ?? loadView());
  const [back, setBack] = useState(initial?.back ?? 0);
  const now = new Date();
  const furthest = weeksOnFile(notes, now);
  const ended = lastTraceEnded(notes);
  const mark = milestone(notes.length);

  const show = (next: View) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // The view simply does not persist.
    }
  };

  // Flicked back, the wave plays the last meeting of that week instead.
  const week = thisWeek(notes, now, back);
  const inWeek = new Set(week.map((d) => d.iso));
  const looking = view === "week" && back > 0;
  const last = looking
    ? (notes.find((n) => n.signal !== null && inWeek.has(n.date)) ?? null)
    : (notes.find((n) => n.signal !== null) ?? null);
  const monday = mondayOf(now, view === "week" ? back : 0);

  return (
    <Section
      title="Signal"
      actions={
        <span className="flex items-center gap-3 font-mono text-2xs tracking-system text-ink-faint">
          {view === "week" ? (
            <span className="flex items-center gap-2">
              <Step
                label="Previous week"
                disabled={back >= furthest}
                onClick={() => setBack((b) => b + 1)}
              >
                <path d="M7.5 2.5 4 6l3.5 3.5" />
              </Step>
              <span className="tabular-nums">
                {`WK ${String(isoWeek(monday)).padStart(2, "0")} · ${monthOf(monday)}`}
              </span>
              <Step label="Next week" disabled={back === 0} onClick={() => setBack((b) => b - 1)}>
                <path d="M4.5 2.5 8 6 4.5 9.5" />
              </Step>
            </span>
          ) : (
            <span>{`${monthOf(mondayOf(now, 52))} – ${monthOf(now)}`}</span>
          )}
          <fieldset className="m-0 flex border-0 p-0">
            <legend className="sr-only">Signal view</legend>
            {(["week", "year"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => show(v)}
                className={`rounded-xs px-1.5 trace-press ${
                  view === v ? "text-phosphor" : "hover:text-ink"
                }`}
              >
                {v}
              </button>
            ))}
          </fieldset>
        </span>
      }
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
            : looking
              ? "carrier · nothing recorded that week"
              : "carrier · waiting for a first trace"}
        </p>
      </div>

      {view === "week" ? (
        <WeekView notes={notes} now={now} back={back} week={week} />
      ) : (
        <YearView
          notes={notes}
          now={now}
          onWeek={(b) => {
            setBack(b);
            show("week");
          }}
        />
      )}

      <p className="font-mono text-2xs text-ink-muted">
        <Prompt />
        {boot
          ? `good ${partOfDay()}. ${notes.length} ${notes.length === 1 ? "trace" : "traces"} on file`
          : ended !== null
            ? `last trace ${ago(ended)}`
            : "no traces yet"}
        {" · on this machine only"}
        {mark !== null && ` · ◆ ${mark} traces`}
        {fun.on && ` · ${QUOTES[now.getDate() % QUOTES.length]}`}
        <span aria-hidden className="trace-cursor trace-cursor-quiet" />
      </p>
    </Section>
  );
}

/** One week's numbers, and its days as shades. */
function WeekView({
  notes,
  now,
  back,
  week,
}: {
  notes: NoteSummary[];
  now: Date;
  back: number;
  week: WeekDay[];
}) {
  const stats = weekStats(notes, now, back);
  const label =
    back === 0
      ? "This week"
      : back === 1
        ? "Last week"
        : `Week of ${shortDate(mondayOf(now, back))}`;

  return (
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <dl className="flex flex-wrap gap-x-8 gap-y-2">
        <Stat label={label} value={String(stats.meetings).padStart(2, "0")} unit="meetings" />
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

      <ol aria-label={`Meetings per day ${label.toLowerCase()}`} className="flex gap-1.5">
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
  );
}

/** Monday, Wednesday and Friday named down the side, as a wall planner does. */
const ROW_LABELS = ["M", "", "W", "", "F", "", ""];

/**
 * The past year as a grid of days, a column a week, brighter for more
 * meetings. Each column is a button that opens its week.
 */
function YearView({
  notes,
  now,
  onWeek,
}: {
  notes: NoteSummary[];
  now: Date;
  onWeek: (back: number) => void;
}) {
  const grid = yearGrid(notes, now);
  const stats = yearStats(grid);
  const count = (n: number) => `${n} ${n === 1 ? "meeting" : "meetings"}`;

  return (
    <div className="flex flex-col gap-4">
      <dl className="flex flex-wrap gap-x-8 gap-y-2">
        <Stat label="Past year" value={String(stats.meetings).padStart(2, "0")} unit="meetings" />
        <Stat label="Days" value={String(stats.days).padStart(2, "0")} unit="with a meeting" />
        <Stat
          label="Streak"
          value={String(stats.streak).padStart(2, "0")}
          unit={stats.streak === 1 ? "day" : "days"}
        />
        {stats.busiest && (
          <Stat
            label="Busiest"
            value={String(stats.busiest.total).padStart(2, "0")}
            unit={`week of ${shortDate(dayOf(stats.busiest.monday))}`}
          />
        )}
      </dl>

      <div className="flex gap-1.5 font-mono text-2xs leading-none text-ink-faint">
        <span aria-hidden className="flex shrink-0 flex-col gap-[3px] pt-[calc(1em+3px)]">
          {ROW_LABELS.map((d, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positions
            <span key={i} className="flex flex-1 items-center">
              {d}
            </span>
          ))}
        </span>
        <ol aria-label="Meetings per week, the past year" className="flex min-w-0 flex-1 gap-[3px]">
          {grid.map((w) => (
            <li key={w.monday} className="flex min-w-0 flex-1 flex-col gap-[3px]">
              {/* Overflowing on purpose: a month's name is wider than its
                  column, and runs on over the next, as a planner's does. */}
              <span aria-hidden className="h-[1em] overflow-visible whitespace-nowrap">
                {w.month}
              </span>
              <button
                type="button"
                aria-label={`Week of ${shortDate(dayOf(w.monday))}: ${count(w.total)}`}
                onClick={() => onWeek(w.back)}
                className="trace-heat-week flex flex-col gap-[3px] rounded-[2px]"
              >
                {w.days.map((d) => (
                  <span
                    key={d.iso}
                    title={d.future ? undefined : `${d.iso}: ${count(d.count)}`}
                    data-level={d.future ? "future" : heatLevel(d.count)}
                    className="trace-heat-cell"
                  />
                ))}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/**
 * One of the week arrows, named for a screen reader. Drawn rather than
 * typed: ‹ and › came out a few pixels high in most themes' fonts, too small
 * to see, let alone to hit.
 */
function Step({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-6 items-center justify-center rounded-sm border border-line text-ink-muted trace-press hover:border-line-strong hover:text-ink disabled:border-transparent disabled:opacity-30"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {children}
      </svg>
    </button>
  );
}

/** A `YYYY-MM-DD` as a local date, at noon so no clock change moves its day. */
function dayOf(iso: string): Date {
  return new Date(`${iso}T12:00`);
}

function shortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function monthOf(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" }).toUpperCase();
}

function partOfDay(): string {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="font-mono text-2xs trace-caps-label tracking-system text-ink-faint">
        {label}
      </dt>
      <dd className="flex min-w-0 items-baseline gap-2">
        <span className="font-mono text-xl tabular-nums text-ink">{value}</span>
        {unit && <span className="max-w-40 truncate text-xs text-ink-muted">{unit}</span>}
      </dd>
    </div>
  );
}
