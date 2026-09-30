import { useEffect, useRef } from "react";
import { Page } from "../../components/ui/Page";
import { Prompt, Section, SystemLabel } from "../../components/ui/terminal";
import {
  AXES,
  type Axis,
  currentFilter,
  FILTER_NOTES,
  FILTERS,
  useAppearanceControl,
} from "../../design/appearance";
import {
  applyTheme,
  CASE_NOTES,
  FAMILIES,
  FAMILY_NOTES,
  type Family,
  MONO_NOTES,
  type Overrides,
  THEME_FAMILY,
  THEME_NOTES,
  THEMES,
  type Theme,
  TYPE_NOTES,
  themesIn,
} from "../../design/theme";

/**
 * The theme, chosen by seeing it.
 *
 * Each card is the real token set applied to a small sample, not a
 * screenshot, so a preview can never disagree with what selecting it does.
 *
 * The fine-tuning axes exist because the decision this page serves is still
 * open: which look survives weeks of real meetings (docs/11-PLAN.md, Phase
 * C). They were gallery-only, which made that test depend on a dev harness.
 */
export function AppearanceScreen() {
  const { appearance, setTheme, setFamily, setFilter, setAxis, reset } = useAppearanceControl();
  const overridden = Object.values(appearance.overrides).some((v) => v !== undefined);
  const family = THEME_FAMILY[appearance.theme];
  const filter = currentFilter(appearance);

  return (
    <Page className="gap-10">
      <Section title="Theme">
        <p className="text-sm text-ink-muted">
          Two families, each with its own themes and its own screen. Pick one, then a theme within
          it — or press <Key>1</Key>–<Key>{String(THEMES.length)}</Key> anywhere outside a text
          field. A theme is best judged over a few days of real meetings, not from a preview.
        </p>

        <fieldset className="m-0 flex w-fit gap-1 rounded-pill border border-line p-1">
          <legend className="sr-only">Family</legend>
          {FAMILIES.map((f) => (
            <FamilyChoice
              key={f}
              family={f}
              selected={family === f}
              // Back to the theme last used in that family, not its first.
              onSelect={() => setFamily(f)}
            />
          ))}
        </fieldset>
        <p className="text-2xs text-ink-faint">{FAMILY_NOTES[family]}</p>

        {/* Under the switch because it belongs to the family: each one
            remembers its own, so flipping brings back the whole of it. */}
        <div className="grid grid-cols-[8rem_1fr] items-start gap-x-4 gap-y-1">
          <span className="pt-1.5 font-mono text-2xs uppercase tracking-system text-ink-faint">
            Screen
          </span>
          <div className="flex flex-col gap-1">
            <fieldset className="m-0 flex flex-wrap gap-1 border-0 p-0">
              <legend className="sr-only">Screen filter</legend>
              {FILTERS.map((f) => (
                <Choice key={f} selected={filter === f} onClick={() => setFilter(f)}>
                  {f}
                </Choice>
              ))}
            </fieldset>
            <p className="text-2xs text-ink-faint">{FILTER_NOTES[filter]}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {themesIn(family).map((theme) => (
            <ThemeCard
              key={theme}
              theme={theme}
              shortcut={THEMES.indexOf(theme) + 1}
              selected={appearance.theme === theme}
              overrides={appearance.overrides}
              onSelect={() => setTheme(theme)}
            />
          ))}
        </div>
      </Section>

      <Section
        title="Fine-tuning"
        actions={
          overridden ? (
            <button
              type="button"
              onClick={reset}
              className="font-mono text-2xs uppercase tracking-system text-ink-faint trace-press hover:text-ink"
            >
              Reset to theme
            </button>
          ) : undefined
        }
      >
        <p className="text-sm text-ink-muted">
          Each theme has its own choices for these. “Theme” keeps them; anything else overrides them
          on top of whichever theme is selected.
        </p>
        <div className="flex flex-col gap-4">
          {(Object.keys(AXES) as Axis[]).map((axis) => (
            <AxisControl
              key={axis}
              axis={axis}
              value={appearance.overrides[axis]}
              onChange={(v) => setAxis(axis, v)}
            />
          ))}
        </div>
      </Section>
    </Page>
  );
}

function ThemeCard({
  theme,
  shortcut,
  selected,
  overrides,
  onSelect,
}: {
  theme: Theme;
  shortcut: number;
  selected: boolean;
  overrides: Overrides;
  onSelect: () => void;
}) {
  const preview = useRef<HTMLDivElement>(null);

  // The card previews the theme with the user's overrides on top, so it
  // shows what choosing it would actually look like.
  useEffect(() => {
    if (preview.current) applyTheme(theme, preview.current, overrides);
  }, [theme, overrides]);

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex flex-col overflow-hidden rounded-md border text-left trace-press ${
        selected ? "border-phosphor" : "border-line hover:border-line-strong"
      }`}
    >
      {/* Theme-scoped: every token below re-skins to this card's theme. */}
      <div
        ref={preview}
        aria-hidden
        data-mode="reading"
        className="flex flex-col gap-2 bg-surface-0 px-4 py-3"
      >
        <SystemLabel tone="phosphor">Trace</SystemLabel>
        {/* The section framing's own classes, not SectionHead: that renders a
            heading, and a heading inside a button is not valid HTML. Wrapped
            in a section so boxed themes draw the box the title sits in. */}
        <span className="trace-section gap-2">
          <span className="trace-section-head">
            <span aria-hidden className="trace-section-corner font-mono text-2xs text-ink-faint/50">
              ┌
            </span>
            <SystemLabel>Decisions</SystemLabel>
            <span aria-hidden className="trace-rule" />
          </span>
          <span className="trace-prose text-sm text-ink">Ship the pricing page on Friday.</span>
          <span className="font-mono text-2xs text-ink-muted">
            <span className="text-phosphor">●</span> them 00:42 — works for us
          </span>
        </span>
      </div>
      <div className="flex flex-col gap-1 border-t border-line bg-surface-1 px-4 py-3">
        <span className="flex items-baseline gap-2">
          <span className={`font-mono text-xs ${selected ? "text-phosphor" : "text-ink"}`}>
            {selected && <Prompt />}
            {theme}
          </span>
          <span className="ml-auto font-mono text-2xs text-ink-faint">{shortcut}</span>
        </span>
        <span className="text-2xs text-ink-muted">{THEME_NOTES[theme]}</span>
      </div>
    </button>
  );
}

function FamilyChoice({
  family,
  selected,
  onSelect,
}: {
  family: Family;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`rounded-pill px-4 py-1.5 font-mono text-2xs uppercase tracking-system trace-press ${
        selected ? "bg-phosphor text-surface-0" : "text-ink-muted hover:text-ink"
      }`}
    >
      {family}
    </button>
  );
}

const AXIS_NOTES: Partial<Record<Axis, Record<string, string>>> = {
  mono: MONO_NOTES,
  role: TYPE_NOTES,
  case: CASE_NOTES,
};

function AxisControl({
  axis,
  value,
  onChange,
}: {
  axis: Axis;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  const { label, options } = AXES[axis];
  const note = value ? AXIS_NOTES[axis]?.[value] : undefined;

  return (
    <div className="grid grid-cols-[8rem_1fr] items-start gap-x-4 gap-y-1">
      <span className="pt-1.5 font-mono text-2xs uppercase tracking-system text-ink-faint">
        {label}
      </span>
      <div className="flex flex-col gap-1">
        <fieldset className="m-0 flex flex-wrap gap-1 border-0 p-0">
          <legend className="sr-only">{label}</legend>
          <Choice selected={value === undefined} onClick={() => onChange(undefined)}>
            Theme
          </Choice>
          {options.map((o) => (
            <Choice key={o} selected={value === o} onClick={() => onChange(o)}>
              {o}
            </Choice>
          ))}
        </fieldset>
        {note && <p className="text-2xs text-ink-faint">{note}</p>}
      </div>
    </div>
  );
}

function Choice({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`rounded-sm border px-2.5 py-1 font-mono text-2xs trace-press ${
        selected
          ? "border-phosphor bg-phosphor-dim text-phosphor"
          : "border-line text-ink-muted hover:border-line-strong hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-xs border border-line-strong px-1 font-mono text-2xs text-ink">
      {children}
    </kbd>
  );
}
