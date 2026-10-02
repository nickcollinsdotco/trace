import { useEffect, useState } from "react";
import { CHANGELOG } from "../../changelog";
import { Section } from "../../components/ui/terminal";
import { markWhatsNewSeen, unseenChanges } from "./changesSeen";

/** Enough to cover an update or two; the rest are a click away. */
const SHOWN = 5;

/**
 * The changelog, as the terminal would print it.
 *
 * Versions not looked at before are marked, and showing them is what marks
 * them seen — the status bar's "what's new" goes quiet once this has been on
 * screen. Which ones were new is taken before that, so the marks stay while
 * they are being read.
 */
export function WhatsNew() {
  const [fresh] = useState(() => new Set(unseenChanges().map((c) => c.version)));
  const [all, setAll] = useState(false);

  useEffect(() => {
    markWhatsNewSeen();
  }, []);

  const entries = all ? CHANGELOG : CHANGELOG.slice(0, SHOWN);

  return (
    <Section title="What's new">
      <div className="flex flex-col gap-4 font-mono text-xs">
        <p className="text-ink-faint">
          <span className="text-phosphor">$</span> trace --changelog
        </p>
        {entries.map((change, i) => (
          <article key={change.version} className="flex flex-col gap-1">
            <h3 className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="text-phosphor tabular-nums">{change.version}</span>
              <span className="text-ink-faint">{formatDate(change.date)}</span>
              <span className="font-sans text-sm text-ink">{change.title}</span>
              {i === 0 && <span className="text-ink-faint">← this build</span>}
              {fresh.has(change.version) && (
                <span className="rounded-xs bg-phosphor-dim px-1 text-2xs text-phosphor">new</span>
              )}
            </h3>
            <ul className="flex flex-col gap-0.5 pl-4 font-sans text-sm text-ink-muted">
              {change.notes.map((note) => (
                <li key={note} className="flex gap-2">
                  <span aria-hidden className="font-mono text-ink-faint">
                    ·
                  </span>
                  {note}
                </li>
              ))}
            </ul>
          </article>
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
    </Section>
  );
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
