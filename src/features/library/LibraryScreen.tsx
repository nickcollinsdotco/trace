import { formatElapsed, SystemLabel } from "../../components/ui/terminal";
import { groupByDate } from "../../lib/dates";
import type { MeetingSummary } from "../../lib/types";

/**
 * TEMPORARY: placeholder rows so the layout is reviewable before the Rust
 * store lands in M4. Delete this constant and read from the store instead —
 * nothing else in this file needs to change.
 */
const PLACEHOLDER: MeetingSummary[] = [
  {
    id: "2026-09-04-client-alpha",
    title: "Client Alpha",
    date: "2026-09-04",
    type: "client",
    status: "complete",
    durationMs: 32 * 60_000 + 18_000,
    participantCount: 3,
  },
  {
    id: "2026-09-04-team-sync",
    title: "Team Sync",
    date: "2026-09-04",
    type: "general",
    status: "complete",
    durationMs: 14 * 60_000,
    participantCount: 5,
  },
  {
    id: "2026-09-03-discovery-call",
    title: "Discovery Call",
    date: "2026-09-03",
    type: "discovery",
    status: "complete",
    durationMs: 47 * 60_000 + 5_000,
    participantCount: 2,
  },
  {
    id: "2026-08-21-project-review",
    title: "Project Review",
    date: "2026-08-21",
    type: "design-review",
    status: "complete",
    durationMs: 58 * 60_000,
    participantCount: 4,
  },
];

export function LibraryScreen({ onOpenCapture }: { onOpenCapture: (meetingId: string) => void }) {
  const groups = groupByDate(PLACEHOLDER, (m) => m.date);

  return (
    // Reading mode: calm, editorial, generous. Contrast with capture mode.
    <div data-mode="reading" className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-10">
        <div className="flex items-center justify-between">
          <SystemLabel tone="muted">Meetings</SystemLabel>
          <NewMeetingButton onClick={() => onOpenCapture("new")} />
        </div>

        {groups.length === 0 ? (
          <EmptyState />
        ) : (
          groups.map(({ group, items }) => (
            <section key={group} className="flex flex-col gap-1">
              <div className="mb-2 flex items-center gap-2.5">
                <SystemLabel>{group}</SystemLabel>
                <span aria-hidden className="trace-rule" />
              </div>
              {items.map((meeting) => (
                <MeetingRow
                  key={meeting.id}
                  meeting={meeting}
                  onOpen={() => onOpenCapture(meeting.id)}
                />
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function NewMeetingButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-sm border border-line-strong bg-surface-2 px-3 py-1.5 font-mono text-2xs uppercase tracking-system text-ink transition-colors duration-120 hover:border-phosphor hover:text-phosphor"
    >
      <span aria-hidden>+</span>
      New meeting
    </button>
  );
}

function MeetingRow({ meeting, onOpen }: { meeting: MeetingSummary; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex items-baseline gap-3 rounded-sm px-2 py-2 text-left transition-colors duration-120 hover:bg-surface-1"
    >
      <span className="truncate text-base text-ink group-hover:text-phosphor">{meeting.title}</span>
      <span
        aria-hidden
        className="trace-rule opacity-0 transition-opacity group-hover:opacity-100"
      />
      <span className="shrink-0 font-mono text-2xs tabular-nums text-ink-faint">
        {meeting.participantCount}p
      </span>
      {meeting.durationMs !== undefined && (
        <span className="shrink-0 font-mono text-2xs tabular-nums text-ink-faint">
          {formatElapsed(meeting.durationMs)}
        </span>
      )}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col gap-3 py-16 text-center">
      <p className="font-mono text-xs text-ink-faint">&gt; no traces yet.</p>
      <p className="text-sm text-ink-muted">Start a meeting and TRACE will keep the rest.</p>
    </div>
  );
}
