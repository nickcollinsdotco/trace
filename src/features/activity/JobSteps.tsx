import { Spinner } from "../../components/ui/terminal";
import type { Job } from "../../lib/ipc";
import { formatDuration, isQueued, partsTotal, stepLabel } from "./jobs";

/**
 * A job's steps as a boot-sequence listing:
 *
 *   [01] full-quality transcript ........ ✓ 38s
 *   [02] part 1 of 3 .................... ⠹ 22s
 *   [03] part 2 of 3
 *
 * Steps still to come are listed faint rather than hidden. Knowing there are
 * two parts left is what makes a long wait bearable; a spinner alone gives
 * no sense of how far along it is.
 */
export function JobSteps({ job, now }: { job: Job; now: number }) {
  return (
    <div className="flex flex-col gap-1 font-mono text-2xs">
      {isQueued(job) && (
        <p className="text-ink-faint">&gt; queued — one meeting's notes are written at a time</p>
      )}
      <ol className="flex flex-col gap-1">
        {job.steps.map((step, i) => {
          const running = step.startedAt !== null && step.finishedAt === null;
          const done = step.finishedAt !== null && !step.failed;
          const took = step.startedAt === null ? null : (step.finishedAt ?? now) - step.startedAt;

          return (
            <li
              // Steps are rebuilt from each snapshot and never reordered, so
              // position is a stable identity.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              key={i}
              aria-current={running ? "step" : undefined}
              className="flex items-baseline gap-1.5"
            >
              <span className="shrink-0 tabular-nums text-ink-faint">
                [{String(i + 1).padStart(2, "0")}]
              </span>
              {/* Labels hold their width and the dotted leader gives way;
                  otherwise its long run of dots squeezes them onto three lines. */}
              <span
                className={`shrink-0 whitespace-nowrap ${
                  step.failed
                    ? "text-error"
                    : step.startedAt === null
                      ? "text-ink-faint"
                      : "text-ink"
                }`}
              >
                {stepLabel(step, partsTotal(job))}
              </span>
              <span aria-hidden className="trace-leader" />
              {running && <Spinner className="text-phosphor" />}
              {done && (
                <span aria-hidden className="text-phosphor">
                  ✓
                </span>
              )}
              {step.failed && <span className="text-error">FAIL</span>}
              {took !== null && (
                <span className="w-12 shrink-0 text-right tabular-nums text-ink-muted">
                  {formatDuration(took)}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
