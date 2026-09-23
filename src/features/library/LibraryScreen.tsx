import { useCallback, useEffect, useMemo, useState } from "react";
import { SectionHead, SystemLabel } from "../../components/ui/terminal";
import { groupByDate, type SortOrder } from "../../lib/dates";
import { formatMeetingLength } from "../../lib/format";
import {
  hasBackend,
  ipc,
  type NoteSummary,
  type RecoverableSession,
  type SearchHit,
} from "../../lib/ipc";
import { LlmNotice } from "../llm/LlmNotice";
import { useLlmStatus } from "../llm/useLlmStatus";

const GISTS_KEY = "trace.library.gists";
const ORDER_KEY = "trace.library.order";

/*
 * A per-machine viewing preference, so browser storage rather than the
 * settings file. Wrapped because storage can be unavailable, and a missing
 * preference must never stop the library rendering.
 */
function loadShowGists(): boolean {
  try {
    return localStorage.getItem(GISTS_KEY) !== "off";
  } catch {
    return true;
  }
}

function saveShowGists(show: boolean): void {
  try {
    localStorage.setItem(GISTS_KEY, show ? "on" : "off");
  } catch {
    // Not worth surfacing: the toggle still works for this session.
  }
}

function loadOrder(): SortOrder {
  try {
    return localStorage.getItem(ORDER_KEY) === "oldest" ? "oldest" : "newest";
  } catch {
    return "newest";
  }
}

function saveOrder(order: SortOrder): void {
  try {
    localStorage.setItem(ORDER_KEY, order);
  } catch {
    // As above.
  }
}

export function LibraryScreen({
  onNewMeeting,
  onOpenNote,
  initialSearch = "",
}: {
  onNewMeeting: () => void;
  onOpenNote: (path: string) => void;
  /** Pre-filled query, so clicking a tag on a note lands here searching it. */
  initialSearch?: string;
}) {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [recoverable, setRecoverable] = useState<RecoverableSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [root, setRoot] = useState<string>("");
  const [query, setQuery] = useState(initialSearch);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [showGists, setShowGists] = useState(loadShowGists);
  const [order, setOrder] = useState(loadOrder);
  // One tag at a time. Several would need an and/or rule to explain, and the
  // search box already does "tag:a tag:b" for anyone who wants both.
  const [tag, setTag] = useState<string | null>(null);
  const llm = useLlmStatus();

  function pickOrder(next: SortOrder) {
    setOrder(next);
    saveOrder(next);
  }

  function toggleGists() {
    setShowGists((on) => {
      saveShowGists(!on);
      return !on;
    });
  }

  /*
   * Search runs on a debounce rather than per keystroke.
   *
   * It scans the Markdown — no index — which is ~25ms at a realistic library
   * and 106ms across 1,200 notes. Fast enough to feel immediate once, wasteful
   * to repeat on every character.
   */
  useEffect(() => {
    if (!hasBackend()) return;

    const term = query.trim();
    if (term === "") {
      setHits(null);
      return;
    }

    let cancelled = false;
    const id = window.setTimeout(() => {
      void ipc
        .searchNotes(term)
        .then((r) => {
          if (!cancelled) setHits(r);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [query]);

  const refresh = useCallback(async () => {
    if (!hasBackend()) {
      setLoading(false);
      return;
    }
    const [list, sessions, notesRoot] = await Promise.all([
      ipc.listNotes().catch(() => []),
      ipc.recoverableSessions().catch(() => []),
      ipc.notesRoot().catch(() => ""),
    ]);
    setNotes(list);
    setRecoverable(sessions);
    setRoot(notesRoot);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const allTags = useMemo(() => [...new Set(notes.flatMap((n) => n.tags))].sort(), [notes]);
  // A filter on a tag that no longer exists — deleted from its last note —
  // would hide everything with no visible reason.
  const activeTag = tag !== null && allTags.includes(tag) ? tag : null;
  const shown = activeTag === null ? notes : notes.filter((n) => n.tags.includes(activeTag));
  const groups = groupByDate(shown, (n) => n.date, undefined, order);

  return (
    <div data-mode="reading" className="h-full overflow-y-auto">
      <div className="trace-measure flex flex-col gap-8 px-6 py-10">
        <div className="flex items-center justify-between">
          <SystemLabel tone="muted">Meetings</SystemLabel>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleGists}
              aria-pressed={showGists}
              title="Show a one-line summary under each meeting"
              className={`rounded-sm border px-2.5 py-1 font-mono text-2xs uppercase tracking-system trace-press ${
                showGists
                  ? "border-phosphor bg-phosphor-dim text-phosphor"
                  : "border-transparent text-ink-faint hover:text-ink"
              }`}
            >
              Summaries
            </button>
            <button
              type="button"
              onClick={onNewMeeting}
              className="flex items-center gap-2 rounded-sm border border-line-strong bg-surface-2 px-3 py-1.5 font-mono text-2xs uppercase tracking-system text-ink trace-press hover:border-phosphor hover:text-phosphor"
            >
              <span aria-hidden>+</span>
              New meeting
            </button>
          </div>
        </div>

        {hasBackend() && (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search meetings and transcripts…"
            name="search"
            autoComplete="off"
            aria-label="Search meetings and transcripts"
            className="trace-field text-sm"
          />
        )}

        {hits === null && notes.length > 0 && (
          <ListControls
            order={order}
            onOrder={pickOrder}
            tags={allTags}
            tag={activeTag}
            onTag={setTag}
          />
        )}

        {/* Interrupted meetings come first: there is unsaved work here and it
            is the only thing on this screen that can still be lost. */}
        {recoverable.map((session) => (
          <RecoveryCard key={session.sessionDir} session={session} onDone={refresh} />
        ))}

        <LlmNotice status={llm.status} onRecheck={llm.recheck} context="library" />

        {hits !== null ? (
          <SearchResults hits={hits} query={query} onOpen={onOpenNote} />
        ) : loading ? (
          <p className="font-mono text-xs text-ink-faint">&gt; reading notes…</p>
        ) : !hasBackend() ? (
          <BrowserNotice />
        ) : notes.length === 0 ? (
          <EmptyState root={root} />
        ) : (
          groups.map(({ group, items }) => (
            <section key={group} className="trace-section gap-1">
              <SectionHead title={group} />
              {items.map((note) => (
                <NoteRow
                  key={note.path}
                  note={note}
                  showGist={showGists}
                  activeTag={activeTag}
                  onOpen={onOpenNote}
                  onTag={setTag}
                  onChanged={refresh}
                />
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Order and tag filter for the list.
 *
 * Deliberately two controls and no more for now. Filtering by length or type
 * is worth having once type is something a meeting is actually given — every
 * meeting is "general" today, so a type filter would be a control that
 * always shows everything.
 */
function ListControls({
  order,
  onOrder,
  tags,
  tag,
  onTag,
}: {
  order: SortOrder;
  onOrder: (o: SortOrder) => void;
  tags: string[];
  tag: string | null;
  onTag: (t: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <fieldset className="flex items-center gap-1">
        <legend className="sr-only">Order</legend>
        <Toggle active={order === "newest"} onClick={() => onOrder("newest")}>
          Newest
        </Toggle>
        <Toggle active={order === "oldest"} onClick={() => onOrder("oldest")}>
          Oldest
        </Toggle>
      </fieldset>

      {tags.length > 0 && (
        <fieldset className="flex min-w-0 flex-wrap items-center gap-1">
          <legend className="sr-only">Filter by tag</legend>
          <span aria-hidden className="mr-1 font-mono text-2xs text-ink-faint">
            #
          </span>
          <Toggle active={tag === null} onClick={() => onTag(null)}>
            All
          </Toggle>
          {tags.map((t) => (
            <Toggle key={t} active={tag === t} onClick={() => onTag(tag === t ? null : t)} plain>
              {t}
            </Toggle>
          ))}
        </fieldset>
      )}
    </div>
  );
}

function Toggle({
  active,
  onClick,
  plain,
  children,
}: {
  active: boolean;
  onClick: () => void;
  /** Tags keep their own case; everything else here is a system label. */
  plain?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-sm border px-2 py-0.5 font-mono text-2xs tracking-system trace-press ${
        plain ? "" : "uppercase"
      } ${
        active
          ? "border-phosphor bg-phosphor-dim text-phosphor"
          : "border-transparent text-ink-faint hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * An interrupted meeting, offered for recovery.
 *
 * Deliberately not auto-recovered. Writing a note without asking would put
 * files in the user's folder that they never agreed to, and a discarded
 * session cannot be undone — both are the user's call.
 */
function RecoveryCard({ session, onDone }: { session: RecoverableSession; onDone: () => void }) {
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-warn/40 bg-warn-dim trace-panel p-4">
      <div className="flex items-baseline gap-2">
        <SystemLabel tone="muted">Interrupted</SystemLabel>
        <span aria-hidden className="trace-rule" />
      </div>

      <div>
        <p className="trace-title text-base text-ink">{session.title}</p>
        <p className="font-mono text-2xs text-ink-muted">
          {session.date} · {session.segmentCount} segments · {session.noteLength} chars of notes
          {session.corruptLines > 0 && ` · ${session.corruptLines} damaged line(s) skipped`}
        </p>
      </div>

      <p className="text-xs text-ink-muted">
        This meeting was still recording when TRACE last closed. Its transcript and notes were
        recovered from the journal.
      </p>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await ipc.recoverSession(session.sessionDir).catch(() => {});
            setBusy(false);
            onDone();
          }}
          className="rounded-sm border border-phosphor px-3 py-1.5 font-mono text-2xs uppercase tracking-system text-phosphor trace-press hover:bg-phosphor hover:text-surface-0 disabled:opacity-50"
        >
          Save as note
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await ipc.discardSession(session.sessionDir).catch(() => {});
            setBusy(false);
            onDone();
          }}
          className="font-mono text-2xs uppercase tracking-system text-ink-faint trace-press hover:text-error disabled:opacity-50"
        >
          Discard
        </button>
      </div>
    </div>
  );
}

function EmptyState({ root }: { root: string }) {
  return (
    // Hatched rather than blank: an empty panel and a panel that failed to
    // load look identical, and this product has to tell them apart often.
    <div className="trace-hatch flex flex-col gap-3 rounded-sm py-16 text-center">
      <p className="font-mono text-xs text-ink-faint">&gt; no traces yet.</p>
      <p className="text-sm text-ink-muted">Start a meeting and TRACE will keep the rest.</p>
      {root && (
        <p className="mt-4 font-mono text-2xs text-ink-faint" data-selectable>
          notes are saved to {root}
        </p>
      )}
    </div>
  );
}

/** Shown when the frontend is served in a browser rather than the desktop app. */
function BrowserNotice() {
  return (
    <div className="flex flex-col gap-3 py-16 text-center">
      <p className="font-mono text-xs text-warn">&gt; no backend.</p>
      <p className="text-sm text-ink-muted">
        This is the frontend running in a browser. Audio capture, transcription and saving all live
        in the desktop app.
      </p>
      <p className="font-mono text-2xs text-ink-faint">run `pnpm tauri dev`</p>
    </div>
  );
}

/**
 * One meeting in the list, with the two things you cannot otherwise do to it.
 *
 * Rename and delete appear on hover rather than permanently. A library is
 * read most of the time and edited rarely, and a row carrying two controls at
 * rest reads as a form; the actions are still reachable by keyboard, because
 * hiding them from a mouse is not the same as removing them.
 */
function NoteRow({
  note,
  showGist,
  activeTag,
  onOpen,
  onTag,
  onChanged,
}: {
  note: NoteSummary;
  showGist: boolean;
  activeTag: string | null;
  onOpen: (path: string) => void;
  onTag: (tag: string) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function rename() {
    const title = window.prompt("Rename meeting", note.title);
    if (title === null || title.trim() === "" || title === note.title) return;

    setBusy(true);
    await ipc.renameNote(note.path, title.trim()).catch(() => {});
    setBusy(false);
    onChanged();
  }

  async function remove() {
    const ok = window.confirm(
      [
        `Delete “${note.title}”?`,
        "",
        "The note and its transcript are both deleted.",
        "",
        "This cannot be undone.",
      ].join("\n"),
    );
    if (!ok) return;

    setBusy(true);
    await ipc.deleteNote(note.path).catch(() => {});
    setBusy(false);
    onChanged();
  }

  return (
    <div
      className={`group flex items-baseline gap-3 rounded-sm px-2 py-2 trace-press hover:bg-surface-1 ${
        busy ? "opacity-50" : ""
      }`}
    >
      {/*
        The title span is `block`: overflow and text-overflow do not apply to a
        non-replaced inline element, so an inline span with `truncate` silently
        did nothing and a long title overflowed its row.

        The gist sits inside the same button so the whole block opens the note,
        and the row's baseline stays the title's, keeping the type label level
        with it rather than with the gist.
      */}
      <div
        className={`flex min-w-0 flex-col gap-1.5 ${
          // With a gist, the title block takes the row and the hover leader
          // shrinks to its minimum. Sharing the width equally, as a lone title
          // can, squeezed the gist into a narrow column of wrapped lines.
          showGist ? "flex-[1_1_100%]" : "flex-1"
        }`}
      >
        <button
          type="button"
          onClick={() => onOpen(note.path)}
          className="flex min-w-0 flex-col gap-0.5 text-left"
        >
          <span className="trace-title block truncate text-base text-ink group-hover:text-phosphor">
            {note.title}
          </span>
          {showGist &&
            (note.gist ? (
              <span className="line-clamp-2 text-sm text-ink-muted">{note.gist}</span>
            ) : (
              // Said rather than left blank, so an old note reads as "not
              // summarised" instead of the toggle appearing to do nothing.
              <span className="font-mono text-2xs text-ink-faint">— no summary</span>
            ))}
        </button>

        {/* Under the title rather than beside it: beside, two tags were
            enough to cut a title down to a few characters. */}
        {note.tags.length > 0 && <RowTags tags={note.tags} active={activeTag} onTag={onTag} />}
      </div>

      <span
        aria-hidden
        className="trace-rule opacity-0 transition-opacity group-hover:opacity-100"
      />

      <RowFacts note={note} />

      {hasBackend() && (
        <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <RowAction label="Rename" onClick={rename} disabled={busy}>
            Rename
          </RowAction>
          <RowAction label="Delete" onClick={remove} disabled={busy} destructive>
            Delete
          </RowAction>
        </span>
      )}
    </div>
  );
}

/**
 * Length and — when it says something — type, on the right of a row.
 *
 * Type used to sit here alone, and since nothing yet sets it every meeting
 * read "general". That looked like the meeting's tags, and like tagging being
 * broken. It shows only when it is not the default now; the tags the user
 * actually gave sit under the title.
 */
function RowFacts({ note }: { note: NoteSummary }) {
  return (
    <span className="flex shrink-0 items-baseline gap-3 font-mono text-2xs tracking-system text-ink-faint">
      {note.type !== "general" && <span className="uppercase">{note.type}</span>}
      {note.durationMs !== null && (
        <span className="tabular-nums">{formatMeetingLength(note.durationMs)}</span>
      )}
    </span>
  );
}

/** A row's tags. Pressing one filters the library to it. */
function RowTags({
  tags,
  active,
  onTag,
}: {
  tags: string[];
  active: string | null;
  onTag: (tag: string) => void;
}) {
  return (
    <span className="flex flex-wrap gap-1.5 font-mono text-2xs tracking-system">
      {tags.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onTag(t)}
          title={`Show only meetings tagged ${t}`}
          className={`rounded-sm px-1.5 py-0.5 trace-press hover:bg-phosphor hover:text-surface-0 ${
            t === active ? "bg-phosphor text-surface-0" : "bg-phosphor-dim text-phosphor"
          }`}
        >
          {t}
        </button>
      ))}
    </span>
  );
}

function RowAction({
  label,
  onClick,
  disabled,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-sm px-2 py-1 font-mono text-2xs uppercase tracking-system text-ink-faint trace-press disabled:opacity-40 ${
        destructive ? "hover:text-error" : "hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Search results, replacing the date-grouped list while a query is active.
 *
 * Each hit shows the line that matched. Search over a transcript is only
 * useful if it says *why* something matched — the meeting title alone leaves
 * the user opening notes to find out.
 */
function SearchResults({
  hits,
  query,
  onOpen,
}: {
  hits: SearchHit[];
  query: string;
  onOpen: (path: string) => void;
}) {
  if (hits.length === 0) {
    return (
      <div className="trace-hatch flex flex-col gap-2 rounded-sm py-12 text-center">
        <p className="font-mono text-xs text-ink-faint">&gt; nothing matches “{query}”.</p>
        <p className="text-sm text-ink-muted">Every word has to appear somewhere in the meeting.</p>
      </div>
    );
  }

  return (
    <section className="trace-section gap-1">
      <SectionHead title={`${hits.length} ${hits.length === 1 ? "result" : "results"}`} />
      {hits.map((hit) => (
        <button
          key={hit.path}
          type="button"
          onClick={() => onOpen(hit.path)}
          className="group flex flex-col gap-1 rounded-sm px-2 py-2 text-left trace-press hover:bg-surface-1"
        >
          <span className="flex items-baseline gap-3">
            <span className="trace-title min-w-0 flex-1 truncate text-base text-ink group-hover:text-phosphor">
              {hit.title}
            </span>
            <span className="flex shrink-0 items-baseline gap-2 font-mono text-2xs tracking-system text-ink-faint">
              {hit.tags.map((t) => (
                <span key={t} className="rounded-sm bg-phosphor-dim px-1.5 py-0.5 text-phosphor">
                  {t}
                </span>
              ))}
              {hit.type !== "general" && <span className="uppercase">{hit.type}</span>}
            </span>
          </span>
          {hit.snippet && (
            <span className="line-clamp-2 font-mono text-2xs leading-relaxed text-ink-muted">
              {hit.snippet}
            </span>
          )}
        </button>
      ))}
    </section>
  );
}
