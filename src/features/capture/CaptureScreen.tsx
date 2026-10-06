import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useConfirm } from "../../components/ui/Confirm";
import { Page } from "../../components/ui/Page";
import { ProcessingLine } from "../../components/ui/Processing";
import {
  type CaptureState,
  Elapsed,
  formatElapsed,
  Meter,
  Prompt,
  Section,
  StatusDot,
  SystemLabel,
} from "../../components/ui/terminal";
import { type DeviceInfo, hasBackend, ipc, type LiveSegment } from "../../lib/ipc";
import { MiniIcon } from "../mini/MiniIcon";
import { shortcutLabel, useMiniShortcut } from "../mini/shortcut";
import { ScopeStrip, ScopeView, useScopeMode } from "../scope/ScopePanels";
import { AudioRetentionField } from "../settings/AudioRetentionField";
import { MicCheck } from "./MicCheck";
import { useCapture } from "./useCapture";

/**
 * Capture mode — technical, dense, instrument-like.
 *
 * Layout priority comes from docs/04-UX.md: the user's own NOTES sit above and
 * get more room than the TRANSCRIPT. The transcript is supporting evidence,
 * not the main event.
 */
export function CaptureScreen({
  onFinish,
  stopRequest,
  initialScopeView = false,
}: {
  onFinish: (notePath?: string) => void;
  /** Open on the full-screen scope — the gallery's scenario for it. */
  initialScopeView?: boolean;
  /** Stop the meeting as soon as it is known to be running — the palette's Stop. */
  stopRequest?: number | undefined;
}) {
  const capture = useCapture();
  const confirm = useConfirm();
  const [scopeMode, setScopeMode] = useScopeMode();
  const shortcut = useMiniShortcut();
  const [scopeOpen, setScopeOpen] = useState(initialScopeView);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [micDevice, setMicDevice] = useState<string | null>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!hasBackend()) return;
    void Promise.all([ipc.listInputDevices(), ipc.getSettings().catch(() => null)]).then(
      ([list, settings]) => {
        setDevices(list);
        // The remembered microphone if it is plugged in, else the system's
        // default, so the common case needs no interaction.
        const remembered = list.find((d) => d.name === settings?.defaultMic)?.name;
        setMicDevice(remembered ?? list.find((d) => d.isDefault)?.name ?? list[0]?.name ?? null);
      },
    );
  }, []);

  function chooseMic(name: string) {
    setMicDevice(name);
    // Remembered, so the next meeting starts on the same one.
    void ipc.setDefaultMic(name).catch(() => {});
  }

  const recording = capture.status !== null;

  // "Just start typing" — focus the notes field the moment recording begins.
  // Keyed on whether it is recording, not on the status itself: the status is
  // a new object every second, and keyed on that this pulled focus back to the
  // notes once a second, out of anything else the user was typing into.
  useEffect(() => {
    if (recording) notesRef.current?.focus();
  }, [recording]);
  // The dot reports what the *recorder* is doing. Audio is being captured
  // whether or not a transcript is being produced alongside it.
  const state: CaptureState = capture.stopping ? "processing" : recording ? "capturing" : "idle";

  async function handleDiscard() {
    // Confirmed, because it cannot be undone and the audio goes with it.
    const elapsed = formatElapsed(capture.status?.elapsedMs ?? 0);
    const ok = await confirm({
      title: "Discard this meeting?",
      body: [
        `${elapsed} of audio and ${capture.segments.length} transcript segments will be deleted, and no note will be written.`,
        "This cannot be undone.",
      ],
      confirm: "Discard meeting",
      danger: true,
    });
    if (!ok) return;

    await ipc.abortCapture().catch(() => {});
    onFinish();
  }

  // Once per request: a re-render while stopping must not stop twice.
  const handled = useRef<number | undefined>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: handleStop is recreated every render
  useEffect(() => {
    if (stopRequest === undefined || handled.current === stopRequest) return;
    if (!capture.status || capture.stopping) return;
    handled.current = stopRequest;
    void handleStop();
  }, [stopRequest, capture.status, capture.stopping]);

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
        onMicChange={chooseMic}
        starting={capture.starting}
        error={capture.error}
        onStart={() => capture.start(title, micDevice)}
        onCancel={() => onFinish()}
      />
    );
  }

  const appendNote = (line: string) => {
    const next = notes && !notes.endsWith("\n") ? `${notes}\n${line}` : `${notes}${line}`;
    setNotes(next);
    capture.setNotes(next);
  };

  const levels = capture.status?.levels ?? [];
  const mic = levels.find((l) => l.source === "microphone")?.level ?? 0;
  const system = levels.find((l) => l.source === "system")?.level ?? 0;

  return (
    <div data-mode="capture" className="relative flex h-full flex-col">
      <div className="flex shrink-0 items-baseline gap-4 border-b border-line px-5 py-3">
        <h1 className="font-mono text-sm trace-caps-heading tracking-wide text-ink">
          {capture.status?.title}
        </h1>
        <StatusDot state={state} />
        <span aria-hidden className="trace-rule" />
        <Elapsed ms={capture.status?.elapsedMs ?? 0} />
        {/* Where someone about to switch to the call looks for it. */}
        <button
          type="button"
          onClick={() => void ipc.openMini().catch(() => {})}
          aria-label="Open the mini window"
          title={`Mini window — floats over the call${shortcut ? ` (${shortcutLabel(shortcut)})` : ""}`}
          className="flex size-7 shrink-0 items-center justify-center self-center rounded-sm text-ink-faint trace-press hover:bg-surface-2 hover:text-ink"
        >
          <MiniIcon />
        </button>
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

      {/* The strip, the notes and the transcript in the page column, as
          every other page has them: across the whole window the scope's
          modes sat a long way from anything, and lines ran too long. */}
      <div className="trace-column shrink-0 pt-4">
        <ScopeStrip mode={scopeMode} onMode={setScopeMode} onExpand={() => setScopeOpen(true)} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="trace-column flex flex-col gap-6 py-5">
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
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-line px-5 py-3">
        {/* The session's code used to sit here, which meant nothing to
            anyone. What people want to know at the foot of a meeting is
            that what they typed is safe: it is journalled as they type, and
            survives a crash. */}
        <SystemLabel>Notes save as you type</SystemLabel>
        <div className="flex items-center gap-3">
          {/*
            Quieter than Stop, and to its left. Discarding is the rarer
            intention and the destructive one, so it should not sit where a
            hand goes by default.
          */}
          <button
            type="button"
            onClick={handleDiscard}
            disabled={capture.stopping}
            className="trace-btn trace-btn-quiet trace-press hover:text-error disabled:opacity-50"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={handleStop}
            disabled={capture.stopping}
            className="trace-btn trace-btn-secondary bg-surface-2 trace-press disabled:opacity-50"
          >
            {capture.stopping ? "Saving…" : "Stop meeting"}
          </button>
        </div>
      </div>

      {scopeOpen && (
        <ScopeView
          mode={scopeMode}
          onMode={setScopeMode}
          onClose={() => {
            setScopeOpen(false);
            // Back to writing where the user left off.
            requestAnimationFrame(() => notesRef.current?.focus());
          }}
          title={capture.status?.title ?? ""}
          elapsedMs={capture.status?.elapsedMs ?? 0}
          notes={notes}
          onAppendNote={appendNote}
        />
      )}
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
    <Page kind="focus">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <SystemLabel tone="muted">New meeting</SystemLabel>

        {/*
          A prompt, not a form field. While it is empty a block cursor blinks
          where the title will go — the one thing this screen asks for — and
          the system caret stays out of the way until typing starts. The
          Modern family drops the field's box entirely (family.css), so the
          title floats. The placeholder is kept for screen readers; it is only
          hidden, because the hint draws it instead.
        */}
        <div className="trace-title-prompt flex items-center gap-3">
          <span aria-hidden className="trace-title-mark font-mono text-2xl text-phosphor">
            &gt;
          </span>
          <div className="relative min-w-0 flex-1">
            <input
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !starting) onStart();
              }}
              placeholder="Untitled meeting"
              aria-label="Meeting title"
              name="meeting-title"
              // Off deliberately: a meeting title is not a credential, and a
              // password manager offering to fill it is pure noise.
              autoComplete="off"
              data-selectable
              // Autofocused because the title is the only thing worth typing
              // here, and everything else has a sensible default.
              // biome-ignore lint/a11y/noAutofocus: single-purpose entry screen
              autoFocus
              className={`trace-field trace-title-input text-2xl ${title ? "" : "caret-transparent"}`}
            />
            {title === "" && (
              <span
                aria-hidden
                className="trace-title-hint pointer-events-none absolute inset-0 flex items-center text-2xl text-ink-faint"
              >
                <span className="trace-cursor" />
                <span className="ml-2 truncate">Untitled meeting</span>
              </span>
            )}
          </div>
        </div>

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

        <MicCheck device={micDevice} />

        <div className="flex flex-col gap-2">
          <SystemLabel>Audio after notes are written</SystemLabel>
          <AudioRetentionField />
        </div>

        {error && <Banner tone="error">{error}</Banner>}

        {/* The one thing this screen is for, so it is the biggest thing on
            it, and says it answers to Enter from the title. */}
        <div className="flex flex-col items-stretch gap-3">
          <button
            type="button"
            onClick={onStart}
            disabled={starting}
            className="flex w-full items-center justify-between gap-4 rounded-md border border-phosphor bg-phosphor-dim px-5 py-4 font-mono text-sm trace-control tracking-system text-phosphor trace-press hover:bg-phosphor hover:text-surface-0 disabled:opacity-50"
          >
            <span className="flex items-center gap-3">
              <span aria-hidden className="inline-block size-2 rounded-full bg-current" />
              {starting ? "Starting…" : "Start meeting"}
            </span>
            <kbd aria-hidden className="font-mono text-2xs normal-case tracking-normal opacity-70">
              ↵ Enter
            </kbd>
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="self-center trace-btn trace-btn-quiet trace-press"
          >
            Cancel
          </button>
        </div>
      </div>
    </Page>
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
  const box = useRef<HTMLDivElement>(null);
  // Whether the reader is at the newest line. Scrolled up to reread
  // something, they stay put; at the bottom, they follow.
  const pinned = useRef(true);
  const [behind, setBehind] = useState(false);

  /*
   * Following the transcript as it grows, inside its own box. It once
   * scrolled the whole page to its end instead — which, had it run more
   * than once, would have pulled the notes out from under someone typing.
   * The page around it stays where the user put it.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows each new line and the working line
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (pinned.current) el.scrollTop = el.scrollHeight;
    else setBehind(true);
  }, [segments.length, inFlight > 0 || pendingSpeechMs > 0]);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (pinned.current) setBehind(false);
  };

  const toLatest = () => {
    const el = box.current;
    if (!el) return;
    pinned.current = true;
    setBehind(false);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  if (segments.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="font-mono text-xs text-ink-faint">
          <Prompt />
          awaiting signal
          <span className="trace-cursor" />
        </p>
        <ProcessingLine pendingSpeechMs={pendingSpeechMs} inFlight={inFlight} />
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={box}
        onScroll={onScroll}
        data-selectable
        className="flex max-h-[min(24rem,42vh)] flex-col gap-2 overflow-y-auto pr-2"
      >
        {segments.map((segment) => (
          <div key={segment.id} className="trace-segment-in flex gap-3 font-mono text-xs">
            <span className="shrink-0 tabular-nums text-ink-faint">
              {formatElapsed(segment.startMs)}
            </span>
            <span className="w-12 shrink-0 trace-caps-label tracking-system text-phosphor-muted">
              {segment.source === "microphone" ? "you" : "them"}
            </span>
            <span className="text-ink">{segment.text}</span>
          </div>
        ))}
        <ProcessingLine pendingSpeechMs={pendingSpeechMs} inFlight={inFlight} />
      </div>
      {behind && (
        <button
          type="button"
          onClick={toLatest}
          className="trace-btn trace-btn-secondary absolute right-3 bottom-2 rounded-pill bg-surface-2 trace-press"
        >
          <span aria-hidden>↓</span> Latest
        </button>
      )}
    </div>
  );
}

function Banner({ tone, children }: { tone: "warn" | "error"; children: React.ReactNode }) {
  // The column, like the page under it, so a long message wraps at a
  // readable width instead of running the width of the window.
  const styles =
    tone === "error"
      ? "border-error/40 bg-error-dim text-error"
      : "border-warn/40 bg-warn-dim text-warn";
  return (
    <div className={`shrink-0 border-b py-2 text-xs ${styles}`} role="status">
      <p className="trace-column">{children}</p>
    </div>
  );
}

/** Convert a 0..1 RMS level to dBFS for the meter readout. */
function toDb(level: number): number | undefined {
  if (level <= 0) return undefined;
  return 20 * Math.log10(level);
}
