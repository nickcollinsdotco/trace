/**
 * Screen effects: the glass the app is shown through (CONTEXT.md).
 *
 * A screen is a mix, not a choice. Each effect has its own amount, and the
 * textures can sit over the content or behind it. The first version offered
 * one filter at one of three strengths, drew its lines in hard black, and
 * made the text unreadable; the mix exists so each effect can be set exactly
 * as loud as it should be, and the placement so a texture can be enjoyed
 * without ever touching a letter.
 *
 * lofi.cafe is the reference for how these should feel. Its lines are a soft
 * texture blended in overlay mode at 40%, which brightens and darkens what is
 * beneath rather than painting black over it; its vignette lifts the middle
 * as well as dimming the corners; its glow is big.
 */

export const EFFECTS = [
  "grain",
  "scanlines",
  "dots",
  "vignette",
  "glow",
  "flicker",
  "roll",
] as const;

export type Effect = (typeof EFFECTS)[number];

/**
 * Textures, which can go behind the letters. The rest act on everything.
 *
 * "Behind" is a blend, not a layer underneath: a layer underneath would be
 * hidden by every surface — the sidebar, the top bar, each card — and leave
 * the texture in patches. Blended to lighten, it shows wherever the screen is
 * darker than the texture and nowhere a letter is brighter, which is the
 * promise: it never touches a letter. The vignette cannot be one of these,
 * since its whole job is to darken.
 */
export const PLACEABLE: readonly Effect[] = ["grain", "scanlines", "dots"];

export const PLACES = ["over", "behind"] as const;

export type Place = (typeof PLACES)[number];

export interface EffectSetting {
  /** 0–100. Zero is off, and costs nothing: its layer is not drawn at all. */
  amount: number;
  place: Place;
}

export type Screen = Record<Effect, EffectSetting>;

export const EFFECT_LABELS: Record<Effect, string> = {
  grain: "Grain",
  scanlines: "Scanlines",
  dots: "Dot grid",
  vignette: "Vignette",
  glow: "Glow",
  flicker: "Flicker",
  roll: "Refresh bar",
};

export const EFFECT_NOTES: Record<Effect, string> = {
  grain: "Film grain that boils, and breathes a little stronger and weaker.",
  scanlines: "Soft raster lines that shade what is under them rather than cutting it.",
  dots: "A dot grid, like the ground of a punch card or an LED panel.",
  vignette: "A lit centre falling away to the corners.",
  glow: "Phosphor bloom around every letter.",
  flicker: "The faint, uneven pulse of a tube.",
  roll: "A soft band of light rolling down the screen.",
};

/** Where each effect starts. Dots belong to the ground; the rest to the glass. */
const DEFAULT_PLACE: Record<Effect, Place> = {
  grain: "over",
  scanlines: "over",
  dots: "behind",
  vignette: "over",
  glow: "over",
  flicker: "over",
  roll: "over",
};

export const PRESETS = ["none", "lines", "lofi", "crt", "film", "grid"] as const;

export type Preset = (typeof PRESETS)[number];

export const PRESET_NOTES: Record<Preset, string> = {
  none: "Clean glass.",
  lines: "Soft raster lines at lofi.cafe's 40%, and nothing else.",
  lofi: "lofi.cafe's recipe: overlay lines at 40%, a lit vignette, a big glow.",
  crt: "A tube: lines, glow, a flicker, the refresh bar rolling down. It switches on.",
  film: "Grain and a soft vignette, like a projected print.",
  grid: "A dot grid on the ground, behind everything.",
};

const PRESET_AMOUNTS: Record<Preset, Partial<Record<Effect, number>>> = {
  none: {},
  lines: { scanlines: 40 },
  lofi: { scanlines: 40, vignette: 60, glow: 60 },
  crt: { scanlines: 55, vignette: 45, glow: 45, flicker: 50, roll: 50 },
  film: { grain: 45, vignette: 35 },
  grid: { dots: 60 },
};

export function presetScreen(preset: Preset): Screen {
  const amounts = PRESET_AMOUNTS[preset];
  return Object.fromEntries(
    EFFECTS.map((e) => [e, { amount: amounts[e] ?? 0, place: DEFAULT_PLACE[e] }]),
  ) as Screen;
}

/** The preset a screen is exactly, or null once any effect has been moved. */
export function presetOf(screen: Screen): Preset | null {
  return (
    PRESETS.find((p) => {
      const target = presetScreen(p);
      return EFFECTS.every(
        (e) =>
          screen[e].amount === target[e].amount &&
          (screen[e].amount === 0 || screen[e].place === target[e].place),
      );
    }) ?? null
  );
}

export function isPreset(value: unknown): value is Preset {
  return typeof value === "string" && (PRESETS as readonly string[]).includes(value);
}

export function isEffect(value: unknown): value is Effect {
  return typeof value === "string" && (EFFECTS as readonly string[]).includes(value);
}

/**
 * A screen read back from storage. Each effect validated on its own, so one
 * bad value from an older build resets that effect rather than the lot.
 */
export function readScreen(raw: unknown, fallback: Screen): Screen {
  if (!raw || typeof raw !== "object") return fallback;
  const saved = raw as Record<string, { amount?: unknown; place?: unknown } | undefined>;
  return Object.fromEntries(
    EFFECTS.map((e) => {
      const s = saved[e];
      const amount =
        typeof s?.amount === "number" && s.amount >= 0 && s.amount <= 100
          ? Math.round(s.amount)
          : fallback[e].amount;
      const place =
        PLACEABLE.includes(e) && (s?.place === "over" || s?.place === "behind")
          ? s.place
          : fallback[e].place;
      return [e, { amount, place }];
    }),
  ) as Screen;
}

/** One effect changed. Pure, so it can be tested. */
export function withEffectSetting(
  screen: Screen,
  effect: Effect,
  patch: Partial<EffectSetting>,
): Screen {
  const next = { ...screen[effect], ...patch };
  next.amount = Math.max(0, Math.min(100, Math.round(next.amount)));
  if (!PLACEABLE.includes(effect)) next.place = DEFAULT_PLACE[effect];
  return { ...screen, [effect]: next };
}

/**
 * Put a screen on the element that carries the look.
 *
 * Each effect in use gets an attribute naming its place and a variable
 * holding its amount; an effect at zero gets neither, so its layer is not
 * drawn and costs nothing. The preset, when the mix is exactly one, is named
 * too, so a preset can carry a moment of its own (CRT switches on).
 */
export function applyScreen(screen: Screen, target: HTMLElement): void {
  for (const e of EFFECTS) {
    const { amount, place } = screen[e];
    if (amount > 0) {
      target.setAttribute(`data-fx-${e}`, place);
      target.style.setProperty(`--fx-${e}`, String(amount / 100));
    } else {
      target.removeAttribute(`data-fx-${e}`);
      target.style.removeProperty(`--fx-${e}`);
    }
  }
  const preset = presetOf(screen);
  if (preset && preset !== "none") target.setAttribute("data-screen-preset", preset);
  else target.removeAttribute("data-screen-preset");
}
