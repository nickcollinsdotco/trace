import { Prompt, SystemLabel } from "../../components/ui/terminal";

/**
 * The preview's contents: a little of everything a theme changes, sitting
 * together as it would in the app — the wordmark, a title, tags, a section
 * in its frame, a transcript line, buttons and a field. Spans throughout:
 * it is a picture, hidden from screen readers, not a second page.
 */
export function ThemeSample() {
  return (
    <div aria-hidden data-mode="reading" className="flex flex-col gap-4 bg-surface-0 p-5">
      <span className="flex items-center justify-between gap-3">
        <span className="trace-wordmark font-mono text-sm font-medium tracking-system text-ink">
          Trace
          <span className="trace-cursor" />
        </span>
        <span className="trace-btn trace-btn-secondary rounded-pill bg-surface-2">
          + New meeting
        </span>
      </span>
      <span className="trace-title text-2xl text-ink">Pricing page rework</span>
      <span className="flex flex-wrap gap-2 font-mono text-2xs">
        <span className="trace-tag rounded-sm bg-phosphor-dim px-1.5 py-0.5 text-phosphor">
          client
        </span>
        <span className="trace-tag rounded-sm bg-phosphor-dim px-1.5 py-0.5 text-phosphor">
          pricing
        </span>
      </span>
      <span className="trace-section gap-2">
        <span className="trace-section-head">
          <span aria-hidden className="trace-section-corner font-mono text-2xs text-ink-faint/50">
            ┌
          </span>
          <SystemLabel>Decisions</SystemLabel>
          <span aria-hidden className="trace-rule" />
        </span>
        <span className="trace-prose text-sm text-ink">
          Ship the pricing page on Friday, without the annual toggle.
        </span>
        <span className="flex gap-3 text-sm">
          <span className="font-mono text-2xs text-ink-faint tabular-nums">00:42</span>
          <span className="font-mono text-2xs trace-caps-label tracking-system text-phosphor-muted">
            them
          </span>
          <span className="text-ink-muted">It's the most expensive part of the page.</span>
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <span className="trace-btn trace-btn-primary">Write notes</span>
        <span className="trace-btn trace-btn-quiet">Not now</span>
        <span className="trace-field ml-auto w-auto min-w-40 font-mono text-xs text-ink-faint">
          <Prompt />
          search
        </span>
      </span>
    </div>
  );
}
