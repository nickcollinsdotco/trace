import { useEffect, useRef, useState } from "react";
import { Wave } from "../../components/ui/Wave";
import { ipc } from "../../lib/ipc";

/** Bars in the rolling trace, about three seconds at the poll rate. */
const BARS = 40;
const POLL_MS = 80;
/** Below this the device is delivering silence, not a quiet room. */
const SILENT = 0.002;

/**
 * Hear the microphone before the meeting starts.
 *
 * Only on request, never on arrival: opening the device lights Windows' mic
 * indicator, and a screen that did that just for being looked at would be
 * listening without being asked. The backend stops the preview itself if
 * this stops polling, so leaving the screen cannot leave the mic open.
 *
 * It also answers the question that costs a whole meeting if left unasked.
 * A virtual device can open, report a format and deliver exact digital
 * silence (see `audio::mic`), and a flat line here is how that shows up.
 */
export function MicCheck({ device }: { device: string | null }) {
  const [on, setOn] = useState(false);
  const [levels, setLevels] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const loudest = useRef(0);
  const started = useRef(0);

  // A different device is a different check: stop, and let it be restarted.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resets on device change only
  useEffect(() => {
    setOn(false);
  }, [device]);

  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    let timer = 0;
    loudest.current = 0;
    started.current = Date.now();
    setLevels([]);
    setError(null);

    void ipc
      .startMicPreview(device)
      .then(() => {
        const poll = async () => {
          const level = await ipc.micPreviewLevel().catch(() => null);
          if (cancelled) return;
          if (level === null) {
            setOn(false);
            return;
          }
          loudest.current = Math.max(loudest.current, level);
          // Square-rooted so ordinary speech fills the bars; raw RMS barely
          // leaves the floor.
          setLevels((l) => [...l.slice(-(BARS - 1)), Math.sqrt(Math.min(1, level * 4))]);
          timer = window.setTimeout(poll, POLL_MS);
        };
        void poll();
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
        setOn(false);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      void ipc.stopMicPreview().catch(() => {});
    };
  }, [on, device]);

  const silent = on && Date.now() - started.current > 2_000 && loudest.current < SILENT;
  const padded = [...Array(Math.max(0, BARS - levels.length)).fill(0), ...levels];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-pressed={on}
          onClick={() => setOn((v) => !v)}
          className={`shrink-0 rounded-pill border px-3 py-1 font-mono text-2xs uppercase tracking-system trace-press ${
            on
              ? "border-phosphor bg-phosphor-dim text-phosphor"
              : "border-line-strong text-ink-muted hover:border-phosphor hover:text-phosphor"
          }`}
        >
          {on ? "Stop test" : "Test mic"}
        </button>
        <div className="min-w-0 flex-1">
          {on ? (
            <Wave levels={padded} height="h-8" label="Microphone level, live" />
          ) : (
            <span className="font-mono text-2xs text-ink-faint">
              Say something to see it arrive. Nothing is recorded.
            </span>
          )}
        </div>
      </div>
      {silent && (
        <span className="text-2xs text-warn">
          Hearing nothing at all. If you are talking, this device is delivering silence — pick
          another microphone.
        </span>
      )}
      {error && <span className="text-2xs text-error">{error}</span>}
    </div>
  );
}
