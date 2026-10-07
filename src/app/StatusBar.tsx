import { useCallback, useEffect, useState } from "react";
import { Popover, PopoverDivider, PopoverHeading, PopoverItem } from "../components/ui/Popover";
import { Prompt } from "../components/ui/terminal";
import { useUnseenVersion } from "../features/about/changesSeen";
import { ActivityEntry } from "../features/activity/ActivityEntry";
import { isRunning } from "../features/activity/jobs";
import { Narrator } from "../features/fun/Narrator";
import { useLlmStatus } from "../features/llm/useLlmStatus";
import { formatBytes } from "../lib/format";
import {
  type AppInfo,
  hasBackend,
  ipc,
  type Job,
  type LoadedModel,
  type SpeechModel,
  type SummaryModels,
} from "../lib/ipc";
import { shortModel } from "../lib/names";
import type { Page } from "./Sidebar";

/**
 * The bottom bar: which models are in play, what they are doing, and which
 * build this is.
 *
 * Both models are named because they fail independently — transcription can
 * be perfect while summaries are offline, and a note is not where anyone
 * should first learn that. They share one chip, by short name, and one
 * picker: two chips took the room the narrator needed, and one switch for
 * "the models" is what people reach for. "Manage models" leads to the page
 * that downloads them.
 *
 * Three parts: the models and background work on the left, the narrator in
 * the middle where it is seen, the build on the right.
 */
export function StatusBar({
  page = null,
  jobs,
  onManageModels,
  onOpenNote,
  onWhatsNew,
}: {
  /** Where the user is, for the narrator. */
  page?: Page | null;
  jobs: Job[];
  onManageModels: () => void;
  onOpenNote?: ((path: string) => void) | undefined;
  /** After an update: where its changes are read. */
  onWhatsNew?: (() => void) | undefined;
}) {
  const [speech, setSpeech] = useState<SpeechModel[] | null>(null);
  const updated = useUnseenVersion();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const llm = useLlmStatus();

  const loadSpeech = useCallback(() => {
    void ipc
      .speechModels()
      .then(setSpeech)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!hasBackend()) return;
    loadSpeech();
    void ipc
      .appInfo()
      .then(setInfo)
      .catch(() => {});
  }, [loadSpeech]);

  if (!hasBackend()) return null;

  const active = speech?.find((m) => m.active);

  return (
    // The sides as wide as they need and no wider; the narrator has the rest.
    <footer className="trace-statusbar grid shrink-0 grid-cols-[minmax(0,max-content)_minmax(0,1fr)_minmax(0,max-content)] items-center gap-5 border-t border-line px-4 py-1.5 font-mono text-2xs text-ink-muted">
      <span className="flex min-w-0 items-center gap-5">
        {speech && (
          <ModelsPicker
            speech={speech}
            status={llm.status}
            onOpen={loadSpeech}
            onSpeechChanged={loadSpeech}
            onSummaryChanged={llm.recheck}
            onManage={onManageModels}
          />
        )}
        <ActivityEntry jobs={jobs} onOpenNote={onOpenNote} />
      </span>

      {/* The narrator, centred in all the room between, where it is seen
          rather than tucked against the models. Anything the bar genuinely
          needs to say — a job running, no speech model — comes first, and
          the narrator steps aside for it. Capped at a comfortable line; it
          was 48ch, and cut most of what it said short. */}
      <span className="flex min-w-0 justify-center">
        <Narrator
          page={page}
          busy={jobs.some(isRunning) || Boolean(speech && !active?.installed)}
        />
      </span>

      <span className="flex items-center justify-end gap-2 text-ink-faint">
        {/* Beside the version it is about, until its changes have been seen
            on About. Quiet: it is news, not a warning. */}
        {updated && onWhatsNew && (
          <button
            type="button"
            onClick={onWhatsNew}
            className="rounded-xs px-1 text-phosphor trace-press hover:underline"
          >
            updated · what's new
          </button>
        )}
        {info?.devBuild && <span className="text-warn">dev</span>}
        {info && <span>v{info.version}</span>}
      </span>
    </footer>
  );
}

/**
 * Both models on one chip — "Parakeet v3 · qwen3:14b" — and both pickers in
 * its panel. The dot is green only when both can work; a model that cannot
 * is named in the warning colour, so which one is plain at a glance.
 */
function ModelsPicker({
  speech,
  status,
  onOpen,
  onSpeechChanged,
  onSummaryChanged,
  onManage,
}: {
  speech: SpeechModel[];
  status: ReturnType<typeof useLlmStatus>["status"];
  onOpen: () => void;
  onSpeechChanged: () => void;
  onSummaryChanged: () => void;
  onManage: () => void;
}) {
  const [summary, setSummary] = useState<SummaryModels | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = speech.find((m) => m.active);
  const speechOk = Boolean(active?.installed);
  const speechLabel = active?.installed ? shortModel(active.name) : "No speech model";
  const summaryOk = status?.state === "ready";
  const summaryLabel = !status
    ? null
    : status.state === "ready"
      ? status.model
      : status.state === "no_model"
        ? "No summary model"
        : status.state === "not_installed"
          ? "No Ollama"
          : "Ollama closed";
  const installed = speech.filter((m) => m.installed);

  const choose = (change: Promise<unknown>, after: () => void, close: () => void) => {
    void change
      .then(() => {
        after();
        close();
      })
      .catch((e) => setError(String(e)));
  };

  return (
    <Popover
      label="Models"
      title={[
        `Transcribes: ${active?.installed ? active.name : "nothing"}`,
        summaryLabel && `Summarises: ${summaryLabel}`,
      ]
        .filter(Boolean)
        .join("\n")}
      placement="above"
      onOpen={() => {
        setError(null);
        onOpen();
        void ipc
          .summaryModels()
          .then(setSummary)
          .catch(() => {});
      }}
      trigger={
        <>
          <span
            aria-hidden
            className={`size-1.5 shrink-0 rounded-full ${
              speechOk && (summaryOk || !status) ? "bg-phosphor" : "bg-warn"
            }`}
          />
          <Part ok={speechOk}>{speechLabel}</Part>
          {summaryLabel && (
            <>
              <span aria-hidden className="text-ink-faint">
                ·
              </span>
              <Part ok={summaryOk}>{summaryLabel}</Part>
            </>
          )}
          <span aria-hidden className="text-ink-faint">
            ▴
          </span>
        </>
      }
    >
      {(close) => (
        <>
          <PopoverHeading>Transcription</PopoverHeading>
          {installed.length === 0 && (
            <p className="px-3 py-2 font-mono text-2xs text-ink-faint">
              <Prompt />
              none downloaded.
            </p>
          )}
          {installed.map((m) => (
            <PopoverItem
              key={m.id}
              current={m.active}
              detail={m.languages}
              onSelect={() =>
                m.active ? close() : choose(ipc.setSpeechModel(m.id), onSpeechChanged, close)
              }
            >
              {m.name}
            </PopoverItem>
          ))}
          <p className="px-3 py-1 text-2xs text-ink-faint">
            A meeting already recording keeps the model it started with.
          </p>

          {status && (
            <>
              <PopoverDivider />
              <PopoverHeading>Summaries</PopoverHeading>
              {status.state === "not_installed" ? (
                <div className="flex flex-col items-start gap-2 px-3 py-2">
                  <p className="text-2xs text-ink-muted">
                    Summaries are written by Ollama, a free app that runs AI models on this
                    computer. It isn’t installed.
                  </p>
                  <button
                    type="button"
                    onClick={() => void ipc.openLink("ollama").catch((e) => setError(String(e)))}
                    className="trace-btn trace-btn-primary trace-press"
                  >
                    Get Ollama <span aria-hidden>↗</span>
                  </button>
                </div>
              ) : status.state === "not_running" ? (
                <div className="flex flex-col items-start gap-2 px-3 py-2">
                  <p className="text-2xs text-ink-muted">
                    Ollama isn’t running, so no summary can be written.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      void ipc
                        .startOllama()
                        .then(() => window.setTimeout(onSummaryChanged, 4_000))
                        .catch((e) => setError(String(e)));
                    }}
                    className="trace-btn trace-btn-primary trace-press"
                  >
                    Open Ollama
                  </button>
                </div>
              ) : summary === null ? (
                <p className="px-3 py-2 font-mono text-2xs text-ink-faint">
                  <Prompt />
                  asking Ollama…
                </p>
              ) : summary.installed.length === 0 ? (
                <p className="px-3 py-2 font-mono text-2xs text-ink-faint">
                  <Prompt />
                  none installed.
                </p>
              ) : (
                summary.installed.map((m) => (
                  <PopoverItem
                    key={m.name}
                    current={m.active}
                    detail={m.parameters ?? undefined}
                    onSelect={() =>
                      m.active
                        ? close()
                        : choose(ipc.setSummaryModel(m.name), onSummaryChanged, close)
                    }
                  >
                    {m.name}
                  </PopoverItem>
                ))
              )}
              {summary && summary.loaded.length > 0 && (
                <>
                  <PopoverDivider />
                  {summary.loaded.map((m) => (
                    <InMemory key={m.name} model={m} />
                  ))}
                </>
              )}
            </>
          )}

          {error && (
            <p className="px-3 py-2 font-mono text-2xs text-error">
              <Prompt />
              {error}
            </p>
          )}
          <PopoverDivider />
          <PopoverItem
            onSelect={() => {
              close();
              onManage();
            }}
          >
            Manage models…
          </PopoverItem>
        </>
      )}
    </Popover>
  );
}

/**
 * A model Ollama is holding in memory, and until when.
 *
 * Several gigabytes a user on a video call will notice and not be able to
 * explain. TRACE holds the model only through a meeting and its notes, and
 * releases it straight after, so this is normally seen only then — or for a
 * model something other than TRACE loaded. The time is Ollama's own; while
 * TRACE holds a model it keeps pushing it back.
 */
function InMemory({ model }: { model: LoadedModel }) {
  const until = model.expiresAt ? new Date(model.expiresAt) : null;
  const time =
    until && !Number.isNaN(until.getTime())
      ? until.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : null;

  return (
    <p className="px-3 py-1.5 font-mono text-2xs text-ink-muted">
      <span className="text-ink">{model.name}</span> in memory · {formatBytes(model.sizeBytes)}
      {time && <span className="text-ink-faint"> · until {time}</span>}
    </p>
  );
}

/** One model's name on the chip, in the warning colour when it cannot work. */
function Part({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <span className={`truncate ${ok ? "" : "text-warn"}`}>{children}</span>;
}
