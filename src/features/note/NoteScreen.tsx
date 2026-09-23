import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Collapsible, SectionHead } from "../../components/ui/terminal";
import { hasBackend, ipc, type LlmStatus, type NoteContext } from "../../lib/ipc";
import { LlmNotice } from "../llm/LlmNotice";
import { useLlmStatus } from "../llm/useLlmStatus";
import { RefinementNotice } from "./RefinementNotice";
import { splitParts, splitSections, splitTitle } from "./sections";
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

export function NoteScreen({
  path,
  onBack,
  onSearchTag,
}: {
  path: string;
  onBack: () => void;
  /** Optional: clicking a tag searches for it back in the library. */
  onSearchTag?: ((tag: string) => void) | undefined;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  // Set once the user picks a half, after which nothing switches it for them.
  const [picked, setPicked] = useState(false);
  // Only bridges the moment between the press and the backend listing the
  // job; after that the job itself says the note is busy.
  const [requesting, setRequesting] = useState(false);
  /*
   * Whether the journal behind this note still exists.
   *
   * Notes finalised before the journal survived synthesis can never be
   * regenerated. Asking up front means the control can say so, instead of
   * looking available and failing when pressed.
   */
  const [replayable, setReplayable] = useState(false);

  const [about, setAbout] = useState<NoteContext>({ context: "", participants: [] });

  useEffect(() => {
    void ipc
      .readNote(path)
      .then(setText)
      .catch((e) => setError(String(e)));

    if (!hasBackend()) return;
    void ipc
      .canRegenerate(path)
      .then(setReplayable)
      .catch(() => setReplayable(false));
    void ipc
      .noteContext(path)
      .then(setAbout)
      .catch(() => {});
  }, [path]);

  // Stable, so the subscription is not torn down and rebuilt on every render.
  const reload = useCallback((t: string) => setText(t), []);
  const job = useNoteRefinement(path, reload);
  const busy = requesting || (job !== null && job.outcome === null);
  const llm = useLlmStatus();

  const sections = useMemo(() => (text === null ? null : splitSections(text)), [text]);

  /*
   * Open on the generated half unless the user typed notes and nothing has
   * been generated. A meeting with neither used to open on "no notes were
   * typed" — a dead end for the common case of taking no notes at all, when
   * the thing wanted is the summary and the way to generate it.
   *
   * Or while notes are being written: that half is where the progress is,
   * and where the summary lands, so the reader is already looking at it.
   */
  useEffect(() => {
    if (view !== null || sections === null) return;
    setView(sections.hasEnhanced || !sections.hasNotes || busy ? "enhanced" : "mine");
  }, [sections, view, busy]);

  // The note and the job list load separately, so the job can arrive after
  // the half was chosen above. Only ever towards the generated half, and
  // never over the user's own choice.
  useEffect(() => {
    if (busy && !picked) setView("enhanced");
  }, [busy, picked]);

  async function regenerate() {
    setRequesting(true);
    setError(null);
    try {
      await ipc.regenerateNotes(path);
    } catch (e) {
      setError(String(e));
    } finally {
      setRequesting(false);
    }
  }

  const active = view ?? "mine";
  const head = useMemo(() => (sections === null ? null : splitTitle(sections.head)), [sections]);
  /*
   * One name replaces "them" as soon as it is given, before any regeneration
   * rewrites the file. The file still says "them" until then; the reader
   * should not have to wait minutes to see the name they just typed.
   */
  const them = about.participants.length === 1 ? (about.participants[0] ?? null) : null;

  async function saveAbout(next: NoteContext, andRegenerate: boolean) {
    const stored = await ipc.setNoteContext(path, next.context, next.participants);
    setAbout(stored);
    if (andRegenerate) {
      setPicked(true);
      setView("enhanced");
      // Not awaited: the command returns only once the notes are written,
      // minutes later, and the form has nothing left to wait for. Progress
      // and failure arrive through the job, as for the ↻ button.
      void regenerate();
    }
  }

  return (
    <div data-mode="reading" className="h-full overflow-y-auto">
      {/*
        Sticky, title included, so a long note never leaves the reader
        wondering which meeting they are in or reaching back up for the
        controls. Painted with the ground colour so text scrolls under it
        rather than through it.
      */}
      <header className="sticky top-0 z-10 border-b border-line bg-surface-0">
        <div className="trace-measure flex flex-col gap-2 px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="font-mono text-2xs uppercase tracking-system text-ink-faint trace-press hover:text-phosphor"
            >
              &lt; Meetings
            </button>
            <span aria-hidden className="trace-rule" />

            {sections && (
              <ViewToggle
                view={active}
                hasEnhanced={sections.hasEnhanced}
                onChange={(v) => {
                  setPicked(true);
                  setView(v);
                }}
                onRegenerate={regenerate}
                regenerating={busy}
                replayable={replayable}
              />
            )}
          </div>

          {head?.title && (
            <h1 className="trace-title truncate text-2xl text-ink" title={head.title}>
              {head.title}
            </h1>
          )}
        </div>
      </header>

      <div className="trace-measure flex flex-col gap-6 px-6 pt-6 pb-10">
        {error && <p className="font-mono text-xs text-error">&gt; {error}</p>}
        {text === null && !error && (
          <p className="font-mono text-xs text-ink-faint">&gt; reading…</p>
        )}

        <RefinementNotice job={job} />

        <Tags path={path} onSearchTag={onSearchTag} />

        {hasBackend() && sections && (
          <AboutMeeting
            about={about}
            onSave={saveAbout}
            replayable={replayable}
            busy={busy}
            usable={llm.status === null || llm.status.state === "ready"}
          />
        )}

        {sections && head && (
          <>
            {head.rest && <NoteBody markdown={head.rest} them={them} />}

            {active === "enhanced" ? (
              sections.hasEnhanced ? (
                busy ? (
                  <Rewriting>
                    <Parts markdown={sections.enhanced} them={them} />
                  </Rewriting>
                ) : (
                  <Parts markdown={sections.enhanced} them={them} />
                )
              ) : busy ? (
                <NotesPending />
              ) : (
                <NotEnhancedYet
                  llm={llm.status}
                  onRecheck={llm.recheck}
                  onRegenerate={regenerate}
                  regenerating={busy}
                  replayable={replayable}
                />
              )
            ) : sections.hasNotes ? (
              <Parts markdown={sections.notes} them={them} />
            ) : (
              <p className="font-mono text-xs text-ink-faint">
                &gt; no notes were typed during this meeting.
              </p>
            )}

            {/* The transcript sits under both views: it is the evidence for
                the enhanced half and the context for the user's own. Closed
                by default so it does not bury either. */}
            {sections.transcript && (
              <div className="mt-4">
                <Parts markdown={sections.transcript} them={them} closed={["transcript"]} />
              </div>
            )}

            {sections.footer && <NoteBody markdown={sections.footer} them={them} />}
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

/**
 * A half of the note, one framed and collapsible section per `## ` heading.
 *
 * Spaced well apart: sections set as paragraphs a heading's margin apart ran
 * into each other, so the end of one read as the start of the next.
 */
function Parts({
  markdown,
  them,
  closed = [],
}: {
  markdown: string;
  them: string | null;
  /** Headings, lower-case, that start closed. */
  closed?: string[];
}) {
  return (
    <div className="flex flex-col gap-10">
      {splitParts(markdown).map((part, i) =>
        part.heading === null ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: static document render
          <NoteBody key={i} markdown={part.body} them={them} />
        ) : (
          <Collapsible
            // biome-ignore lint/suspicious/noArrayIndexKey: headings can repeat in a hand-edited note
            key={`${i}-${part.heading}`}
            title={part.heading}
            defaultOpen={!closed.includes(part.heading.toLowerCase())}
          >
            <NoteBody markdown={part.body} them={them} />
          </Collapsible>
        ),
      )}
    </div>
  );
}

/**
 * What the user can tell TRACE about a meeting after it has ended.
 *
 * The recording knows only which device heard each voice, so it cannot know
 * that a meeting was an interview or that "them" was Amira. Both change what
 * a good summary says, so both go to the next regeneration — offered in the
 * same press, since that is almost always why someone is filling this in.
 * Saving alone stays possible: fixing a misspelt name should not cost a
 * minutes-long rewrite of notes someone may already have edited.
 */
function AboutMeeting({
  about,
  onSave,
  replayable,
  busy,
  usable,
}: {
  about: NoteContext;
  onSave: (next: NoteContext, andRegenerate: boolean) => Promise<void>;
  replayable: boolean;
  busy: boolean;
  /** Whether Ollama can write notes right now. */
  usable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [context, setContext] = useState(about.context);
  const [names, setNames] = useState(about.participants.join(", "));
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const contextId = useId();
  const namesId = useId();

  function open() {
    setContext(about.context);
    setNames(about.participants.join(", "));
    setFailed(null);
    setEditing(true);
  }

  async function save(andRegenerate: boolean) {
    setSaving(true);
    setFailed(null);
    try {
      await onSave(
        {
          context,
          participants: names
            .split(",")
            .map((n) => n.trim())
            .filter(Boolean),
        },
        andRegenerate,
      );
      setEditing(false);
    } catch (e) {
      setFailed(String(e));
    } finally {
      setSaving(false);
    }
  }

  const empty = about.context === "" && about.participants.length === 0;

  if (!editing) {
    return empty ? (
      <button
        type="button"
        onClick={open}
        className="self-start rounded-sm border border-dashed border-line-strong px-2 py-1 font-mono text-2xs tracking-system text-ink-faint trace-press hover:border-phosphor hover:text-phosphor"
      >
        + Context &amp; names
      </button>
    ) : (
      <button
        type="button"
        onClick={open}
        title="Edit what TRACE knows about this meeting"
        className="group flex flex-col gap-1 self-stretch rounded-sm border border-line px-3 py-2 text-left trace-press hover:border-phosphor"
      >
        {about.participants.length > 0 && (
          <span className="flex items-baseline gap-2">
            <span className="w-16 shrink-0 font-mono text-2xs uppercase tracking-system text-ink-faint">
              With
            </span>
            <span className="text-sm text-ink">{about.participants.join(", ")}</span>
          </span>
        )}
        {about.context && (
          <span className="flex items-baseline gap-2">
            <span className="w-16 shrink-0 font-mono text-2xs uppercase tracking-system text-ink-faint">
              Context
            </span>
            <span className="line-clamp-2 whitespace-pre-line text-sm text-ink-muted">
              {about.context}
            </span>
          </span>
        )}
        <span className="font-mono text-2xs text-ink-faint group-hover:text-phosphor">edit</span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-sm border border-line-strong p-4 trace-panel">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={namesId}
          className="font-mono text-2xs uppercase tracking-system text-ink-muted"
        >
          Who was on the other end?
        </label>
        <input
          id={namesId}
          value={names}
          onChange={(e) => setNames(e.target.value)}
          placeholder="Amira, Tom"
          name="participants"
          autoComplete="off"
          className="trace-field text-sm"
        />
        <p className="text-xs text-ink-faint">
          One name replaces THEM in the transcript. With several, the summary is told who was there,
          but lines stay THEM — the recording cannot tell voices on the call apart.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={contextId}
          className="font-mono text-2xs uppercase tracking-system text-ink-muted"
        >
          What should the summary know?
        </label>
        <textarea
          id={contextId}
          value={context}
          onChange={(e) => setContext(e.target.value)}
          rows={3}
          placeholder="This was a second-round interview with a candidate for the design lead role."
          name="context"
          className="trace-field resize-y text-sm"
        />
        <p className="text-xs text-ink-faint">
          Used to frame the notes. It is never cited, because nobody said it in the meeting.
        </p>
      </div>

      {failed && <p className="font-mono text-xs text-error">&gt; {failed}</p>}

      <div className="flex flex-wrap items-center gap-3">
        {replayable && (
          <button
            type="button"
            onClick={() => save(true)}
            disabled={saving || busy || !usable}
            title={
              busy
                ? "Notes for this meeting are being written"
                : !usable
                  ? "Ollama is not ready, so notes cannot be written now"
                  : undefined
            }
            className="rounded-sm border border-phosphor px-3 py-1.5 font-mono text-2xs uppercase tracking-system text-phosphor trace-press hover:bg-phosphor hover:text-surface-0 disabled:opacity-50"
          >
            Save and regenerate
          </button>
        )}
        <button
          type="button"
          onClick={() => save(false)}
          disabled={saving}
          className="rounded-sm border border-line-strong px-3 py-1.5 font-mono text-2xs uppercase tracking-system text-ink trace-press hover:border-phosphor hover:text-phosphor disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={saving}
          className="font-mono text-2xs uppercase tracking-system text-ink-faint trace-press hover:text-ink disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      {!replayable && (
        <p className="text-xs text-ink-faint">
          Saved with the note. This meeting&apos;s transcript record is no longer on disk, so its
          summary cannot be regenerated with it.
        </p>
      )}
    </div>
  );
}

function ViewToggle({
  view,
  hasEnhanced,
  onChange,
  onRegenerate,
  regenerating,
  replayable,
}: {
  view: View;
  hasEnhanced: boolean;
  onChange: (v: View) => void;
  onRegenerate: () => void;
  regenerating: boolean;
  replayable: boolean;
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
          disabled={regenerating || !replayable}
          title={
            !replayable
              ? "The original transcript record for this meeting is no longer on disk, so it cannot be regenerated."
              : regenerating
                ? "Notes for this meeting are being written"
                : "Generate the notes again from the transcript"
          }
          className="ml-1 rounded-sm px-2 py-1 font-mono text-2xs text-ink-faint trace-press hover:text-phosphor disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-ink-faint"
        >
          ↻
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
      className={`rounded-sm border px-2.5 py-1 font-mono text-2xs uppercase tracking-system trace-press ${
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
  llm,
  onRecheck,
  onRegenerate,
  regenerating,
  replayable,
}: {
  llm: LlmStatus | null;
  onRecheck: () => void;
  onRegenerate: () => void;
  regenerating: boolean;
  replayable: boolean;
}) {
  // Unknown counts as usable: the backend says why if it is not, and a
  // button that is briefly disabled on every open would read as broken.
  const usable = llm === null || llm.state === "ready";

  return (
    <div className="flex flex-col items-start gap-3 py-8">
      <p className="font-mono text-xs text-ink-faint">&gt; no summary for this meeting yet.</p>
      <p className="text-sm text-ink-muted">
        {replayable
          ? "A summary and action items are written automatically when a meeting ends. This one has none — Ollama was probably closed at the time. Generate them from the transcript now."
          : "A summary and action items are written automatically when a meeting ends. This one has none, and its transcript record is no longer on disk, so they cannot be generated now. The transcript below is still complete."}
      </p>
      {replayable && (
        <div className="self-stretch">
          <LlmNotice status={llm} onRecheck={onRecheck} context="note" />
        </div>
      )}
      {hasBackend() && replayable && (
        <button
          type="button"
          onClick={onRegenerate}
          disabled={regenerating || !usable}
          className="rounded-sm border border-phosphor px-3 py-1.5 font-mono text-2xs uppercase tracking-system text-phosphor trace-press hover:bg-phosphor hover:text-surface-0 disabled:opacity-50"
        >
          {regenerating ? "Generating…" : "Generate summary"}
        </button>
      )}
    </div>
  );
}

/**
 * The previous notes, dimmed, while new ones are written.
 *
 * Kept rather than replaced with a placeholder. Someone may be reading them,
 * and if the run fails they are what stays — blanking them and bringing them
 * back would look like the notes had been lost and found.
 */
function Rewriting({ children }: { children: React.ReactNode }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <p className="font-mono text-2xs text-ink-faint">
        &gt; rewriting — these are the previous notes until the new ones are written.
      </p>
      <div className="opacity-50">{children}</div>
    </div>
  );
}

/** Rough shape of what synthesis writes: widths per line, as fractions. */
const PENDING_SHAPE: Array<[string, number[]]> = [
  ["Summary", [1, 0.96, 0.9, 0.55]],
  ["Key points", [0.7, 0.82, 0.6]],
  ["Action items", [0.64, 0.5]],
];

/**
 * Where the generated half will be, while it is written for the first time.
 *
 * Rows of shade characters in the shape of the sections to come, breathing
 * rather than shimmering. It says what is coming and roughly how much, which
 * a blank space or "no summary yet" — the old state here, and wrong while
 * one was being written — does not.
 */
function NotesPending() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <p className="sr-only">The summary and action items are being written.</p>
      <div aria-hidden className="flex flex-col gap-10">
        {PENDING_SHAPE.map(([title, widths]) => (
          <div key={title} className="trace-section">
            <SectionHead title={title} />
            <div className="trace-breathe flex flex-col gap-1.5">
              {widths.map((w, i) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative shape
                  key={i}
                  className="block overflow-hidden whitespace-nowrap font-mono text-sm leading-tight text-ink-faint"
                  style={{ width: `${w * 100}%` }}
                >
                  {"░".repeat(160)}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NoteBody({ markdown, them = null }: { markdown: string; them?: string | null }) {
  const { body } = splitFrontmatter(markdown);
  const blocks = body.split("\n\n").filter((b) => b.trim().length > 0);

  return (
    <article data-selectable className="trace-prose flex flex-col gap-4">
      {blocks.map((block, i) => (
        // Blocks have no stable identity of their own; index is the honest key
        // for a static, non-reorderable rendering of a file's contents.
        // biome-ignore lint/suspicious/noArrayIndexKey: static document render
        <Block key={i} text={block.trim()} them={them} />
      ))}
    </article>
  );
}

function Block({ text, them }: { text: string; them: string | null }) {
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
      const name = speaker === "them" && them ? them : speaker;
      return (
        <p className="flex gap-3 font-mono text-xs">
          <span className="shrink-0 tabular-nums text-ink-faint">{time}</span>
          {/* Wider once a name can appear, so the text column stays aligned
              down the whole transcript rather than jumping line to line. */}
          <span
            className={`shrink-0 truncate uppercase tracking-system text-phosphor-muted ${
              them ? "w-20" : "w-12"
            }`}
            title={name}
          >
            {name}
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

/**
 * A note's tags, editable in place.
 *
 * Tags live in the note's own frontmatter, so they travel with the file — a
 * Markdown-on-disk product should not keep the grouping somewhere the file
 * cannot see. Clicking one searches for it, because a tag you cannot get back
 * out of is only a label.
 *
 * The rendered set comes from the backend's reply rather than from what was
 * typed: it normalises, de-duplicates and sorts, and the UI should show what
 * is on disk.
 */
function Tags({
  path,
  onSearchTag,
}: {
  path: string;
  onSearchTag?: ((tag: string) => void) | undefined;
}) {
  const [tags, setTags] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!hasBackend()) return;
    void ipc
      .noteTags(path)
      .then(setTags)
      .catch(() => setTags([]));
  }, [path]);

  function save(next: string[]) {
    void ipc
      .setNoteTags(path, next)
      .then(setTags)
      .catch(() => {});
  }

  if (!hasBackend()) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((tag) => (
        <span key={tag} className="flex items-center overflow-hidden rounded-sm bg-phosphor-dim">
          <button
            type="button"
            onClick={() => onSearchTag?.(tag)}
            disabled={!onSearchTag}
            title={onSearchTag ? `Find meetings tagged ${tag}` : undefined}
            className="px-2 py-1 font-mono text-2xs tracking-system text-phosphor trace-press hover:bg-phosphor hover:text-surface-0 disabled:cursor-default"
          >
            {tag}
          </button>
          <button
            type="button"
            aria-label={`Remove tag ${tag}`}
            onClick={() => save(tags.filter((t) => t !== tag))}
            className="px-1.5 py-1 font-mono text-2xs text-phosphor-muted trace-press hover:bg-error hover:text-surface-0"
          >
            ×
          </button>
        </span>
      ))}

      {adding ? (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft.trim()) save([...tags, draft]);
            setDraft("");
            setAdding(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (draft.trim()) save([...tags, draft]);
              setDraft("");
              setAdding(false);
            }
            if (e.key === "Escape") {
              setDraft("");
              setAdding(false);
            }
          }}
          placeholder="tag…"
          aria-label="New tag"
          name="tag"
          autoComplete="off"
          // biome-ignore lint/a11y/noAutofocus: opened by an explicit click
          autoFocus
          className="trace-field w-28 px-2 py-1 font-mono text-2xs"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-sm border border-dashed border-line-strong px-2 py-1 font-mono text-2xs tracking-system text-ink-faint trace-press hover:border-phosphor hover:text-phosphor"
        >
          + Tag
        </button>
      )}
    </div>
  );
}
