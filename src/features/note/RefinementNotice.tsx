import type { RefinementStage } from "./useNoteRefinement";

/**
 * Explains what is still happening to a note after the meeting ended.
 *
 * A note is written immediately and then improved twice in the background.
 * Without this the text simply changes under the reader with no explanation,
 * which is unsettling in a tool whose job is keeping an accurate record.
 *
 * The dropped-item count is shown deliberately. When the model invents a
 * decision and validation discards it, saying so is more honest than quietly
 * presenting a shorter list — and it tells the user something true about how
 * much to trust what remains.
 */
export function RefinementNotice({ stage }: { stage: RefinementStage }) {
  if (stage.kind === "idle") return null;

  if (stage.kind === "transcribed") {
    return (
      <Line tone="phosphor">
        transcript refined — full-quality pass complete, now writing notes
      </Line>
    );
  }

  if (stage.kind === "summarising") {
    const progress = stage.total > 1 ? ` (part ${stage.window} of ${stage.total})` : "";
    return <Line tone="phosphor">writing notes{progress}…</Line>;
  }

  if (stage.kind === "failed") {
    // Not an error state for the note itself — the transcript and the user's
    // own notes are intact and saved. Only the summary is missing.
    return (
      <Line tone="warn">
        notes could not be generated — {stage.message}. The transcript is saved.
      </Line>
    );
  }

  const { dropped, fabricated } = stage.result;
  return (
    <Line tone="phosphor">
      notes generated
      {dropped > 0 && (
        <>
          {" — "}
          <span className="text-warn">
            {dropped} item{dropped === 1 ? "" : "s"} discarded
            {fabricated > 0 && " for citing something not in the transcript"}
          </span>
        </>
      )}
    </Line>
  );
}

function Line({ tone, children }: { tone: "phosphor" | "warn"; children: React.ReactNode }) {
  return (
    <p
      className={`font-mono text-2xs ${tone === "warn" ? "text-warn" : "text-phosphor"}`}
      role="status"
    >
      &gt; {children}
    </p>
  );
}
