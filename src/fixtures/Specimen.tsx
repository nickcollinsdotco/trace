import { type ReactNode, useEffect, useRef, useState } from "react";
import { Page } from "../components/ui/Page";
import { PopoverDivider, PopoverHeading, PopoverItem } from "../components/ui/Popover";
import { SwitchLook } from "../components/ui/Switch";
import {
  BootLine,
  Elapsed,
  Gauge,
  Meter,
  Prompt,
  Section,
  Spinner,
  StatusDot,
  SystemLabel,
} from "../components/ui/terminal";

/**
 * One of every kind of element, in situ, for judging a theme.
 *
 * Built from the app's own components and classes, never copies of them, so
 * what changes here is what changes in the app. Each piece is captioned
 * with the role or token that styles it — the thing an adjustment on the
 * Appearance page, or a line in themes.css, would move.
 */
export function Specimen() {
  const root = useRef<HTMLDivElement>(null);
  const look = useLook(root);

  return (
    <Page className="gap-10">
      <div ref={root} className="flex flex-col gap-2">
        <h1 className="trace-title text-2xl text-ink">Specimen</h1>
        <p className="font-mono text-2xs text-ink-faint">
          theme {look.theme} · {look.family} · frame {look.frame} · type {look.type} · mono{" "}
          {look.mono} · capitals {look.case} · fields {look.field}
        </p>
      </div>

      <Section title="Type and hierarchy">
        <Row note=".trace-title · text-2xl">
          <span className="trace-title text-2xl text-ink">Pricing page rework</span>
        </Row>
        <Row note="ink · prose · the text that is read">
          <p className="trace-prose text-base text-ink">
            Sarah walked through the drop-off data: most visitors leave at the comparison table
            rather than at the price itself.
          </p>
        </Row>
        <Row note="ink-muted · what supports it">
          <p className="text-sm text-ink-muted">Recorded on this machine · 47 min · two voices</p>
        </Row>
        <Row note="ink-faint · the quietest">
          <p className="text-2xs text-ink-faint">Notes are saved to Documents\TRACE</p>
        </Row>
        <Row note="ink-faint at reduced opacity · disabled">
          <p className="text-sm text-ink-faint opacity-50">Not available while recording</p>
        </Row>
        <Row note="font-mono · system voice, with Prompt">
          <p className="font-mono text-xs text-ink-muted">
            <Prompt />
            no traces yet.
          </p>
        </Row>
        <Row note="phosphor · the accent">
          <p className="font-mono text-sm text-phosphor">✓ saved · writing notes…</p>
        </Row>
        <Row note="warn · error">
          <p className="flex gap-4 font-mono text-xs">
            <span className="text-warn">transcription fell behind</span>
            <span className="text-error">the microphone stopped</span>
          </p>
        </Row>
        <Row note="tabular figures · Elapsed · kbd">
          <span className="flex items-center gap-4">
            <Elapsed ms={2_552_000} />
            <kbd className="rounded-xs border border-line px-1.5 font-mono text-2xs text-ink-faint">
              Ctrl+K
            </kbd>
          </span>
        </Row>
      </Section>

      <Section title="Capitals">
        <p className="text-sm text-ink-muted">
          This theme is on <span className="text-ink">{look.case}</span>. Each step adds a row
          below; notes and transcripts are on none of them.
        </p>
        <Row note="labels · .trace-system-label">
          <SystemLabel tone="muted">Section label</SystemLabel>
        </Row>
        <Row note="labels · .trace-tag">
          <span className="flex gap-2 font-mono text-2xs">
            <span className="trace-tag rounded-sm bg-phosphor-dim px-1.5 py-0.5 text-phosphor">
              client
            </span>
            <span className="trace-tag rounded-pill px-2 py-0.5 text-ink-muted">pricing</span>
          </span>
        </Row>
        <Row note="controls · .trace-btn · .trace-nav">
          <span className="flex items-center gap-3">
            <button type="button" className="trace-btn trace-btn-secondary trace-press">
              Download
            </button>
            <span className="trace-nav font-mono text-sm text-ink-muted">Appearance</span>
          </span>
        </Row>
        <Row note="headings · .trace-title">
          <span className="trace-title text-lg text-ink">Weekly sync</span>
        </Row>
      </Section>

      <Section title="Buttons">
        <Row note=".trace-btn-primary · secondary · quiet">
          <span className="flex flex-wrap items-center gap-2">
            <button type="button" className="trace-btn trace-btn-primary trace-press">
              Write notes
            </button>
            <button type="button" className="trace-btn trace-btn-secondary trace-press">
              Open folder
            </button>
            <button type="button" className="trace-btn trace-btn-quiet trace-press">
              Not now
            </button>
          </span>
        </Row>
        <Row note="disabled · pill · danger on hover">
          <span className="flex flex-wrap items-center gap-2">
            <button type="button" disabled className="trace-btn trace-btn-primary trace-press">
              Write notes
            </button>
            <button
              type="button"
              className="trace-btn trace-btn-secondary rounded-pill bg-surface-2 trace-press"
            >
              + New meeting
            </button>
            <button
              type="button"
              className="trace-btn trace-btn-quiet trace-press hover:text-error"
            >
              Discard
            </button>
          </span>
        </Row>
        <Row note="pressed and not · .trace-pill">
          <span className="flex items-center gap-2">
            <button
              type="button"
              aria-pressed
              className="trace-pill trace-tag rounded-pill border border-phosphor bg-phosphor-dim px-3 py-1 font-mono text-xs text-phosphor"
            >
              All 6
            </button>
            <button
              type="button"
              aria-pressed={false}
              className="trace-pill trace-tag rounded-pill border border-transparent px-3 py-1 font-mono text-xs text-ink-muted"
            >
              internal 1
            </button>
          </span>
        </Row>
        <Row note="icon buttons · 28px">
          <span className="flex items-center gap-1 text-ink-faint">
            {["‹", "⋮", "↻", "×"].map((g) => (
              <button
                key={g}
                type="button"
                aria-label={g}
                className="flex size-7 items-center justify-center rounded-sm font-mono text-sm trace-press hover:bg-surface-2 hover:text-ink"
              >
                {g}
              </button>
            ))}
          </span>
        </Row>
      </Section>

      <Section title="Fields">
        <Row note=".trace-field · text">
          <input
            aria-label="Text field"
            className="trace-field text-sm"
            defaultValue="Weekly sync"
          />
        </Row>
        <Row note="search · a > on a line, a magnifier in a box">
          <span className="relative block">
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 font-mono text-sm text-phosphor"
            >
              <span className="trace-glyph trace-field-prompt">&gt;</span>
              <span className="trace-field-icon text-ink-faint">⌕</span>
            </span>
            <input
              aria-label="Search field"
              placeholder="Search, or filter — tag:client"
              style={{ paddingLeft: "2.6rem" }}
              className="trace-field trace-field-pill font-mono text-sm"
            />
          </span>
        </Row>
        <Row note="select · fitted with w-auto">
          <select aria-label="Select" className="trace-field w-auto self-start py-1.5 text-sm">
            <option>Delete once notes are written</option>
            <option>Keep the latest 5</option>
          </select>
        </Row>
        <Row note="textarea · notes">
          <textarea
            aria-label="Notes"
            rows={3}
            className="trace-field resize-none text-sm"
            defaultValue={"pricing: drop the annual toggle?\n- Sarah to share the funnel"}
          />
        </Row>
        <Row note="the meeting title · one prompt, no box">
          <span className="trace-title-prompt flex items-center gap-3">
            <span aria-hidden className="trace-title-mark font-mono text-2xl text-phosphor">
              &gt;
            </span>
            <span className="relative min-w-0 flex-1">
              <input
                aria-label="Meeting title"
                placeholder="Untitled meeting"
                className="trace-field trace-title-input text-2xl"
              />
              <span
                aria-hidden
                className="trace-title-hint pointer-events-none absolute inset-0 flex items-center text-2xl text-ink-faint"
              >
                <span className="trace-cursor" />
                <span className="ml-2 truncate">Untitled meeting</span>
              </span>
            </span>
          </span>
        </Row>
        <Row note="checkbox · radio · switch · slider">
          <span className="flex flex-wrap items-center gap-6 text-sm text-ink">
            <label className="flex items-center gap-2">
              <input type="checkbox" defaultChecked className="size-3.5 accent-phosphor" />
              Fun mode
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="specimen"
                defaultChecked
                className="size-3.5 accent-phosphor"
              />
              On
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="specimen" className="size-3.5 accent-phosphor" />
              Off
            </label>
            <span className="flex items-center gap-2">
              <SwitchLook on />
              <SwitchLook on={false} />
            </span>
            <input
              type="range"
              aria-label="Amount"
              defaultValue={40}
              className="w-32 accent-phosphor"
            />
          </span>
        </Row>
      </Section>

      <Section title="State">
        <Row note="StatusDot">
          <span className="flex flex-wrap gap-4">
            <StatusDot state="idle" />
            <StatusDot state="capturing" />
            <StatusDot state="processing" />
            <StatusDot state="error" />
          </span>
        </Row>
        <Row note="Meter · a hot one · Gauge · Spinner">
          <span className="flex flex-col gap-2">
            <Meter label="MIC" level={0.55} db={-14} />
            <Meter label="SYS" level={0.96} db={-1} />
            <span className="flex items-center gap-3 font-mono text-2xs text-ink-muted">
              <Gauge value={0.4} label="2 of 5" /> 2/5
              <Spinner className="text-phosphor" />
            </span>
          </span>
        </Row>
        <Row note="BootLine · the leader dots">
          <span className="flex flex-col">
            <BootLine label="loading context" state="ok" />
            <BootLine label="writing notes" state="active" />
            <BootLine label="reaching Ollama" state="failed" />
          </span>
        </Row>
        <Row note="banners · warn-dim · error-dim">
          <span className="flex flex-col gap-2">
            <p className="border-l-2 border-warn bg-warn-dim px-3 py-2 text-sm text-warn">
              Transcription fell behind; the live transcript has gaps.
            </p>
            <p className="border-l-2 border-error bg-error-dim px-3 py-2 text-sm text-error">
              The microphone stopped. What was captured is safe.
            </p>
          </span>
        </Row>
      </Section>

      <Section
        title="A boxed section's corner"
        actions={
          <button
            type="button"
            className="trace-control font-mono text-2xs tracking-system text-ink-faint trace-press hover:text-ink"
          >
            Reset
          </button>
        }
      >
        <Row note="surface-2 · the popover's ground">
          <div className="w-64 rounded-md border border-line-strong bg-surface-2 py-1 shadow-(--elevation-overlay)">
            <PopoverHeading>Transcription</PopoverHeading>
            <PopoverItem current onSelect={() => {}} detail="25 European languages">
              Parakeet v3
            </PopoverItem>
            <PopoverItem onSelect={() => {}} detail="English only">
              Parakeet v2
            </PopoverItem>
            <PopoverDivider />
            <PopoverItem disabled onSelect={() => {}}>
              Manage models…
            </PopoverItem>
          </div>
        </Row>
        <Row note="transcript · speakers · timestamps">
          <div className="flex flex-col gap-1.5 text-sm">
            {[
              ["00:42", "you", "Can we drop the annual toggle?"],
              ["00:47", "them", "It's the most expensive part of the page."],
            ].map(([t, who, line]) => (
              <p key={t} className="flex gap-3">
                <span className="w-12 shrink-0 font-mono text-2xs text-ink-faint tabular-nums">
                  {t}
                </span>
                <span
                  className={`w-10 shrink-0 font-mono text-2xs trace-caps-label tracking-system ${
                    who === "them" ? "text-phosphor-muted" : "text-ink-faint"
                  }`}
                >
                  {who}
                </span>
                <span className="text-ink">{line}</span>
              </p>
            ))}
          </div>
        </Row>
        <Row note="an action item">
          <label className="flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" className="mt-1 size-3.5 accent-phosphor" />
            Sarah to share the funnel by Friday
          </label>
        </Row>
      </Section>
    </Page>
  );
}

function Row({ note, children }: { note: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-x-6 gap-y-1">
      {/* A fixed size, so the captions read the same in every theme's scale. */}
      <span className="pt-1 font-mono text-[10px] leading-snug text-ink-faint">{note}</span>
      <div className="flex min-w-0 flex-col">{children}</div>
    </div>
  );
}

const AXES = ["theme", "family", "frame", "type", "mono", "case", "field"] as const;
type Look = Record<(typeof AXES)[number], string>;

/**
 * What the element carrying the theme says right now, read from its
 * attributes and watched, so the header follows the gallery's switches.
 */
function useLook(at: React.RefObject<HTMLElement | null>): Look {
  const [look, setLook] = useState<Look>(
    () => Object.fromEntries(AXES.map((a) => [a, "—"])) as Look,
  );
  useEffect(() => {
    let watch: MutationObserver | undefined;
    let frame = 0;
    // The look is applied by an ancestor's effect, which runs after this
    // one: wait the frame or two until there is something to read.
    const attach = () => {
      const themed = at.current?.closest("[data-family]");
      if (!themed) {
        frame = requestAnimationFrame(attach);
        return;
      }
      const read = () =>
        setLook(
          Object.fromEntries(
            AXES.map((a) => [
              a,
              themed.getAttribute(`data-${a}`) ?? (a === "theme" ? "carbon" : "—"),
            ]),
          ) as Look,
        );
      read();
      watch = new MutationObserver(read);
      watch.observe(themed, { attributes: true });
    };
    attach();
    return () => {
      cancelAnimationFrame(frame);
      watch?.disconnect();
    };
  }, [at]);
  return look;
}
