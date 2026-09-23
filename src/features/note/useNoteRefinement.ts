import { useEffect } from "react";
import { hasBackend, ipc, type Job, onNotesGenerated, onTranscriptUpdated } from "../../lib/ipc";
import { useActivity } from "../activity/useActivity";

/**
 * What is still happening to a note after the meeting ended.
 *
 * A saved note is written immediately with the live transcript, then improved
 * twice in the background: re-transcribed at full quality, then summarised.
 * Without something reporting that, the note simply changes under the reader
 * with no explanation.
 *
 * The job comes from the backend's list rather than from events this screen
 * happened to hear. That is what keeps it on screen after the note is closed
 * and reopened mid-run — it used to reset to nothing, and offer to regenerate
 * notes that were still being written.
 */
export function useNoteRefinement(path: string, onReload: (text: string) => void): Job | null {
  const jobs = useActivity();

  useEffect(() => {
    if (!hasBackend()) return;

    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const reload = () => {
      void ipc.readNote(path).then((text) => {
        if (!disposed) onReload(text);
      });
    };

    // Events carry the path they refer to, so a note open in the background
    // is not reloaded by another meeting finishing.
    const forThisNote = (info: { notePath: string }) => {
      if (!disposed && info.notePath === path) reload();
    };
    for (const subscribe of [onTranscriptUpdated, onNotesGenerated]) {
      void subscribe(forThisNote).then((un) => {
        if (disposed) un();
        else unlisteners.push(un);
      });
    }

    return () => {
      disposed = true;
      for (const un of unlisteners) un();
    };
  }, [path, onReload]);

  return jobs.find((j) => j.notePath === path) ?? null;
}
