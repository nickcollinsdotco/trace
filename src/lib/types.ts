/**
 * TRACE — domain model.
 *
 * Mirrors docs/06-DATA-MODEL.md, with the changes the architecture plan
 * called for. Marked ✦ below.
 *
 * NOTE: once the Rust side lands, `tauri-specta` will generate
 * `src/lib/bindings.ts` from the Rust structs and this file will re-export
 * from there instead of declaring shapes twice. Until then these are the
 * single source of truth and the Rust types must match them.
 */

/** Which physical stream a segment came from.
 *
 * ✦ This is load-bearing, not incidental metadata. Capturing microphone and
 * system loopback as two independent streams gives correct you/them speaker
 * attribution with no diarisation model at all — the audio topology solves
 * the hard part. See the architecture plan, "the dual-stream insight".
 */
export type AudioSource = "microphone" | "system";

export type MeetingType = "general" | "discovery" | "client" | "design-review" | "sales";

export type MeetingStatus = "draft" | "active" | "processing" | "complete" | "error";

export interface Participant {
  name: string;
  /** Optional; resolved from voice embeddings in a later phase. */
  speakerId?: string;
}

export interface TranscriptSegment {
  /** Stable, referenceable id — synthesis cites these. Format: `seg_0412`. */
  id: string;
  startMs: number;
  endMs?: number;
  /** Known from `source` for two-party calls; refined by diarisation later. */
  speaker?: string;
  text: string;
  source: AudioSource;
  /**
   * Live segments come from the fast streaming pass and may be revised by
   * the accurate re-pass when the meeting stops. The UI should render
   * provisional segments slightly de-emphasised.
   */
  provisional?: boolean;
}

/**
 * ✦ Evidence is what stops the model inventing things.
 *
 * Every generated claim cites the transcript segments it came from. Anything
 * whose citations don't resolve to real segments is dropped at validation
 * time rather than shown to the user. This turns "AI must not invent
 * decisions" (docs/00-README.md) from a prompt request into a mechanical
 * guarantee. Answers open question AI-4 in docs/07-OPEN-QUESTIONS.md.
 */
export interface Evidence {
  /** TranscriptSegment ids. Must be non-empty and must all resolve. */
  segmentIds: string[];
}

export interface Claim {
  text: string;
  evidence: Evidence;
  /** 0..1. The UI must not present low-confidence guesses as established fact. */
  confidence: number;
}

export interface ActionItem extends Claim {
  id: string;
  owner?: string;
  dueDate?: string;
  completed: boolean;
}

export interface Quote {
  text: string;
  speaker?: string;
  segmentId: string;
}

export interface GeneratedMeeting {
  summary: string;
  keyPoints: Claim[];
  decisions: Claim[];
  actionItems: ActionItem[];
  openQuestions: Claim[];
  quotes?: Quote[];
  /** Provenance, so a note can say honestly how it was produced. */
  model: string;
  generatedAt: string;
}

export interface Meeting {
  id: string;
  title: string;
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  startedAt?: string;
  endedAt?: string;
  type: MeetingType;
  participants: Participant[];
  tags: string[];
  project?: string;
  /** The user's own sparse notes. Never overwritten by generation. */
  notes: string;
  transcript: TranscriptSegment[];
  generated?: GeneratedMeeting;
  status: MeetingStatus;
}

/** Lightweight row for the library list — avoids loading every transcript. */
export interface MeetingSummary {
  id: string;
  title: string;
  date: string;
  type: MeetingType;
  status: MeetingStatus;
  durationMs?: number;
  participantCount: number;
}

/* ------------------------------------------------------------------ *
 * Live capture state, pushed from Rust over Tauri events.
 * ------------------------------------------------------------------ */

export interface StreamLevel {
  source: AudioSource;
  /** Normalised 0..1, for the meters. */
  level: number;
  db: number;
}

export interface CaptureStatus {
  state: "idle" | "capturing" | "transcribing" | "processing" | "error";
  elapsedMs: number;
  levels: StreamLevel[];
  segmentCount: number;
  /** Present only when `state === "error"`. */
  error?: string;
}
