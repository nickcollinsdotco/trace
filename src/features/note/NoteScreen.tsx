import { useCallback, useEffect, useMemo, useState } from "react";
import { SectionHead, SystemLabel } from "../../components/ui/terminal";
import { hasBackend, ipc } from "../../lib/ipc";
import { RefinementNotice } from "./RefinementNotice";
import { splitSections } from "./sections";
import { useNoteRefinement } from "./useNoteRefinement";

/**
 * Reading mode — quiet, editorial, high readability.
 *
 * The Markdown is rendered with a small hand-written formatter rather than a
 * library: notes only ever contain the handful of constructs TRACE itself
 * writes, and a full Markdown pipeline would be a large dependency serving no
 * purpose here.
 */

/**
 * Which half of the note is shown.
 *
 * The user's typed notes and the model's output are different kinds of thing —
 * one was written by a person and is never altered, the other is generated and
 * can be regenerated or ignored. Presenting them as one undifferentiated
 * document makes it impossible to tell which is which, which is exactly the
 * confusion a tool like this must not create.
 */
type View = "enhanced" | "mine";

export function NoteScreen({ path, onBack }: { path: string; onBack: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    void ipc
      .readNote(path)
      .then(setText)
      .catch((e) => setError(String(e)));
  }, [path]);

  // Stable, so the subscription is not torn down and rebuilt on every render.
  const reload = useCallback((t: string) => setText(t), []);
  const stage = useNoteRefinement(path, reload);

  const sections = useMemo(() => (text === null ? null : splitSections(text)), [text]);

  // Default to whichever half exists rather than forcing a choice.
  useEffect(() => {
    if (view !== null || sections === null) return;
    setView(sections.hasEnhanced ? "enhanced" : "mine");
  }, [sections, view]);

  async function regenerate() {
    setRegenerating(true);
    setError(null);
    try {
      await ipc.regenerateNotes(path);
    } catch (e) {
      setError(String(e));
    } finally {
      setRegenerating(false);
    }
  }

  const active = view ?? "mine";

  return (
    <div data-mode="reading" className="h-full overflow-y-auto">
      <div className="trace-measure flex flex-col gap-6 px-6 py-10">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="font-mono text-2xs uppercase tracking-system text-ink-faint transition-colors duration-120 hover:text-phosphor"
          >
            &lt; Meetings
          </button>
          <span aria-hidden className="trace-rule" />

          {sections && (
            <ViewToggle
              view={active}
              hasEnhanced={sections.hasEnhanced}
              onChange={setView}
              onRegenerate={regenerate}
              regenerating={regenerating}
            />
          )}
        </div>

        {error && <p className="font-mono text-xs text-error">&gt; {error}</p>}
        {text === null && !error && (
          <p className="font-mono text-xs text-ink-faint">&gt; reading…</p>
        )}

        <RefinementNotice stage={stage} />

        {sections && (
          <>
            <NoteBody markdown={sections.head} />

            {active === "enhanced" ? (
              sections.hasEnhanced ? (
                <NoteBody markdown={sections.enhanced} />
              ) : (
                <NotEnhancedYet onRegenerate={regenerate} regenerating={regenerating} />
              )
            ) : sections.hasNotes ? (
              <NoteBody markdown={sections.notes} />
            ) : (
              <p className="font-mono text-xs text-ink-faint">
                &gt; no notes were typed during this meeting.
              </p>
            )}

            {/* The transcript sits under both views: it is the evidence for
                the enhanced half and the context for the user's own. Collapsed
                so it does not bury either. */}
            {sections.transcript && (
              <details className="mt-4">
                <summary className="cursor-pointer list-none">
                  <SystemLabel tone="muted">Transcript</SystemLabel>
                </summary>
                <div className="mt-4">
                  <NoteBody markdown={sections.transcript} />
                </div>
              </details>
            )}

            {sections.footer && <NoteBody markdown={sections.footer} />}
          </>
        )}

        {text !== null && (
          <p className="pt-6 font-mono text-2xs text-ink-faint" data-selectable>
            {path}
          </p>
        )}
      </div>
    </div>
  );
}

function ViewToggle({
  view,
  hasEnhanced,
  onChange,
  onRegenerate,
  regenerating,
}: {
  view: View;
  hasEnhanced: boolean;
  onChange: (v: View) => void;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <Segment active={view === "mine"} onClick={() => onChange("mine")}>
        My notes
      </Segment>
      <Segment active={view === "enhanced"} onClick={() => onChange("enhanced")}>
        {/* Marked as generated wherever it appears, so the distinction is
            never something the reader has to remember. */}
        <span aria-hidden>✦</span> Enhanced
      </Segment>

      {hasEnhanced && hasBackend() && (
        <button
          type="button"
          onClick={onRegenerate}
          disabled={regenerating}
          title="Generate the notes again from the transcript"
          className="ml-1 rounded-sm px-2 py-1 font-mono text-2xs text-ink-faint transition-colors duration-120 hover:text-phosphor disabled:opacity-50"
        >
          {regenerating ? "…" : "↻"}
        </button>
      )}
    </div>
  );
}

function Segment({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-sm border px-2.5 py-1 font-mono text-2xs uppercase tracking-system transition-colors duration-120 ${
        active
          ? "border-phosphor bg-phosphor-dim text-phosphor"
          : "border-transparent text-ink-faint hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function NotEnhancedYet({
  onRegenerate,
  regenerating,
}: {
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  return (
    <div className="flex flex-col items-start gap-3 py-8">
      <p className="font-mono text-xs text-ink-faint">&gt; no generated notes for this meeting.</p>
      <p className="text-sm text-ink-muted">
        Notes are written automatically when a meeting ends. This one has none — the model may not
        have been available at the time.
      </p>
      {hasBackend() && (
        <button
          type="button"
          onClick={onRegenerate}
          disabled={regenerating}
          className="rounded-sm border border-phosphor px-3 py-1.5 font-mono text-2xs uppercase tracking-system text-phosphor transition-colors duration-120 hover:bg-phosphor hover:text-surface-0 disabled:opacity-50"
        >
          {regenerating ? "Generating…" : "Generate now"}
        </button>
      )}
    </div>
  );
}

function NoteBody({ markdown }: { markdown: string }) {
  const { body } = splitFrontmatter(markdown);
  const blocks = body.split("\n\n").filter((b) => b.trim().length > 0);

  return (
    <article data-selectable className="trace-prose flex flex-col gap-4">
      {blocks.map((block, i) => (
        // Blocks have no stable identity of their own; index is the honest key
        // for a static, non-reorderable rendering of a file's contents.
        // biome-ignore lint/suspicious/noArrayIndexKey: static document render
        <Block key={i} text={block.trim()} />
      ))}
    </article>
  );
}

function Block({ text }: { text: string }) {
  if (text.startsWith("# ")) {
    return <h1 className="trace-title text-2xl text-ink">{text.slice(2)}</h1>;
  }
  if (text.startsWith("## ")) {
    return (
      <div className="mt-4">
        <SectionHead title={text.slice(3)} />
      </div>
    );
  }
  if (text.startsWith("---")) {
    return <hr className="my-2 border-line" />;
  }

  const lines = text.split("\n");

  // Checkbox lists carry state the user can see at a glance, so they get
  // rendered as real checkboxes rather than literal bracket characters.
  if (lines.every((l) => l.startsWith("- ["))) {
    return (
      <ul className="flex flex-col gap-1.5">
        {lines.map((line) => {
          const done = line.startsWith("- [x]") || line.startsWith("- [X]");
          return (
            <li key={line} className="flex items-baseline gap-2 text-base">
              <span className={done ? "text-phosphor" : "text-ink-faint"}>{done ? "☑" : "☐"}</span>
              <span className={done ? "text-ink-muted line-through" : "text-ink"}>
                {line.replace(/^- \[[ xX]\] /, "")}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  if (lines.every((l) => l.startsWith("- "))) {
    return (
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-base text-ink marker:text-ink-faint">
        {lines.map((line) => (
          <li key={line}>{line.slice(2)}</li>
        ))}
      </ul>
    );
  }

  // Transcript lines: **you** `00:12` — text
  if (text.startsWith("**")) {
    const match = text.match(/^\*\*(.+?)\*\* `(.+?)` — ([\s\S]*)$/);
    if (match) {
      const [, speaker, time, said] = match;
      return (
        <p className="flex gap-3 font-mono text-xs">
          <span className="shrink-0 tabular-nums text-ink-faint">{time}</span>
          <span className="w-12 shrink-0 uppercase tracking-system text-phosphor-muted">
            {speaker}
          </span>
          <span className="text-ink">{said}</span>
        </p>
      );
    }
  }

  if (text.startsWith("*") && text.endsWith("*")) {
    return <p className="text-xs italic text-ink-faint">{text.replace(/^\*|\*$/g, "")}</p>;
  }

  return <p className="text-lg leading-relaxed text-ink">{text}</p>;
}

/** Split YAML frontmatter from the body. */
function splitFrontmatter(markdown: string): { frontmatter: string; body: string } {
  if (!markdown.startsWith("---\n")) {
    return { frontmatter: "", body: markdown };
  }
  const end = markdown.indexOf("\n---\n", 4);
  if (end === -1) return { frontmatter: "", body: markdown };

  return {
    frontmatter: markdown.slice(4, end),
    body: markdown.slice(end + 5),
  };
}
