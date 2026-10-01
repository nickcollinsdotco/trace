import { useEffect, useRef } from "react";
import { Page } from "../../components/ui/Page";
import { Prompt, Section, SystemLabel } from "../../components/ui/terminal";
import {
  AXES,
  type Axis,
  currentAdjustments,
  currentScreen,
  isAdjusted,
  useAppearanceControl,
} from "../../design/appearance";
import {
  EFFECT_LABELS,
  EFFECT_NOTES,
  EFFECTS,
  type Effect,
  type EffectSetting,
  PLACEABLE,
  PLACES,
  PRESET_NOTES,
  PRESETS,
  presetOf,
  SIZES,
  sizeLabel,
} from "../../design/screen";
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
  const { appearance, setTheme, setFamily, setPreset, setEffect, setAxis, reset } =
    useAppearanceControl();
  const overridden = isAdjusted(appearance, appearance.theme);
  const adjustments = currentAdjustments(appearance);
  const family = THEME_FAMILY[appearance.theme];
  const screen = currentScreen(appearance);
  const preset = presetOf(screen);

  return (
    <Page className="gap-10">
      <Section title="Theme">
        <p className="text-sm text-ink-muted">
          Two families, each with its own themes and its own screen. Pick one, then a theme within
          it — or press <Key>1</Key>–<Key>{String(THEMES.length % 10)}</Key> anywhere outside a text
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

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {themesIn(family).map((theme) => (
            <ThemeCard
              key={theme}
              theme={theme}
              shortcut={String((THEMES.indexOf(theme) + 1) % 10)}
              selected={appearance.theme === theme}
              overrides={appearance.adjustments[theme] ?? {}}
              adjusted={isAdjusted(appearance, theme)}
              onSelect={() => setTheme(theme)}
            />
          ))}
        </div>
      </Section>

      {/* Its own section, but still the family's: each family remembers its
          screen, so flipping to Modern and back brings this one back. */}
      <Section title={`Screen · ${family}`}>
        <p className="text-sm text-ink-muted">
          Effects on the glass, each as strong as you like. Textures can sit over everything, or
          behind it — on the ground only, under every letter, card, box and field.
        </p>

        <div className="flex flex-col gap-1">
          <fieldset className="m-0 flex flex-wrap items-center gap-1 border-0 p-0">
            <legend className="sr-only">Screen preset</legend>
            {PRESETS.map((p) => (
              <Choice key={p} selected={preset === p} onClick={() => setPreset(p)}>
                {p}
              </Choice>
            ))}
            {preset === null && (
              <span className="px-2 font-mono text-2xs text-phosphor">custom</span>
            )}
          </fieldset>
          <p className="text-2xs text-ink-faint">
            {preset ? PRESET_NOTES[preset] : "Your own mix. Pick a preset to start again."}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {EFFECTS.map((effect) => (
            <EffectRow
              key={effect}
              effect={effect}
              setting={screen[effect]}
              onChange={(patch) => setEffect(effect, patch)}
            />
          ))}
        </div>
      </Section>

      <Section
        title={`Adjust ${appearance.theme}`}
        actions={
          overridden ? (
            <button
              type="button"
              onClick={reset}
              className="font-mono text-2xs uppercase tracking-system text-ink-faint trace-press hover:text-ink"
            >
              Reset {appearance.theme}
            </button>
          ) : undefined
        }
      >
        <p className="text-sm text-ink-muted">
          Changes here belong to {appearance.theme} alone: every theme keeps its own, so switching
          brings back each one as you left it. “Theme” is how it shipped; Reset puts all of them
          back.
        </p>
        <div className="flex flex-col gap-4">
          {(Object.keys(AXES) as Axis[]).map((axis) => (
            <AxisControl
              key={axis}
              axis={axis}
              value={adjustments[axis]}
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
  adjusted,
  onSelect,
}: {
  theme: Theme;
  /** The key that picks it: "1"–"9", then "0". */
  shortcut: string;
  selected: boolean;
  /** This theme's own adjustments, so the card shows it as it will look. */
  overrides: Overrides;
  adjusted: boolean;
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
          {adjusted && (
            <span
              title="Adjusted — Reset under Adjust puts it back"
              className="font-mono text-2xs text-phosphor"
            >
              adjusted
            </span>
          )}
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

/**
 * One effect: how much, and for textures, how big and where.
 *
 * A slider for the amount, because the right amount is a matter of the
 * monitor as much as of taste; arrow keys still step it by five. Size and
 * place sit on a line of their own beneath, so every slider is the same
 * length whether or not its effect has them.
 */
function EffectRow({
  effect,
  setting,
  onChange,
}: {
  effect: Effect;
  setting: EffectSetting;
  onChange: (patch: Partial<EffectSetting>) => void;
}) {
  const id = `trace-effect-${effect}`;
  const on = setting.amount > 0;
  const sizes = SIZES[effect];
  const placeable = PLACEABLE.includes(effect);

  return (
    <div
      className="grid grid-cols-[8rem_1fr_3ch] items-center gap-x-4 gap-y-1.5"
      title={EFFECT_NOTES[effect]}
    >
      <label
        htmlFor={id}
        className={`font-mono text-2xs uppercase tracking-system ${on ? "text-ink" : "text-ink-faint"}`}
      >
        {EFFECT_LABELS[effect]}
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={5}
        value={setting.amount}
        onChange={(e) => onChange({ amount: Number(e.target.value) })}
        aria-describedby={`${id}-note`}
        className="trace-range"
        style={{ "--range-fill": `${setting.amount}%` } as React.CSSProperties}
      />
      <span className="text-right font-mono text-2xs tabular-nums text-ink-muted">
        {setting.amount}
      </span>
      {(sizes || placeable) && (
        // Dimmed, not hidden, while the effect is off: its size and place
        // are still worth setting before turning it up.
        <div
          className={`col-start-2 col-end-4 flex flex-wrap items-center gap-x-5 gap-y-1 transition-opacity ${
            on ? "" : "opacity-40"
          }`}
        >
          {sizes && (
            <fieldset className="m-0 flex items-center gap-1 border-0 p-0">
              <legend className="sr-only">{`${EFFECT_LABELS[effect]} size`}</legend>
              <span aria-hidden className="pr-1 font-mono text-2xs text-ink-faint">
                size
              </span>
              {sizes.map((size) => (
                <Choice
                  key={size}
                  selected={setting.size === size}
                  onClick={() => onChange({ size })}
                >
                  {sizeLabel(effect, size)}
                </Choice>
              ))}
            </fieldset>
          )}
          {placeable && (
            <fieldset className="m-0 flex items-center gap-1 border-0 p-0">
              <legend className="sr-only">{`${EFFECT_LABELS[effect]} placement`}</legend>
              <span aria-hidden className="pr-1 font-mono text-2xs text-ink-faint">
                place
              </span>
              {PLACES.map((place) => (
                <Choice
                  key={place}
                  selected={setting.place === place}
                  onClick={() => onChange({ place })}
                >
                  {place}
                </Choice>
              ))}
            </fieldset>
          )}
        </div>
      )}
      <span id={`${id}-note`} className="sr-only">
        {EFFECT_NOTES[effect]}
      </span>
    </div>
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
