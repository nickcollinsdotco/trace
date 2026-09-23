import { useCallback, useEffect, useState } from "react";
import { Prompt, Section } from "../../components/ui/terminal";
import { formatBytes } from "../../lib/format";
import {
  hasBackend,
  ipc,
  onModelProgress,
  onSummaryPull,
  type SpeechModel,
  type SummaryModels,
} from "../../lib/ipc";
import { LlmNotice } from "../llm/LlmNotice";
import { useLlmStatus } from "../llm/useLlmStatus";

/**
 * Every model TRACE uses, what each is for, and the means to change them.
 *
 * Two kinds, kept apart because they live in different places and fail
 * differently: speech models are TRACE's own files, downloaded and deleted
 * here; summary models belong to Ollama, which other apps may share, so
 * TRACE downloads them through Ollama but never deletes them.
 */
export function ModelsScreen() {
  return (
    <div data-mode="reading" className="h-full overflow-y-auto">
      <div className="trace-measure flex flex-col gap-10 px-6 py-10">
        <SpeechModels />
        <SummaryModelsSection />
      </div>
    </div>
  );
}

function SpeechModels() {
  const [models, setModels] = useState<SpeechModel[] | null>(null);
  const [downloading, setDownloading] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!hasBackend()) return;
    void ipc
      .speechModels()
      .then(setModels)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    load();
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void onModelProgress((p) => {
      if (disposed || !p.model) return;
      const id = p.model;
      setDownloading((d) => ({ ...d, [id]: p.percent }));
    }).then((un) => {
      if (disposed) un();
      else unlisten = un;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [load]);

  function download(id: string) {
    setError(null);
    setDownloading((d) => ({ ...d, [id]: 0 }));
    void ipc
      .installModel(id)
      .then(load)
      .catch((e) => setError(String(e)))
      .finally(() =>
        setDownloading((d) => {
          const { [id]: _, ...rest } = d;
          return rest;
        }),
      );
  }

  function remove(m: SpeechModel) {
    const ok = window.confirm(
      [
        `Delete ${m.name}?`,
        "",
        `This frees about ${formatBytes(m.downloadBytes)}. It can be downloaded again at any time.`,
        "Existing notes and transcripts are not affected.",
      ].join("\n"),
    );
    if (!ok) return;
    setError(null);
    void ipc
      .deleteSpeechModel(m.id)
      .then(load)
      .catch((e) => setError(String(e)));
  }

  const installedCount = models?.filter((m) => m.installed).length ?? 0;

  return (
    <Section title="Transcription">
      <p className="text-sm text-ink-muted">
        Turns speech into text on this machine. The choice applies from the next meeting.
      </p>
      {error && (
        <p className="font-mono text-2xs text-error">
          <Prompt />
          {error}
        </p>
      )}
      <div className="flex flex-col gap-3">
        {models?.map((m) => (
          <ModelCard
            key={m.id}
            name={m.name}
            summary={m.summary}
            facts={[m.languages, formatBytes(m.downloadBytes)]}
            active={m.active && m.installed}
          >
            {downloading[m.id] !== undefined ? (
              <Progress percent={downloading[m.id] ?? 0} />
            ) : m.installed ? (
              <>
                {!m.active && (
                  <ActionButton
                    primary
                    onClick={() =>
                      void ipc
                        .setSpeechModel(m.id)
                        .then(load)
                        .catch((e) => setError(String(e)))
                    }
                  >
                    Use
                  </ActionButton>
                )}
                <ActionButton
                  destructive
                  disabled={m.active && installedCount === 1}
                  title={
                    m.active && installedCount === 1
                      ? "The only speech model — download another before deleting this one"
                      : undefined
                  }
                  onClick={() => remove(m)}
                >
                  Delete
                </ActionButton>
              </>
            ) : (
              <ActionButton primary onClick={() => download(m.id)}>
                Download
              </ActionButton>
            )}
          </ModelCard>
        ))}
      </div>
    </Section>
  );
}

function SummaryModelsSection() {
  const llm = useLlmStatus();
  const [models, setModels] = useState<SummaryModels | null>(null);
  const [pulling, setPulling] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!hasBackend()) return;
    void ipc
      .summaryModels()
      .then(setModels)
      .catch((e) => setError(String(e)));
  }, []);

  // Reload whenever Ollama's state changes — opening it from the notice
  // should fill the list without a manual refresh.
  const state = llm.status?.state;
  useEffect(() => {
    if (state !== undefined) load();
  }, [state, load]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void onSummaryPull((p) => {
      if (!disposed) setPulling((d) => ({ ...d, [p.model]: p.percent }));
    }).then((un) => {
      if (disposed) un();
      else unlisten = un;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  function pull(name: string) {
    setError(null);
    setPulling((d) => ({ ...d, [name]: 0 }));
    void ipc
      .pullSummaryModel(name)
      .then(() => {
        load();
        llm.recheck();
      })
      .catch((e) => setError(String(e)))
      .finally(() =>
        setPulling((d) => {
          const { [name]: _, ...rest } = d;
          return rest;
        }),
      );
  }

  function use(name: string) {
    setError(null);
    void ipc
      .setSummaryModel(name)
      .then(() => {
        load();
        llm.recheck();
      })
      .catch((e) => setError(String(e)));
  }

  const running = llm.status !== null && llm.status.state !== "not_running";
  const notInstalled = models?.recommended.filter((r) => !r.installed) ?? [];

  return (
    <Section title="Summaries">
      <p className="text-sm text-ink-muted">
        Writes the summary and action items after a meeting, through Ollama. Larger models write
        better notes and need more video memory.
      </p>
      {/* Only when closed: with Ollama running, the downloads below are the fix
          for "no model", so the notice's terminal command would be a detour. */}
      <LlmNotice
        status={llm.status?.state === "not_running" ? llm.status : null}
        onRecheck={llm.recheck}
        context="models"
      />
      {error && (
        <p className="font-mono text-2xs text-error">
          <Prompt />
          {error}
        </p>
      )}

      {running && models && (
        <div className="flex flex-col gap-3">
          {models.installed.map((m) => (
            <ModelCard
              key={m.name}
              name={m.name}
              summary={
                models.recommended.find((r) => r.name === m.name)?.summary ?? "Installed in Ollama"
              }
              facts={[m.parameters ? `${m.parameters} parameters` : null, formatBytes(m.sizeBytes)]}
              active={m.active}
            >
              {!m.active && (
                <ActionButton primary onClick={() => use(m.name)}>
                  Use
                </ActionButton>
              )}
            </ModelCard>
          ))}

          {notInstalled.map((r) => (
            <ModelCard
              key={r.name}
              name={r.name}
              summary={r.summary}
              facts={[`about ${formatBytes(r.approxBytes)} download`]}
              active={false}
            >
              {pulling[r.name] !== undefined ? (
                <Progress percent={pulling[r.name] ?? 0} />
              ) : (
                <ActionButton primary onClick={() => pull(r.name)}>
                  Download
                </ActionButton>
              )}
            </ModelCard>
          ))}

          <p className="text-2xs text-ink-faint">
            Models are stored by Ollama and may be used by other apps, so TRACE never deletes them.
            Remove one with <code className="font-mono">ollama rm &lt;name&gt;</code>.
          </p>
        </div>
      )}
    </Section>
  );
}

function ModelCard({
  name,
  summary,
  facts,
  active,
  children,
}: {
  name: string;
  summary: string;
  facts: Array<string | null>;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      data-model-card
      className={`flex flex-wrap items-center gap-x-4 gap-y-3 rounded-md border p-4 ${
        active ? "border-phosphor bg-phosphor-dim" : "border-line bg-surface-1"
      }`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex items-baseline gap-2">
          <span className="trace-title text-base text-ink">{name}</span>
          {active && (
            <span className="font-mono text-2xs uppercase tracking-system text-phosphor">
              ● In use
            </span>
          )}
        </p>
        <p className="text-sm text-ink-muted">{summary}</p>
        <p className="font-mono text-2xs text-ink-faint">{facts.filter(Boolean).join(" · ")}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function ActionButton({
  primary,
  destructive,
  disabled,
  title,
  onClick,
  children,
}: {
  primary?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  title?: string | undefined;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const tone = primary
    ? "border-phosphor text-phosphor hover:bg-phosphor hover:text-surface-0"
    : destructive
      ? "border-line-strong text-ink-muted hover:border-error hover:text-error"
      : "border-line-strong text-ink hover:border-phosphor hover:text-phosphor";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-sm border px-3 py-1.5 font-mono text-2xs uppercase tracking-system trace-press disabled:cursor-not-allowed disabled:opacity-40 ${tone}`}
    >
      {children}
    </button>
  );
}

function Progress({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <span className="flex w-40 items-center gap-2" role="status" aria-label="Downloading">
      <span
        className="trace-fill h-2 flex-1"
        style={{ "--fill": clamped / 100 } as React.CSSProperties}
      />
      <span className="w-9 text-right font-mono text-2xs tabular-nums text-ink-muted">
        {clamped}%
      </span>
    </span>
  );
}
