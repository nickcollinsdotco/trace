import { useEffect, useRef, useState } from "react";
import { Page } from "../../components/ui/Page";
import { ThemeScope } from "../../components/ui/ThemeScope";
import { Section, SystemLabel } from "../../components/ui/terminal";
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
  CASE_NOTES,
  FAMILIES,
  FAMILY_NOTES,
  MONO_NOTES,
  type Overrides,
  THEME_FAMILY,
  THEME_FRAME,
  THEME_NOTES,
  THEME_TYPE,
  THEMES,
  type Theme,
  TYPE_NOTES,
  themesIn,
} from "../../design/theme";
import { useFun } from "../fun/fun";
import { ThemeSample } from "./ThemeSample";

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
  const { appearance, setTheme, setPreset, setEffect, setAxis, reset } = useAppearanceControl();
  const overridden = isAdjusted(appearance, appearance.theme);
  const adjustments = currentAdjustments(appearance);
  const family = THEME_FAMILY[appearance.theme];
  const screen = currentScreen(appearance);
  const preset = presetOf(screen);

  return (
    <Page className="gap-10">
      <Section title="Theme">
        <p className="text-sm text-ink-muted">
          Point at a theme to see it; choose one to use it — or press <Key>1</Key>–
          <Key>{String(THEMES.length % 10)}</Key> anywhere outside a text field. A theme is best
          judged over a few days of real meetings, not from a preview.
        </p>
        <ThemePicker
          current={appearance.theme}
          adjustments={appearance.adjustments}
          isAdjusted={(t) => isAdjusted(appearance, t)}
          onChoose={setTheme}
        />
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

      <FunSection />

      <Section
        title={`Adjust ${appearance.theme}`}
        actions={
          overridden ? (
            <button
              type="button"
              onClick={reset}
              className="trace-control font-mono text-2xs tracking-system text-ink-faint trace-press hover:text-ink"
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
              ownValue={themeOwn(appearance.theme, axis)}
              value={adjustments[axis]}
              onChange={(v) => setAxis(axis, v)}
            />
          ))}
        </div>
      </Section>
    </Page>
  );
}

/**
 * Every theme in a list, grouped by family, and one large preview that
 * follows the pointer and the keyboard — the palette's move: look first,
 * choose second. The cards it replaces were ten small previews at once,
 * all loud, each half-dressed in the current theme (ThemeScope says why),
 * so the current choice was the hardest thing on the page to find.
 */
function ThemePicker({
  current,
  adjustments,
  isAdjusted,
  onChoose,
}: {
  current: Theme;
  adjustments: Partial<Record<Theme, Overrides>>;
  isAdjusted: (theme: Theme) => boolean;
  onChoose: (theme: Theme) => void;
}) {
  const [pointed, setPointed] = useState<Theme | null>(null);
  const shown = pointed ?? current;
  const shift = useShiftHeld();
  const compare = shift && shown !== current;

  const list = useRef<HTMLDivElement>(null);

  // Up and down walk the list, as in the palette; Tab still leaves it.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = Array.from(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = rows[(at + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow keys between the rows, each a button */}
      <div
        ref={list}
        className="flex flex-col gap-4"
        onKeyDown={onKeyDown}
        onMouseLeave={() => setPointed(null)}
        onBlur={(e) => {
          if (!list.current?.contains(e.relatedTarget as Node | null)) setPointed(null);
        }}
      >
        {FAMILIES.map((family) => (
          <div key={family} className="flex flex-col gap-1">
            <SystemLabel>{family}</SystemLabel>
            <p className="pb-1 text-2xs text-ink-faint">{FAMILY_NOTES[family]}</p>
            {themesIn(family).map((theme) => (
              <ThemeRow
                key={theme}
                theme={theme}
                overrides={adjustments[theme]}
                selected={theme === current}
                adjusted={isAdjusted(theme)}
                onPoint={() => setPointed(theme)}
                onChoose={() => onChoose(theme)}
              />
            ))}
          </div>
        ))}
      </div>

      {/* minmax(0, 1fr) and min-w-0: a theme with wide, unwrapping type would
          otherwise push the preview out of its card. */}
      <div className="flex min-w-0 flex-col gap-2 md:sticky md:top-16 md:self-start">
        <ThemeScope
          theme={shown}
          overrides={adjustments[shown]}
          className="overflow-hidden rounded-md border border-line"
        >
          <ThemeSample />
        </ThemeScope>
        <p className="flex items-baseline gap-2 font-mono text-xs">
          <span className="text-ink">{shown}</span>
          <span className="text-ink-faint">
            {shown === current
              ? "· in use"
              : "· click, or press Enter, to use it — hold Shift to compare"}
          </span>
        </p>
        <p className="text-2xs text-ink-muted">{THEME_NOTES[shown]}</p>
      </div>

      {compare && <Compare left={current} right={shown} adjustments={adjustments} />}
    </div>
  );
}

/**
 * Shift held over another theme: the one in use and the one pointed at, side
 * by side, each at the preview's full width, over the page for as long as
 * Shift is down. Side by side in the column, each half the width of one
 * preview, they wrapped and squeezed until they could not be compared.
 */
function Compare({
  left,
  right,
  adjustments,
}: {
  left: Theme;
  right: Theme;
  adjustments: Partial<Record<Theme, Overrides>>;
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-6 top-1/2 z-50 mx-auto grid max-w-[68rem] -translate-y-1/2 grid-cols-2 gap-4 rounded-lg border border-line-strong bg-surface-1 p-4 shadow-(--elevation-overlay)"
    >
      {[
        { theme: left, label: "in use" },
        { theme: right, label: "pointed at" },
      ].map(({ theme, label }) => (
        <div key={theme} className="flex min-w-0 flex-col gap-2">
          <p className="flex items-baseline gap-2 font-mono text-xs">
            <span className="text-ink">{theme}</span>
            <span className="text-ink-faint">· {label}</span>
          </p>
          <ThemeScope
            theme={theme}
            overrides={adjustments[theme]}
            className="overflow-hidden rounded-md border border-line"
          >
            <ThemeSample />
          </ThemeScope>
        </div>
      ))}
    </div>
  );
}

/** Whether Shift is held — for comparing a theme with the one in use. */
function useShiftHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const on = (e: KeyboardEvent) => setHeld(e.shiftKey);
    const off = () => setHeld(false);
    window.addEventListener("keydown", on);
    window.addEventListener("keyup", on);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("keydown", on);
      window.removeEventListener("keyup", on);
      window.removeEventListener("blur", off);
    };
  }, []);
  return held;
}

function ThemeRow({
  theme,
  overrides,
  selected,
  adjusted,
  onPoint,
  onChoose,
}: {
  theme: Theme;
  overrides: Overrides | undefined;
  selected: boolean;
  adjusted: boolean;
  onPoint: () => void;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onChoose}
      onMouseEnter={onPoint}
      onFocus={onPoint}
      className={`flex items-center gap-3 rounded-sm px-2 py-1.5 text-left trace-press ${
        selected
          ? "bg-phosphor-dim text-phosphor"
          : "text-ink-muted hover:bg-surface-2 hover:text-ink"
      }`}
    >
      {/* The theme's own ground, text and accent, in its own scope. */}
      <ThemeScope theme={theme} overrides={overrides} className="shrink-0">
        <span aria-hidden className="flex gap-0.5 rounded-xs border border-line bg-surface-0 p-1">
          <span className="size-2.5 rounded-full bg-ink" />
          <span className="size-2.5 rounded-full bg-ink-muted" />
          <span className="size-2.5 rounded-full bg-phosphor" />
        </span>
      </ThemeScope>
      <span className="min-w-0 flex-1 truncate font-mono text-sm">{theme}</span>
      {adjusted && (
        <span title="Adjusted — Reset under Adjust puts it back" className="font-mono text-2xs">
          adjusted
        </span>
      )}
      <span className="font-mono text-2xs text-ink-faint">
        {selected ? "✓" : (THEMES.indexOf(theme) + 1) % 10}
      </span>
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
        className={`font-mono text-2xs trace-caps-label tracking-system ${on ? "text-ink" : "text-ink-faint"}`}
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

/**
 * Fun mode's switch. App-wide, unlike everything above it, which belongs to
 * a family: a narrator that came and went with the theme would be a puzzle.
 */
function FunSection() {
  const fun = useFun();
  return (
    <Section title="Fun mode">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={fun.on}
          onChange={(e) => fun.setOn(e.target.checked)}
          className="mt-1 accent-(--color-phosphor)"
        />
        <span className="flex flex-col gap-1">
          <span className="text-sm text-ink">Let the machine talk</span>
          <span className="text-2xs text-ink-faint">
            A narrator in the status bar, deadpan, about what the app is doing — never about what
            anyone said. The boot sequence at launch. During a meeting it speaks only of the
            meeting, and anything the status bar genuinely needs to say comes first.
          </span>
        </span>
      </label>
    </Section>
  );
}

const AXIS_NOTES: Partial<Record<Axis, Record<string, string>>> = {
  mono: MONO_NOTES,
  role: TYPE_NOTES,
  case: CASE_NOTES,
};

/** What a theme itself chose on an axis — what "Theme" stands for there. */
function themeOwn(theme: Theme, axis: Axis): string {
  const type = THEME_TYPE[theme];
  if (axis === "frame") return THEME_FRAME[theme];
  if (axis === "role") return type.role;
  if (axis === "mono") return type.mono;
  return type.case;
}

/**
 * One axis. The theme's own choice comes first, named — "Theme · geist" —
 * and is not offered again among the others: it used to be, and picking
 * Geist on a theme already in Geist changed nothing and looked broken.
 */
function AxisControl({
  axis,
  ownValue,
  value,
  onChange,
}: {
  axis: Axis;
  ownValue: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  const { label, options } = AXES[axis];
  const note = AXIS_NOTES[axis]?.[value ?? ownValue];

  return (
    <div className="grid grid-cols-[8rem_1fr] items-start gap-x-4 gap-y-1">
      <span className="pt-1.5 font-mono text-2xs trace-caps-label tracking-system text-ink-faint">
        {label}
      </span>
      <div className="flex flex-col gap-1">
        <fieldset className="m-0 flex flex-wrap gap-1 border-0 p-0">
          <legend className="sr-only">{label}</legend>
          <Choice
            selected={value === undefined || value === ownValue}
            onClick={() => onChange(undefined)}
          >
            Theme · {ownValue}
          </Choice>
          {options
            .filter((o) => o !== ownValue)
            .map((o) => (
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
