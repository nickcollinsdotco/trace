import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CaptureStatus,
  hasBackend,
  ipc,
  type LiveSegment,
  onCaptureError,
  onSegment,
} from "../../lib/ipc";

/** How often the meters and timer are refreshed. */
const STATUS_POLL_MS = 200;

/**
 * Notes are journalled on every call, so the debounce lives here rather than
 * in Rust. Long enough that ordinary typing does not hit the disk on every
 * keystroke, short enough that a crash loses at most a few words.
 */
const NOTES_DEBOUNCE_MS = 800;

export interface CaptureState {
  status: CaptureStatus | null;
  segments: LiveSegment[];
  error: string | null;
  starting: boolean;
  stopping: boolean;
}

/**
 * Drives one recording session.
 *
 * Segments arrive as events rather than by polling, so the transcript appears
 * as it is produced. Everything else — levels, elapsed time — is polled,
 * because it changes continuously and the last value is the only one that
 * matters.
 */
export function useCapture() {
  const [state, setState] = useState<CaptureState>({
    status: null,
    segments: [],
    error: null,
    starting: false,
    stopping: false,
  });

  // Held in a ref as well as state: the notes flush on stop must read the
  // latest text without waiting for a re-render.
  const pendingNotes = useRef<string | null>(null);
  const notesTimer = useRef<number | null>(null);

  /* --- live segments ------------------------------------------------ */

  useEffect(() => {
    if (!hasBackend()) return;

    let disposed = false;
    const unlisteners: Array<() => void> = [];

    void onSegment((segment) => {
      if (disposed) return;
      setState((s) => ({ ...s, segments: [...s.segments, segment] }));
    }).then((un) => {
      if (disposed) un();
      else unlisteners.push(un);
    });

    void onCaptureError(({ source, message }) => {
      if (disposed) return;
      setState((s) => ({ ...s, error: `${source}: ${message}` }));
    }).then((un) => {
      if (disposed) un();
      else unlisteners.push(un);
    });

    return () => {
      disposed = true;
      for (const un of unlisteners) un();
    };
  }, []);

  /* --- status polling ----------------------------------------------- */

  useEffect(() => {
    if (!hasBackend()) return;
    if (!state.status) return;

    const id = window.setInterval(() => {
      void ipc
        .captureStatus()
        .then((status) => {
          // A null status means the session ended underneath us.
          setState((s) => (status ? { ...s, status } : s));
        })
        .catch(() => {
          /* transient; the next tick will retry */
        });
    }, STATUS_POLL_MS);

    return () => window.clearInterval(id);
  }, [state.status]);

  /* --- actions ------------------------------------------------------ */

  const start = useCallback(async (title: string, micDevice: string | null) => {
    setState((s) => ({ ...s, starting: true, error: null, segments: [] }));
    try {
      const status = await ipc.startCapture(title, micDevice);
      setState((s) => ({ ...s, status, starting: false }));
    } catch (e) {
      setState((s) => ({ ...s, starting: false, error: String(e) }));
    }
  }, []);

  const flushNotes = useCallback(async () => {
    if (notesTimer.current !== null) {
      window.clearTimeout(notesTimer.current);
      notesTimer.current = null;
    }
    const text = pendingNotes.current;
    pendingNotes.current = null;
    if (text !== null) {
      await ipc.updateNotes(text).catch(() => {
        /* reported by the next command that fails */
      });
    }
  }, []);

  const setNotes = useCallback((text: string) => {
    pendingNotes.current = text;
    if (notesTimer.current !== null) window.clearTimeout(notesTimer.current);
    notesTimer.current = window.setTimeout(() => {
      const pending = pendingNotes.current;
      pendingNotes.current = null;
      notesTimer.current = null;
      if (pending !== null) void ipc.updateNotes(pending).catch(() => {});
    }, NOTES_DEBOUNCE_MS);
  }, []);

  const stop = useCallback(async () => {
    setState((s) => ({ ...s, stopping: true }));
    try {
      // Flush first: a debounced edit made just before pressing stop must not
      // be the one thing missing from the saved note.
      await flushNotes();
      const finished = await ipc.stopCapture();
      setState({
        status: null,
        segments: [],
        error: null,
        starting: false,
        stopping: false,
      });
      return finished;
    } catch (e) {
      setState((s) => ({ ...s, stopping: false, error: String(e) }));
      return null;
    }
  }, [flushNotes]);

  return { ...state, start, stop, setNotes };
}
