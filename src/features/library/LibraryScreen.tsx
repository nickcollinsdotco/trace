import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Popover, PopoverItem } from "../../components/ui/Popover";
import { TopBar, useScrolledPast } from "../../components/ui/TopBar";
import { Prompt, SystemLabel } from "../../components/ui/terminal";
import { isTypingTarget } from "../../design/theme";
import { groupByDate } from "../../lib/dates";
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
import { applyFilters, parseQuery, searchText, setToken } from "./query";
import { SearchBar, type View } from "./SearchBar";
import { SignalPanel } from "./SignalPanel";

/*
 * Still "gists" on disk: the list view is the old Summaries toggle, and a
 * preference someone already set should survive the rename.
 */
const VIEW_KEY = "trace.library.gists";

/*
 * A per-machine viewing preference, so browser storage rather than the
 * settings file. Wrapped because storage can be unavailable, and a missing
 * preference must never stop the library rendering.
 */
function loadView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "off" ? "compact" : "list";
  } catch {
    return "list";
  }
}

function saveView(view: View): void {
  try {
    localStorage.setItem(VIEW_KEY, view === "compact" ? "off" : "on");
  } catch {
    // Not worth surfacing: the switch still works for this session.
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
  const [view, setView] = useState(loadView);
  const llm = useLlmStatus();

  const scroller = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleGone = useScrolledPast(titleRef, scroller);
  const searchRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseQuery(query), [query]);
  // Only words go to the backend. Filters alone are answered from the
  // listing already on screen, with no search at all.
  const backendQuery = parsed.terms.length > 0 ? searchText(parsed) : "";

  function pickView(next: View) {
    setView(next);
    saveView(next);
  }

  // "/" jumps to the search line from anywhere on the page, as it does in
  // most things with one.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /*
   * Search runs on a debounce rather than per keystroke.
   *
   * It scans the Markdown — no index — which is ~25ms at a realistic library
   * and 106ms across 1,200 notes. Fast enough to feel immediate once, wasteful
   * to repeat on every character.
   */
  useEffect(() => {
    if (!hasBackend()) return;

    if (backendQuery === "") {
      setHits(null);
      return;
    }

    let cancelled = false;
    const id = window.setTimeout(() => {
      void ipc
        .searchNotes(backendQuery)
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
  }, [backendQuery]);

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

  const filtered = useMemo(() => applyFilters(notes, parsed), [notes, parsed]);

  /*
   * Search hits, narrowed to what the filters keep. Ranked by relevance,
   * unless a sort was asked for, in which case they follow it.
   */
  const shownHits = useMemo(() => {
    if (hits === null) return null;
    const order = new Map(filtered.map((n, i) => [n.path, i]));
    const kept = hits.filter((h) => order.has(h.path));
    return parsed.sort
      ? kept.sort((a, b) => (order.get(a.path) ?? 0) - (order.get(b.path) ?? 0))
      : kept;
  }, [hits, filtered, parsed.sort]);

  const byDate = parsed.sort === null || parsed.sort === "newest" || parsed.sort === "oldest";
  const groups = byDate
    ? groupByDate(
        filtered,
        (n) => n.date,
        undefined,
        parsed.sort === "oldest" ? "oldest" : "newest",
      )
    : null;

  const onTag = (tag: string) => setQuery((q) => setToken(q, "tag", tag));

  return (
    <div ref={scroller} data-mode="reading" className="h-full overflow-y-auto">
      <TopBar current="Meetings" showCurrent={titleGone}>
        <button
          type="button"
          onClick={onNewMeeting}
          className="flex shrink-0 items-center gap-2 rounded-pill border border-line-strong bg-surface-2 px-3 py-1.5 font-mono text-2xs uppercase tracking-system text-ink trace-press hover:border-phosphor hover:text-phosphor"
        >
          <span aria-hidden>+</span>
          New meeting
        </button>
      </TopBar>

      <div className="trace-measure flex flex-col gap-8 px-6 pt-6 pb-10">
        <h1 ref={titleRef} className="trace-title text-2xl text-ink">
          Meetings
        </h1>

        {hasBackend() && !loading && <SignalPanel notes={notes} />}

        {/* Interrupted meetings come first: there is unsaved work here and it
            is the only thing on this screen that can still be lost. */}
        {recoverable.map((session) => (
          <RecoveryCard key={session.sessionDir} session={session} onDone={refresh} />
        ))}

        <LlmNotice status={llm.status} onRecheck={llm.recheck} context="library" />

        {hasBackend() && notes.length > 0 && (
          <SearchBar
            query={query}
            parsed={parsed}
            onChange={setQuery}
            notes={notes}
            shown={shownHits ? shownHits.length : filtered.length}
            view={view}
            onView={pickView}
            inputRef={searchRef}
            searching={shownHits !== null}
          />
        )}

        {shownHits !== null ? (
          <SearchResults hits={shownHits} query={parsed.terms.join(" ")} onOpen={onOpenNote} />
        ) : loading ? (
          <p className="font-mono text-xs text-ink-faint">
            <Prompt />
            reading notes…
          </p>
        ) : !hasBackend() ? (
          <BrowserNotice />
        ) : notes.length === 0 ? (
          <EmptyState root={root} />
        ) : filtered.length === 0 ? (
          <NoMatch onClear={() => setQuery(parsed.terms.join(" "))} />
        ) : groups ? (
          <div className="flex flex-col gap-8">
            {groups.map(({ group, items }) => (
              <section key={group} aria-label={group} className="flex flex-col gap-1">
                {/* Quiet, like Granola's dates: a label, not a heading rule. */}
                <h2 className="px-3 pb-1">
                  <SystemLabel>{group}</SystemLabel>
                </h2>
                {items.map((note) => (
                  <NoteRow
                    key={note.path}
                    note={note}
                    view={view}
                    activeTags={parsed.tags}
                    onOpen={onOpenNote}
                    onTag={onTag}
                    onChanged={refresh}
                  />
                ))}
              </section>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {filtered.map((note) => (
              <NoteRow
                key={note.path}
                note={note}
                view={view}
                activeTags={parsed.tags}
                onOpen={onOpenNote}
                onTag={onTag}
                onChanged={refresh}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Filters that leave nothing, with the way out. */
function NoMatch({ onClear }: { onClear: () => void }) {
  return (
    <div className="trace-hatch flex flex-col items-center gap-3 rounded-sm py-12 text-center">
      <p className="font-mono text-xs text-ink-faint">
        <Prompt />
        no meetings match these filters.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="rounded-pill border border-line-strong px-3 py-1 font-mono text-2xs uppercase tracking-system text-ink trace-press hover:border-phosphor hover:text-phosphor"
      >
        Clear filters
      </button>
    </div>
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
      <p className="font-mono text-xs text-ink-faint">
        <Prompt />
        no traces yet.
      </p>
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
      <p className="font-mono text-xs text-warn">
        <Prompt />
        no backend.
      </p>
      <p className="text-sm text-ink-muted">
        This is the frontend running in a browser. Audio capture, transcription and saving all live
        in the desktop app.
      </p>
      <p className="font-mono text-2xs text-ink-faint">run `pnpm tauri dev`</p>
    </div>
  );
}

/**
 * One meeting in the list.
 *
 * Granola's shape: the title and its line of summary on the left, when it
 * happened on the right, and everything else out of the way. Rename and
 * delete moved into a menu — two buttons reserved in every row, invisible
 * until hover, took width from every title for actions used once a month.
 */
function NoteRow({
  note,
  view,
  activeTags,
  onOpen,
  onTag,
  onChanged,
}: {
  note: NoteSummary;
  view: View;
  activeTags: string[];
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

  const time = startTime(note.startedAt);
  const list = view === "list";

  return (
    <div
      data-note-row
      className={`group flex items-start gap-4 rounded-md px-3 trace-press hover:bg-surface-2 focus-within:bg-surface-2 ${
        list ? "py-3" : "py-2"
      } ${busy ? "opacity-50" : ""}`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/*
          The title span is `block`: overflow and text-overflow do not apply to
          a non-replaced inline element, so an inline span with `truncate`
          silently did nothing and a long title overflowed its row.
        */}
        <button
          type="button"
          onClick={() => onOpen(note.path)}
          className="flex min-w-0 flex-col gap-0.5 text-left"
        >
          <span className="trace-title block truncate text-base text-ink group-hover:text-phosphor">
            {note.title}
          </span>
          {list &&
            (note.gist ? (
              <span className="line-clamp-2 text-sm text-ink-muted">{note.gist}</span>
            ) : (
              // Said rather than left blank, so an old note reads as "not
              // summarised" instead of the view appearing to do nothing.
              <span className="font-mono text-2xs text-ink-faint">— no summary</span>
            ))}
        </button>

        {list && (note.tags.length > 0 || note.type !== "general") && (
          <span className="flex flex-wrap items-baseline gap-1.5 font-mono text-2xs tracking-system">
            {note.tags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onTag(t)}
                title={`Show only meetings tagged ${t}`}
                className={`rounded-pill px-2 py-0.5 trace-press hover:bg-phosphor hover:text-surface-0 ${
                  activeTags.includes(t)
                    ? "bg-phosphor text-surface-0"
                    : "bg-phosphor-dim text-phosphor"
                }`}
              >
                {t}
              </button>
            ))}
            {/* Type only when it says something: nothing sets it yet, so
                every meeting would otherwise read "general". */}
            {note.type !== "general" && (
              <span className="uppercase text-ink-faint">{note.type}</span>
            )}
          </span>
        )}
      </div>

      <span className="flex shrink-0 flex-col items-end gap-0.5 pt-0.5 font-mono text-2xs tabular-nums text-ink-faint">
        {time && <span className="text-ink-muted">{time}</span>}
        {note.durationMs !== null && <span>{formatMeetingLength(note.durationMs)}</span>}
      </span>

      {hasBackend() && (
        <span className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Popover
            label={`Actions for ${note.title}`}
            align="end"
            title="Rename or delete"
            trigger={
              <span className="flex size-7 items-center justify-center rounded-pill font-mono text-sm text-ink-faint hover:text-ink">
                <span className="sr-only">Meeting actions</span>
                <span aria-hidden>⋯</span>
              </span>
            }
          >
            {(close) => (
              <>
                <PopoverItem
                  disabled={busy}
                  onSelect={() => {
                    close();
                    void rename();
                  }}
                >
                  Rename
                </PopoverItem>
                <PopoverItem
                  disabled={busy}
                  onSelect={() => {
                    close();
                    void remove();
                  }}
                >
                  <span className="text-error">Delete</span>
                </PopoverItem>
              </>
            )}
          </Popover>
        </span>
      )}
    </div>
  );
}

/** "14:30", in the machine's own clock. */
function startTime(startedAt: string | null): string | null {
  if (!startedAt) return null;
  const d = new Date(startedAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
        <p className="font-mono text-xs text-ink-faint">
          <Prompt />
          nothing matches “{query}”.
        </p>
        <p className="text-sm text-ink-muted">Every word has to appear somewhere in the meeting.</p>
      </div>
    );
  }

  return (
    // No heading of its own: the count line above the list already says how
    // many there are, and saying it twice read as two different numbers.
    <section aria-label="Search results" className="flex flex-col gap-1">
      {hits.map((hit) => (
        <button
          key={hit.path}
          type="button"
          onClick={() => onOpen(hit.path)}
          className="group flex flex-col gap-1 rounded-sm px-2 py-2 text-left trace-press hover:bg-surface-2"
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
