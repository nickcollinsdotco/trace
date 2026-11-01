import { useEffect, useState } from "react";
import { useConfirm } from "../../components/ui/Confirm";
import { Section } from "../../components/ui/terminal";
import { hasBackend, ipc, type NotesFolderStatus } from "../../lib/ipc";

/** Selection is queued; no live job ever has its output folder moved. */
export function NotesFolderField() {
  const [folder, setFolder] = useState<NotesFolderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();

  useEffect(() => {
    if (hasBackend()) {
      void ipc
        .notesFolderStatus()
        .then(setFolder)
        .catch((e) => setError(String(e)));
    }
  }, []);

  async function choose() {
    setBusy(true);
    setError(null);
    try {
      const destination = await ipc.chooseNotesFolder();
      if (typeof destination !== "string") return;
      if (
        !(await confirm({
          title: "Change notes folder on next launch?",
          body: [
            destination,
            "Fully quit TRACE, including its tray icon, then reopen it. Markdown notes will be copied before any meetings or note jobs start. The current folder stays in use until the copy succeeds.",
            "Original files stay in the old folder as a backup. Only Markdown files are copied: attachments and hidden folders stay where they are. Audio and journals stay in local application data.",
            "Choose an empty folder on a drive that supports hard links, such as NTFS. Keep both folders connected during the copy and close other editors. Large libraries may take a while to open.",
          ],
          confirm: "Use on next launch",
        }))
      )
        return;
      setFolder(await ipc.scheduleNotesFolder(destination));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      setFolder(await ipc.scheduleNotesFolder(null));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Notes folder">
      <p className="break-all font-mono text-xs text-ink">
        {folder?.current ?? "Loading notes folder…"}
      </p>
      <p className="text-2xs text-ink-faint">
        Markdown notes live here. Audio and journals stay in local application data.
      </p>
      {folder?.pending && (
        <div role="status" className="flex flex-col gap-1 text-sm text-ink-muted">
          <p>
            On next launch: <span className="break-all font-mono text-xs">{folder.pending}</span>
          </p>
          <p>
            Fully quit TRACE from its tray icon, then reopen it. The current folder stays in use
            until copying succeeds.
          </p>
          <p className="text-2xs">
            Originals stay as a backup. If copying fails, completed copies stay in the destination;
            restart to retry, or cancel and choose another empty folder.
          </p>
        </div>
      )}
      {(error ?? folder?.error) && (
        <p role="alert" className="text-sm text-error">
          {error ?? folder?.error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy || !folder}
          onClick={() => void choose()}
          className="trace-btn trace-btn-quiet trace-press"
        >
          Choose folder…
        </button>
        <button
          type="button"
          disabled={busy || !folder}
          onClick={() => void ipc.openFolder("notes").catch((e) => setError(String(e)))}
          className="trace-btn trace-btn-quiet trace-press"
        >
          Open current folder
        </button>
        {folder?.pending && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void cancel()}
            className="trace-btn trace-btn-quiet trace-press"
          >
            Cancel folder change
          </button>
        )}
      </div>
    </Section>
  );
}
