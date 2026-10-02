import { useEffect, useState } from "react";
import { Page } from "../../components/ui/Page";
import { Prompt, Section } from "../../components/ui/terminal";
import {
  type DeviceInfo,
  hasBackend,
  ipc,
  type MiniAuto,
  type Settings,
  type SummaryMemory,
} from "../../lib/ipc";
import { publishShortcut } from "../mini/shortcut";
import { AudioRetentionField } from "./AudioRetentionField";
import { ShortcutField } from "./ShortcutField";

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

/*
 * In the order docs/13 Q16 settled, quietest first. Off is the default: a
 * window that appears unasked is the complaint people make most about this
 * kind of app, so the first minimise during a meeting offers it instead.
 */
const MINI_OPTIONS: Array<{ value: MiniAuto; label: string; note: string }> = [
  {
    value: "off",
    label: "Only when I open it",
    note: "From the sidebar, Ctrl+K, or its shortcut from anywhere.",
  },
  {
    value: "minimised",
    label: "When I minimise TRACE",
    note: "During a meeting. Coming back to TRACE closes it again.",
  },
  {
    value: "switch_away",
    label: "When I switch away",
    note: "Minimised, or another app brought forward — how people actually move to a call.",
  },
  {
    value: "always",
    label: "Always during meetings",
    note: "From the moment one starts, until it is saved.",
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
      .then((next) => {
        setSettings(next);
        publishShortcut(next);
      })
      .catch((e) => setError(String(e)));
    void ipc
      .listInputDevices()
      .then(setDevices)
      .catch(() => {});
  }, []);

  const stored = (next: Settings) => {
    setSettings(next);
    // The shortcut is named in hints all over the app; they follow it here.
    publishShortcut(next);
  };
  const save = (p: Promise<Settings>) => void p.then(stored).catch((e) => setError(String(e)));

  return (
    <Page className="gap-10">
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
                className="trace-field w-auto self-start py-1.5 text-sm"
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
                  <option value={settings.defaultMic}>{settings.defaultMic} (not connected)</option>
                )}
              </select>
            </Field>
            <Field label="Audio">
              <AudioRetentionField />
            </Field>
          </Section>

          <Section title="Mini window">
            <Field label="Opens">
              <div
                role="radiogroup"
                aria-label="When the mini window opens"
                className="flex flex-col gap-2"
              >
                {MINI_OPTIONS.map((o) => (
                  <label key={o.value} className="flex cursor-pointer items-start gap-3">
                    <input
                      type="radio"
                      name="mini-auto"
                      checked={settings.miniAuto === o.value}
                      onChange={() => save(ipc.setMiniAuto(o.value))}
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
            <Field label="Shortcut">
              <ShortcutField
                shortcut={settings.miniShortcut}
                taken={settings.miniShortcutTaken}
                // Refusals are said by the field, beside the keys refused.
                onChange={(next) => ipc.setMiniShortcut(next).then(stored)}
              />
            </Field>
            <Field
              label="Position"
              note="Lost off a screen? This brings it back to the right edge of the screen TRACE is on."
            >
              <button
                type="button"
                onClick={() => void ipc.resetMini().catch((e) => setError(String(e)))}
                className="self-start rounded-sm border border-line px-3 py-1.5 font-mono text-xs text-ink-muted trace-press hover:border-line-strong hover:text-ink"
              >
                Bring it back
              </button>
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
    </Page>
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
