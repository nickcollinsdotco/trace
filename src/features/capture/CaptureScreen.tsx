import { useEffect, useRef, useState } from "react";
import { ProcessingLine } from "../../components/ui/Processing";
import {
  type CaptureState,
  Elapsed,
  formatElapsed,
  Meter,
  Section,
  StatusDot,
  SystemLabel,
} from "../../components/ui/terminal";
import { type DeviceInfo, hasBackend, ipc, type LiveSegment } from "../../lib/ipc";
import { useCapture } from "./useCapture";

/**
 * Capture mode — technical, dense, instrument-like.
 *
 * Layout priority comes from docs/04-UX.md: the user's own NOTES sit above and
 * get more room than the TRANSCRIPT. The transcript is supporting evidence,
 * not the main event.
 */
export function CaptureScreen({ onFinish }: { onFinish: (notePath?: string) => void }) {
  const capture = useCapture();
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [micDevice, setMicDevice] = useState<string | null>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!hasBackend()) return;
    void ipc.listInputDevices().then((list) => {
      setDevices(list);
      // Pre-select the default so the common case needs no interaction.
      setMicDevice(list.find((d) => d.isDefault)?.name ?? list[0]?.name ?? null);
    });
  }, []);

  // "Just start typing" — focus the notes field the moment recording begins.
  useEffect(() => {
    if (capture.status) notesRef.current?.focus();
  }, [capture.status]);

  const recording = capture.status !== null;
  // The dot reports what the *recorder* is doing. Audio is being captured
  // whether or not a transcript is being produced alongside it.
  const state: CaptureState = capture.stopping ? "processing" : recording ? "capturing" : "idle";

  async function handleStop() {
    const finished = await capture.stop();
    onFinish(finished?.notePath);
  }

  if (!recording) {
    return (
      <SetupPanel
        title={title}
        onTitleChange={setTitle}
        devices={devices}
        micDevice={micDevice}
        onMicChange={setMicDevice}
        starting={capture.starting}
        error={capture.error}
        onStart={() => capture.start(title, micDevice)}
        onCancel={() => onFinish()}
      />
    );
  }

  const levels = capture.status?.levels ?? [];
  const mic = levels.find((l) => l.source === "microphone")?.level ?? 0;
  const system = levels.find((l) => l.source === "system")?.level ?? 0;

  return (
    <div data-mode="capture" className="flex h-full flex-col">
      <div className="flex shrink-0 items-baseline gap-4 border-b border-line px-5 py-3">
        <h1 className="font-mono text-sm uppercase tracking-wide text-ink">
          {capture.status?.title}
        </h1>
        <StatusDot state={state} />
        <span aria-hidden className="trace-rule" />
        <Elapsed ms={capture.status?.elapsedMs ?? 0} />
      </div>

      {capture.status?.transcribing === false && (
        <Banner tone="warn">
          No speech model installed — audio is being recorded, but there will be no transcript.
        </Banner>
      )}
      {capture.status?.droppedAudio && (
        <Banner tone="warn">
          Transcription fell behind; the live transcript has gaps. The recording is complete and the
          saved note will be too.
        </Banner>
      )}
      {capture.error && <Banner tone="error">{capture.error}</Banner>}

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
        {/* Notes get the most room. This ordering is the product's opinion. */}
        <Section title="Notes">
          <textarea
            ref={notesRef}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              capture.setNotes(e.target.value);
            }}
            placeholder="type only what matters…"
            spellCheck={false}
            data-selectable
            className="trace-field min-h-40 resize-none text-base leading-relaxed"
          />
        </Section>

        <Section
          title="Transcript"
          actions={
            capture.segments.length > 0 ? (
              <SystemLabel>{capture.segments.length} segments</SystemLabel>
            ) : undefined
          }
        >
          <TranscriptView
            segments={capture.segments}
            pendingSpeechMs={capture.status?.pendingSpeechMs ?? 0}
            inFlight={capture.status?.inFlight ?? 0}
          />
        </Section>

        <Section title="Signal">
          <div className="flex flex-col gap-1.5">
            <Meter label="Mic" level={mic} db={toDb(mic)} />
            <Meter label="System" level={system} db={toDb(system)} />
          </div>
        </Section>
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-line px-5 py-3">
        <SystemLabel>{capture.status?.sessionId.slice(-4).toUpperCase() ?? "----"}</SystemLabel>
        <button
          type="button"
          onClick={handleStop}
          disabled={capture.stopping}
          className="rounded-sm border border-line-strong bg-surface-2 px-4 py-1.5 font-mono text-2xs uppercase tracking-system text-ink transition-colors duration-120 hover:border-error hover:text-error disabled:opacity-50"
        >
          {capture.stopping ? "Saving…" : "Stop meeting"}
        </button>
      </div>
    </div>
  );
}

function SetupPanel({
  title,
  onTitleChange,
  devices,
  micDevice,
  onMicChange,
  starting,
  error,
  onStart,
  onCancel,
}: {
  title: string;
  onTitleChange: (v: string) => void;
  devices: DeviceInfo[];
  micDevice: string | null;
  onMicChange: (v: string) => void;
  starting: boolean;
  error: string | null;
  onStart: () => void;
  onCancel: () => void;
}) {
  return (
    <div data-mode="reading" className="flex h-full items-center justify-center px-6">
      <div className="flex w-full max-w-md flex-col gap-6">
        <SystemLabel tone="muted">New meeting</SystemLabel>

        <input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !starting) onStart();
          }}
          placeholder="Untitled meeting"
          data-selectable
          // Autofocused because the title is the only thing worth typing here,
          // and everything else has a sensible default.
          // biome-ignore lint/a11y/noAutofocus: single-purpose entry screen
          autoFocus
          className="trace-field text-2xl"
        />

        <label className="flex flex-col gap-2">
          <SystemLabel>Microphone</SystemLabel>
          <select
            value={micDevice ?? ""}
            onChange={(e) => onMicChange(e.target.value)}
            className="trace-field text-sm"
          >
            {devices.length === 0 && <option value="">No input devices found</option>}
            {devices.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name}
                {d.isDefault ? " (default)" : ""}
              </option>
            ))}
          </select>
          {/* Virtual devices are the single most common cause of a silent
              recording, so the warning belongs here, not in a log. */}
          {micDevice?.toLowerCase().includes("broadcast") && (
            <span className="text-2xs text-warn">
              Virtual devices can record silence when their host app is idle. Prefer a physical
              microphone.
            </span>
          )}
        </label>

        {error && <Banner tone="error">{error}</Banner>}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onStart}
            disabled={starting}
            className="rounded-sm border border-phosphor bg-phosphor-dim px-4 py-2 font-mono text-2xs uppercase tracking-system text-phosphor transition-colors duration-120 hover:bg-phosphor hover:text-surface-0 disabled:opacity-50"
          >
            {starting ? "Starting…" : "Start meeting"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="font-mono text-2xs uppercase tracking-system text-ink-faint transition-colors duration-120 hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function TranscriptView({
  segments,
  pendingSpeechMs,
  inFlight,
}: {
  segments: LiveSegment[];
  pendingSpeechMs: number;
  inFlight: number;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  // Follow the transcript as it grows. Meetings run long and manually
  // scrolling to keep up would be its own small misery.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, []);

  if (segments.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="font-mono text-xs text-ink-faint">
          &gt; awaiting signal
          <span className="trace-cursor" />
        </p>
        <ProcessingLine pendingSpeechMs={pendingSpeechMs} inFlight={inFlight} />
      </div>
    );
  }

  return (
    <div data-selectable className="flex flex-col gap-2">
      {segments.map((segment) => (
        <div key={segment.id} className="trace-segment-in flex gap-3 font-mono text-xs">
          <span className="shrink-0 tabular-nums text-ink-faint">
            {formatElapsed(segment.startMs)}
          </span>
          <span className="w-12 shrink-0 uppercase tracking-system text-phosphor-muted">
            {segment.source === "microphone" ? "you" : "them"}
          </span>
          <span className="text-ink">{segment.text}</span>
        </div>
      ))}
      <ProcessingLine pendingSpeechMs={pendingSpeechMs} inFlight={inFlight} />
      <div ref={endRef} />
    </div>
  );
}

function Banner({ tone, children }: { tone: "warn" | "error"; children: React.ReactNode }) {
  const styles =
    tone === "error"
      ? "border-error/40 bg-error-dim text-error"
      : "border-warn/40 bg-warn-dim text-warn";
  return (
    <div className={`shrink-0 border-b px-5 py-2 text-2xs ${styles}`} role="status">
      {children}
    </div>
  );
}

/** Convert a 0..1 RMS level to dBFS for the meter readout. */
function toDb(level: number): number | undefined {
  if (level <= 0) return undefined;
  return 20 * Math.log10(level);
}
