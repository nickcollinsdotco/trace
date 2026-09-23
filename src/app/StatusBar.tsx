import { useCallback, useEffect, useState } from "react";
import { Popover, PopoverDivider, PopoverHeading, PopoverItem } from "../components/ui/Popover";
import { useLlmStatus } from "../features/llm/useLlmStatus";
import { type AppInfo, hasBackend, ipc, type SpeechModel, type SummaryModels } from "../lib/ipc";

/**
 * The bottom bar: which models are in play, and which build this is.
 *
 * Both models are shown because they fail independently — transcription can
 * be perfect while summaries are offline, and a note is not where anyone
 * should first learn that. Each opens a picker, so switching is one click
 * from anywhere, and "Manage models" leads to the page that downloads them.
 */
export function StatusBar({ onManageModels }: { onManageModels: () => void }) {
  const [speech, setSpeech] = useState<SpeechModel[] | null>(null);
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
    <footer className="flex shrink-0 items-center gap-5 border-t border-line px-4 py-1.5 font-mono text-2xs text-ink-muted">
      {speech && (
        <SpeechPicker
          models={speech}
          label={active?.installed ? active.name : "No speech model"}
          ok={Boolean(active?.installed)}
          onOpen={loadSpeech}
          onChanged={loadSpeech}
          onManage={onManageModels}
        />
      )}
      {llm.status && (
        <SummaryPicker status={llm.status} onChanged={llm.recheck} onManage={onManageModels} />
      )}

      <span className="ml-auto flex items-center gap-2 text-ink-faint">
        {info?.devBuild && <span className="text-warn">dev</span>}
        {info && <span>v{info.version}</span>}
      </span>
    </footer>
  );
}

function SpeechPicker({
  models,
  label,
  ok,
  onOpen,
  onChanged,
  onManage,
}: {
  models: SpeechModel[];
  label: string;
  ok: boolean;
  onOpen: () => void;
  onChanged: () => void;
  onManage: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const installed = models.filter((m) => m.installed);

  return (
    <Popover
      label="Transcription model"
      title="Transcribes the meeting on this machine"
      placement="above"
      onOpen={() => {
        setError(null);
        onOpen();
      }}
      trigger={<Entry ok={ok}>{label}</Entry>}
    >
      {(close) => (
        <>
          <PopoverHeading>Transcription</PopoverHeading>
          {installed.length === 0 && (
            <p className="px-3 py-2 font-mono text-2xs text-ink-faint">&gt; none downloaded.</p>
          )}
          {installed.map((m) => (
            <PopoverItem
              key={m.id}
              current={m.active}
              detail={m.languages}
              onSelect={() => {
                if (m.active) return close();
                void ipc
                  .setSpeechModel(m.id)
                  .then(() => {
                    onChanged();
                    close();
                  })
                  .catch((e) => setError(String(e)));
              }}
            >
              {m.name}
            </PopoverItem>
          ))}
          {error && <p className="px-3 py-2 font-mono text-2xs text-error">&gt; {error}</p>}
          <p className="px-3 py-1 text-2xs text-ink-faint">
            A meeting already recording keeps the model it started with.
          </p>
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

function SummaryPicker({
  status,
  onChanged,
  onManage,
}: {
  status: NonNullable<ReturnType<typeof useLlmStatus>["status"]>;
  onChanged: () => void;
  onManage: () => void;
}) {
  const [models, setModels] = useState<SummaryModels | null>(null);
  const [error, setError] = useState<string | null>(null);

  const label =
    status.state === "ready"
      ? status.model
      : status.state === "no_model"
        ? "No summary model"
        : "Ollama closed";

  return (
    <Popover
      label="Summary model"
      title="Writes the summary and action items"
      placement="above"
      onOpen={() => {
        setError(null);
        void ipc
          .summaryModels()
          .then(setModels)
          .catch(() => {});
      }}
      trigger={<Entry ok={status.state === "ready"}>{label}</Entry>}
    >
      {(close) => (
        <>
          <PopoverHeading>Summaries</PopoverHeading>
          {status.state === "not_running" ? (
            <div className="flex flex-col items-start gap-2 px-3 py-2">
              <p className="text-2xs text-ink-muted">
                Ollama isn’t running, so no summary can be written.
              </p>
              <button
                type="button"
                onClick={() => {
                  void ipc
                    .startOllama()
                    .then(() => window.setTimeout(onChanged, 4_000))
                    .catch((e) => setError(String(e)));
                }}
                className="rounded-sm border border-phosphor px-2.5 py-1 font-mono text-2xs uppercase tracking-system text-phosphor trace-press hover:bg-phosphor hover:text-surface-0"
              >
                Open Ollama
              </button>
            </div>
          ) : models === null ? (
            <p className="px-3 py-2 font-mono text-2xs text-ink-faint">&gt; asking Ollama…</p>
          ) : models.installed.length === 0 ? (
            <p className="px-3 py-2 font-mono text-2xs text-ink-faint">&gt; none installed.</p>
          ) : (
            models.installed.map((m) => (
              <PopoverItem
                key={m.name}
                current={m.active}
                detail={m.parameters ?? undefined}
                onSelect={() => {
                  if (m.active) return close();
                  void ipc
                    .setSummaryModel(m.name)
                    .then(() => {
                      onChanged();
                      close();
                    })
                    .catch((e) => setError(String(e)));
                }}
              >
                {m.name}
              </PopoverItem>
            ))
          )}
          {error && <p className="px-3 py-2 font-mono text-2xs text-error">&gt; {error}</p>}
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

function Entry({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <>
      <span
        aria-hidden
        className={`size-1.5 shrink-0 rounded-full ${ok ? "bg-phosphor" : "bg-warn"}`}
      />
      <span className={`truncate ${ok ? "" : "text-warn"}`}>{children}</span>
      <span aria-hidden className="text-ink-faint">
        ▴
      </span>
    </>
  );
}
