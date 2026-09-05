import { useEffect, useState } from "react";
import {
  hasBackend,
  ipc,
  type NotesGenerated,
  onNotesGenerated,
  onSynthesisFailed,
  onSynthesisProgress,
  onTranscriptUpdated,
} from "../../lib/ipc";

/**
 * What is still happening to a note after the meeting ended.
 *
 * A saved note is written immediately with the live transcript, then improved
 * twice in the background: re-transcribed at full quality, then summarised.
 * Without something reporting that, the note simply changes under the reader
 * with no explanation.
 */
export type RefinementStage =
  | { kind: "idle" }
  | { kind: "transcribed" }
  | { kind: "summarising"; window: number; total: number }
  | { kind: "generated"; result: NotesGenerated }
  | { kind: "failed"; message: string };

export function useNoteRefinement(path: string, onReload: (text: string) => void) {
  const [stage, setStage] = useState<RefinementStage>({ kind: "idle" });

  useEffect(() => {
    if (!hasBackend()) return;

    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const reload = () => {
      void ipc.readNote(path).then((text) => {
        if (!disposed) onReload(text);
      });
    };

    const track = <T>(
      subscribe: (h: (v: T) => void) => Promise<() => void>,
      handler: (v: T) => void,
    ) => {
      void subscribe((v) => {
        if (!disposed) handler(v);
      }).then((un) => {
        if (disposed) un();
        else unlisteners.push(un);
      });
    };

    // Events carry the path they refer to, so a note open in the background
    // is not updated by another meeting finishing.
    track(onTranscriptUpdated, (info) => {
      if (info.notePath !== path) return;
      setStage({ kind: "transcribed" });
      reload();
    });

    track(onSynthesisProgress, (p) => {
      setStage({ kind: "summarising", window: p.window, total: p.total });
    });

    track(onNotesGenerated, (result) => {
      if (result.notePath !== path) return;
      setStage({ kind: "generated", result });
      reload();
    });

    track(onSynthesisFailed, (info) => {
      setStage({ kind: "failed", message: info.message });
    });

    return () => {
      disposed = true;
      for (const un of unlisteners) un();
    };
  }, [path, onReload]);

  return stage;
}
