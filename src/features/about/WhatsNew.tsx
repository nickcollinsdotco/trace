import { useEffect, useState } from "react";
import { CHANGELOG, type Change } from "../../changelog";
import { Collapsible } from "../../components/ui/terminal";
import { markWhatsNewSeen, unseenChanges } from "./changesSeen";

/** Enough to cover an update or two; the rest are a click away. */
const SHOWN = 5;

/**
 * The changelog, as the terminal would print it.
 *
 * Closed unless it was asked for — from the status bar's "what's new" or the
 * palette — because the notes run long and About is mostly visited for
 * something else. Opening it is what marks the changes seen, so the status
 * bar's link stays until they have actually been on screen.
 */
export function WhatsNew({ open = false }: { open?: boolean | undefined }) {
  return (
    <Collapsible title="What's new" defaultOpen={open}>
      <Changelog />
    </Collapsible>
  );
}

/**
 * Mounted only while the section is open. Which versions were new is taken
 * before they are marked seen, so the marks stay while they are being read.
 */
function Changelog() {
  const [fresh] = useState(() => new Set(unseenChanges().map((c) => c.version)));
  const [all, setAll] = useState(false);

  useEffect(() => {
    markWhatsNewSeen();
  }, []);

  const entries = all ? CHANGELOG : CHANGELOG.slice(0, SHOWN);

  return (
    <div className="flex flex-col gap-4 font-mono text-xs">
      <p className="text-ink-faint">
        <span className="text-phosphor">$</span> trace --changelog
      </p>
      {entries.map((change, i) => (
        <Entry
          key={change.version}
          change={change}
          current={i === 0}
          fresh={fresh.has(change.version)}
        />
      ))}
      {CHANGELOG.length > SHOWN && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="self-start rounded-sm px-1 text-ink-faint trace-press hover:text-ink"
        >
          {all ? "fewer" : `all ${CHANGELOG.length} versions`}
        </button>
      )}
    </div>
  );
}

/**
 * One version, its notes cut to a line each until it is opened. The notes
 * are written as sentences for whoever reads them in full, and a dozen
 * versions of them at length buried the one just installed. Unread versions
 * open already: those are the ones someone came to read.
 */
function Entry({ change, current, fresh }: { change: Change; current: boolean; fresh: boolean }) {
  const [open, setOpen] = useState(fresh);

  return (
    <article className="flex flex-col gap-1">
      <h3>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-xs text-left trace-press hover:[&_.trace-entry-title]:text-phosphor"
        >
          <span aria-hidden className="w-2.5 text-2xs text-ink-faint">
            {open ? "▾" : "▸"}
          </span>
          <span className="text-phosphor tabular-nums">{change.version}</span>
          <span className="text-ink-faint">{formatDate(change.date)}</span>
          <span className="trace-entry-title font-sans text-sm text-ink">{change.title}</span>
          {current && <span className="text-ink-faint">← this build</span>}
          {fresh && (
            <span className="rounded-xs bg-phosphor-dim px-1 text-2xs text-phosphor">new</span>
          )}
        </button>
      </h3>
      <ul className="flex flex-col gap-0.5 pl-9 font-sans text-sm text-ink-muted">
        {change.notes.map((note) => (
          <li key={note} className="flex min-w-0 gap-2">
            <span aria-hidden className="font-mono text-ink-faint">
              ·
            </span>
            <span className={open ? "" : "line-clamp-1"}>{note}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
