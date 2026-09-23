import { useEffect, useState } from "react";
import { Prompt, Section } from "../../components/ui/terminal";
import { type DeviceInfo, hasBackend, ipc, type Settings, type SummaryMemory } from "../../lib/ipc";
import { AudioRetentionField } from "./AudioRetentionField";

const MEMORY_OPTIONS: Array<{ value: SummaryMemory; label: string; note: string }> = [
  {
    value: "during_meetings",
    label: "Ready during meetings",
    note: "Loaded when a meeting starts, so notes arrive sooner after it ends.",
  },
  {
    value: "while_writing",
    label: "Only while writing notes",
    note: "Frees video memory during calls. Notes take about a minute longer after a restart.",
  },
];

/**
 * The few preferences that are real decisions.
 *
 * Deliberately short. Each setting here changes what happens to a meeting;
 * anything that did not would be a setting nobody could explain.
 */
export function SettingsScreen() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasBackend()) return;
    void ipc
      .getSettings()
      .then(setSettings)
      .catch((e) => setError(String(e)));
    void ipc
      .listInputDevices()
      .then(setDevices)
      .catch(() => {});
  }, []);

  const save = (p: Promise<Settings>) => void p.then(setSettings).catch((e) => setError(String(e)));

  return (
    <div data-mode="reading" className="h-full overflow-y-auto">
      <div className="trace-measure flex flex-col gap-10 px-6 py-10">
        {error && (
          <p className="font-mono text-2xs text-error">
            <Prompt />
            {error}
          </p>
        )}
        {!hasBackend() && (
          <p className="font-mono text-xs text-ink-faint">
            <Prompt />
            no backend — run the desktop app.
          </p>
        )}

        {settings && (
          <>
            <Section title="Recording">
              <Field label="Microphone" note="Selected first when you start a meeting.">
                <select
                  aria-label="Default microphone"
                  value={settings.defaultMic ?? ""}
                  onChange={(e) => save(ipc.setDefaultMic(e.target.value || null))}
                  className="trace-field w-auto py-1.5 text-sm"
                >
                  <option value="">System default</option>
                  {devices.map((d) => (
                    <option key={d.name} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                  {/* A remembered device that is unplugged stays visible,
                      rather than the choice silently reading as the default. */}
                  {settings.defaultMic && !devices.some((d) => d.name === settings.defaultMic) && (
                    <option value={settings.defaultMic}>
                      {settings.defaultMic} (not connected)
                    </option>
                  )}
                </select>
              </Field>
              <Field label="Audio">
                <AudioRetentionField />
              </Field>
            </Section>

            <Section title="Summaries">
              <Field label="Model memory">
                <div
                  role="radiogroup"
                  aria-label="Summary model memory"
                  className="flex flex-col gap-2"
                >
                  {MEMORY_OPTIONS.map((o) => (
                    <label key={o.value} className="flex cursor-pointer items-start gap-3">
                      <input
                        type="radio"
                        name="summary-memory"
                        checked={settings.summaryMemory === o.value}
                        onChange={() => save(ipc.setSummaryMemory(o.value))}
                        className="mt-1 size-3.5 shrink-0 accent-phosphor"
                      />
                      <span className="flex flex-col gap-0.5">
                        <span className="text-sm text-ink">{o.label}</span>
                        <span className="text-2xs text-ink-faint">{o.note}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </Field>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  note,
  children,
}: {
  label: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-start gap-x-4 gap-y-1">
      <span className="pt-2 font-mono text-2xs uppercase tracking-system text-ink-faint">
        {label}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        {children}
        {note && <p className="text-2xs text-ink-faint">{note}</p>}
      </div>
    </div>
  );
}
