import { useCallback, useEffect, useState } from "react";
import { SectionHead, SystemLabel } from "../../components/ui/terminal";
import { groupByDate } from "../../lib/dates";
import { hasBackend, ipc, type NoteSummary, type RecoverableSession } from "../../lib/ipc";

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
            className="flex items-center gap-2 rounded-sm border border-line-strong bg-surface-2 px-3 py-1.5 font-mono text-2xs uppercase tracking-system text-ink transition-colors duration-120 hover:border-phosphor hover:text-phosphor"
          >
            <span aria-hidden>+</span>
            New meeting
          </button>
        </div>

        {/* Interrupted meetings come first: there is unsaved work here and it
            is the only thing on this screen that can still be lost. */}
        {recoverable.map((session) => (
          <RecoveryCard key={session.sessionDir} session={session} onDone={refresh} />
        ))}

        {loading ? (
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
                <button
                  key={note.path}
                  type="button"
                  onClick={() => onOpenNote(note.path)}
                  className="group flex items-baseline gap-3 rounded-sm px-2 py-2 text-left transition-colors duration-120 hover:bg-surface-1"
                >
                  <span className="truncate text-base text-ink group-hover:text-phosphor">
                    {note.title}
                  </span>
                  <span
                    aria-hidden
                    className="trace-rule opacity-0 transition-opacity group-hover:opacity-100"
                  />
                  <span className="shrink-0 font-mono text-2xs uppercase tracking-system text-ink-faint">
                    {note.type}
                  </span>
                </button>
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
        <p className="text-base text-ink">{session.title}</p>
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
          className="rounded-sm border border-phosphor px-3 py-1.5 font-mono text-2xs uppercase tracking-system text-phosphor transition-colors duration-120 hover:bg-phosphor hover:text-surface-0 disabled:opacity-50"
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
          className="font-mono text-2xs uppercase tracking-system text-ink-faint transition-colors duration-120 hover:text-error disabled:opacity-50"
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
