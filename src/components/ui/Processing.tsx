import { useEffect, useState } from "react";

/**
 * A working indicator for the gap between speech and transcript.
 *
 * Parakeet cannot show anything until a chunk closes, so there is an
 * unavoidable pause between someone speaking and their words appearing. Left
 * unexplained that reads as "it stopped working"; labelled, it reads as
 * "it is working". The lag is the same either way.
 *
 * Everything here reflects real backend state — `pendingSpeechMs` is speech
 * genuinely held in the chunker, `inFlight` is chunks genuinely in inference.
 * A spinner that ran on a timer would be a lie, and this product's whole
 * premise is not showing people things that are not true.
 *
 * Deliberately plain for now; the terminal/ASCII treatment comes with the
 * visual pass.
 */

/**
 * Braille cells stepped through as a spinner.
 *
 * Monospace and the same width in every frame, so the line does not jitter.
 */
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_MS = 90;

export function ProcessingLine({
  pendingSpeechMs,
  inFlight,
}: {
  pendingSpeechMs: number;
  inFlight: number;
}) {
  const active = inFlight > 0 || pendingSpeechMs > 0;
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), FRAME_MS);
    return () => window.clearInterval(id);
  }, [active]);

  if (!active) return null;

  // Two genuinely different states, so they get different words. "Listening"
  // means audio is still accumulating; "transcribing" means the model is
  // running. Conflating them would make the indicator decorative.
  const transcribing = inFlight > 0;
  const label = transcribing ? "transcribing" : "listening";
  const seconds = (pendingSpeechMs / 1000).toFixed(1);

  return (
    <div
      className="trace-segment-in flex items-baseline gap-3 font-mono text-xs text-ink-faint"
      // Polite, not assertive: this updates constantly and must not interrupt
      // a screen reader mid-sentence.
      aria-live="polite"
    >
      <span aria-hidden className="shrink-0 tabular-nums text-phosphor">
        {FRAMES[frame]}
      </span>
      <span className="w-12 shrink-0 uppercase tracking-system text-phosphor-muted">···</span>
      <span>
        {label}
        <span aria-hidden className="trace-leader-inline" />
        {pendingSpeechMs > 0 && <span className="tabular-nums"> {seconds}s buffered</span>}
      </span>
    </div>
  );
}
