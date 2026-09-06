import { useCallback, useEffect, useState } from "react";
import { SectionHead, SystemLabel } from "../../components/ui/terminal";
import { groupByDate } from "../../lib/dates";
import {
  hasBackend,
  ipc,
  type NoteSummary,
  type RecoverableSession,
  type SearchHit,
} from "../../lib/ipc";

export function LibraryScreen({
  onNewMeeting,
  onOpenNote,
}: {
  onNewMeeting: () => void;
  onOpenNote: (path: string) => void;
}) {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [recoverable, setRecoverable] = useState<RecoverableSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [root, setRoot] = useState<string>("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);

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

  const groups = groupByDate(notes, (n) => n.date);

  return (
    <div data-mode="reading" className="h-full overflow-y-auto">
      <div className="trace-measure flex flex-col gap-8 px-6 py-10">
        <div className="flex items-center justify-between">
          <SystemLabel tone="muted">Meetings</SystemLabel>
          <button
            type="button"
            onClick={onNewMeeting}
            className="flex items-center gap-2 rounded-sm border border-line-strong bg-surface-2 px-3 py-1.5 font-mono text-2xs uppercase tracking-system text-ink trace-press hover:border-phosphor hover:text-phosphor"
          >
            <span aria-hidden>+</span>
            New meeting
          </button>
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

        {/* Interrupted meetings come first: there is unsaved work here and it
            is the only thing on this screen that can still be lost. */}
        {recoverable.map((session) => (
          <RecoveryCard key={session.sessionDir} session={session} onDone={refresh} />
        ))}

        {hits !== null ? (
          <SearchResults hits={hits} query={query} onOpen={onOpenNote} />
        ) : loading ? (
          <p className="font-mono text-xs text-ink-faint">&gt; reading notes…</p>
        ) : !hasBackend() ? (
          <BrowserNotice />
        ) : groups.length === 0 ? (
          <EmptyState root={root} />
        ) : (
          groups.map(({ group, items }) => (
            <section key={group} className="trace-section gap-1">
              <SectionHead title={group} />
              {items.map((note) => (
                <NoteRow key={note.path} note={note} onOpen={onOpenNote} onChanged={refresh} />
              ))}
            </section>
          ))
        )}
      </div>
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
  onOpen,
  onChanged,
}: {
  note: NoteSummary;
  onOpen: (path: string) => void;
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
        `truncate` lives on the button, not on a span inside it. Overflow and
        text-overflow do not apply to a non-replaced inline element, so the
        span version silently did nothing and a long title overflowed its row.
      */}
      <button
        type="button"
        onClick={() => onOpen(note.path)}
        className="trace-title min-w-0 flex-1 truncate text-left text-base text-ink group-hover:text-phosphor"
      >
        {note.title}
      </button>

      <span
        aria-hidden
        className="trace-rule opacity-0 transition-opacity group-hover:opacity-100"
      />

      <span className="shrink-0 font-mono text-2xs uppercase tracking-system text-ink-faint">
        {note.type}
      </span>

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
            <span className="shrink-0 font-mono text-2xs uppercase tracking-system text-ink-faint">
              {hit.type}
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
