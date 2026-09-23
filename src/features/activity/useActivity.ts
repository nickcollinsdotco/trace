import { useEffect, useState } from "react";
import { hasBackend, ipc, type Job, onActivity } from "../../lib/ipc";

/**
 * The backend's list of background jobs, kept current.
 *
 * Subscribes before asking, and ignores the answer if an event got there
 * first: the reply to the initial read can be older than an update that
 * arrived while it was in flight, and showing it would briefly undo a step.
 */
export function useActivity(): Job[] {
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    if (!hasBackend()) return;

    let disposed = false;
    let heard = false;
    let unlisten: (() => void) | null = null;

    void onActivity((next) => {
      heard = true;
      if (!disposed) setJobs(next);
    }).then((un) => {
      if (disposed) un();
      else unlisten = un;
    });

    void ipc
      .activity()
      .then((initial) => {
        if (!disposed && !heard) setJobs(initial);
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return jobs;
}

/**
 * The time, ticking once a second while `running`.
 *
 * Elapsed times are computed from the backend's timestamps rather than
 * counted up here, so a screen opened halfway through shows the true figure.
 */
export function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [running]);

  return now;
}
