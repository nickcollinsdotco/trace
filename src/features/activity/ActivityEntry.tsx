import { Popover, PopoverDivider, PopoverHeading, PopoverItem } from "../../components/ui/Popover";
import { Gauge, Spinner } from "../../components/ui/terminal";
import type { Job } from "../../lib/ipc";
import { JobSteps } from "./JobSteps";
import { formatDuration, headline, isQueued, isRunning, partsDone, startedAt } from "./jobs";
import { useNow } from "./useActivity";

/**
 * Background work, in the status bar, from any screen:
 *
 *   ⠹ writing notes, part 2 of 5 [███░░] 1m 12s ▴
 *
 * The status bar because it is the one place always on screen. Notes take
 * minutes, and a user who cannot see that they are still being written will
 * reasonably press regenerate, or start something else heavy, to find out.
 * Opens into each job's steps and a way to the note.
 *
 * Renders nothing when nothing is running. An idle indicator would be one
 * more thing to learn to ignore.
 */
export function ActivityEntry({
  jobs,
  onOpenNote,
}: {
  jobs: Job[];
  onOpenNote?: ((path: string) => void) | undefined;
}) {
  const running = jobs.filter(isRunning);
  const now = useNow(running.length > 0);

  // The job actually working goes first; the rest are queued behind it.
  const lead = running.find((j) => !isQueued(j)) ?? running[0];
  if (!lead) return null;

  const since = startedAt(lead);
  const parts = partsDone(lead);
  const waiting = running.length - 1;

  return (
    <Popover
      label="Background work"
      title="What TRACE is working on"
      placement="above"
      wide
      trigger={
        <>
          <Spinner className="text-phosphor" />
          <span className="truncate text-ink">{headline(lead)}</span>
          {parts && (
            <Gauge
              value={parts.done / parts.total}
              label={`${parts.done} of ${parts.total} parts written`}
              className="w-10"
            />
          )}
          {since !== null && (
            <span className="shrink-0 tabular-nums">{formatDuration(now - since)}</span>
          )}
          {waiting > 0 && <span className="shrink-0 text-ink-faint">+{waiting} queued</span>}
          <span aria-hidden className="text-ink-faint">
            ▴
          </span>
        </>
      }
    >
      {(close) => (
        <>
          {running.map((job, i) => (
            <div key={job.id} className="flex flex-col">
              {i > 0 && <PopoverDivider />}
              <PopoverHeading>{job.title || "Untitled meeting"}</PopoverHeading>
              <div className="px-3 pb-2">
                <JobSteps job={job} now={now} />
              </div>
              {onOpenNote && (
                <PopoverItem
                  onSelect={() => {
                    close();
                    onOpenNote(job.notePath);
                  }}
                >
                  Open note
                </PopoverItem>
              )}
            </div>
          ))}
          <PopoverDivider />
          <p className="px-3 py-1 text-2xs text-ink-faint">
            Runs on this machine, one meeting at a time. You can keep reading, and recording,
            meanwhile.
          </p>
        </>
      )}
    </Popover>
  );
}
