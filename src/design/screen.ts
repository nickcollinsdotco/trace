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

export const EFFECTS = ["grain", "scanlines", "dots", "vignette", "glass", "glow", "roll"] as const;

export type Effect = (typeof EFFECTS)[number];

/**
 * Textures, which can go behind the content. The rest act on everything.
 *
 * Behind means underneath: the texture shows on the page's ground, and every
 * letter, card, box and field is drawn over it (screen.css). It was a blend
 * at first — lighten, over everything — which spared bright letters but
 * still covered every dark card, so "behind" and "over" looked the same. The
 * vignette is not one of these: it darkens, and the ground is already dark.
 */
export const PLACEABLE: readonly Effect[] = ["grain", "scanlines", "dots"];

export const PLACES = ["over", "behind"] as const;

export type Place = (typeof PLACES)[number];

export interface EffectSetting {
  /** 0–100. Zero is off, and costs nothing: its layer is not drawn at all. */
  amount: number;
  place: Place;
  /** For the effects in SIZES: one of theirs, in CSS pixels. Otherwise 0. */
  size: number;
}

/**
 * The sizes a texture comes in, in CSS pixels: the pitch of a scanline or a
 * dot, the size of a grain. Steps rather than a slider, because in between
 * sizes a pattern lands off the pixel grid and shimmers.
 */
export const SIZES: Partial<Record<Effect, readonly number[]>> = {
  grain: [1, 2, 3],
  // Up to 24: past 6 the lines stop reading as a raster and start reading
  // as blinds, which is a look of its own and worth having.
  scanlines: [2, 3, 4, 6, 8, 12, 16, 24],
  dots: [6, 8, 12, 16],
};

const DEFAULT_SIZE: Partial<Record<Effect, number>> = { grain: 1, scanlines: 3, dots: 8 };

/** How a size is shown: grain in words, since "2px" of grain means little. */
export function sizeLabel(effect: Effect, size: number): string {
  if (effect === "grain") return ["fine", "medium", "coarse"][size - 1] ?? `${size}px`;
  return `${size}px`;
}

export type Screen = Record<Effect, EffectSetting>;

export const EFFECT_LABELS: Record<Effect, string> = {
  grain: "Grain",
  scanlines: "Scanlines",
  dots: "Dot grid",
  vignette: "Vignette",
  glass: "Glass",
  glow: "Glow",
  roll: "Refresh bar",
};

export const EFFECT_NOTES: Record<Effect, string> = {
  grain: "Film grain, a new field of it 24 times a second, as a projector shows it.",
  scanlines: "Soft raster lines that shade what is under them rather than cutting it.",
  dots: "A dot grid, like the ground of a punch card or an LED panel.",
  vignette: "A lit centre falling away to the corners.",
  glass: "A sheen across the face of the tube, as real glass catches the room.",
  glow: "Phosphor bloom around every letter.",
  roll: "A soft band of light rolling down the screen.",
};

/** Where each effect starts. Dots belong to the ground; the rest to the glass. */
const DEFAULT_PLACE: Record<Effect, Place> = {
  grain: "over",
  scanlines: "over",
  dots: "behind",
  vignette: "over",
  glass: "over",
  glow: "over",
  roll: "over",
};

export const PRESETS = ["none", "lines", "lofi", "crt", "film", "grid"] as const;

export type Preset = (typeof PRESETS)[number];

export const PRESET_NOTES: Record<Preset, string> = {
  none: "Clean glass.",
  lines: "Soft raster lines at lofi.cafe's 40%, and nothing else.",
  lofi: "lofi.cafe's recipe: overlay lines at 40%, a lit vignette, a big glow.",
  crt: "A tube: lines, glow, the refresh bar rolling down. It switches on.",
  film: "Grain and a soft vignette, like a projected print.",
  grid: "A dot grid on the ground, behind everything.",
};

const PRESET_AMOUNTS: Record<Preset, Partial<Record<Effect, number>>> = {
  none: {},
  lines: { scanlines: 40 },
  lofi: { scanlines: 40, vignette: 60, glow: 60 },
  crt: { scanlines: 55, vignette: 45, glass: 60, glow: 45, roll: 50 },
  film: { grain: 45, vignette: 35 },
  grid: { dots: 60 },
};

export function presetScreen(preset: Preset): Screen {
  const amounts = PRESET_AMOUNTS[preset];
  return Object.fromEntries(
    EFFECTS.map((e) => [
      e,
      { amount: amounts[e] ?? 0, place: DEFAULT_PLACE[e], size: DEFAULT_SIZE[e] ?? 0 },
    ]),
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
          (screen[e].amount === 0 ||
            (screen[e].place === target[e].place && screen[e].size === target[e].size)),
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
  const saved = raw as Record<
    string,
    { amount?: unknown; place?: unknown; size?: unknown } | undefined
  >;
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
      const size =
        typeof s?.size === "number" && SIZES[e]?.includes(s.size) ? s.size : fallback[e].size;
      return [e, { amount, place, size }];
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
  if (!SIZES[effect]?.includes(next.size)) next.size = screen[effect].size;
  return { ...screen, [effect]: next };
}

/**
 * Put a screen on the element that carries the look.
 *
 * Each effect in use gets an attribute naming its place and a variable
 * holding its amount; an effect at zero gets neither, so its layer is not
 * drawn and costs nothing. A size, where the effect has one, is a variable
 * in pixels. `data-fx-behind` marks that something is under the content, so
 * boxes and fields can take a fill and keep it off what they hold. The
 * preset, when the mix is exactly one, is named too, so a preset can carry a
 * moment of its own (CRT switches on).
 */
export function applyScreen(screen: Screen, target: HTMLElement): void {
  let behind = false;
  for (const e of EFFECTS) {
    const { amount, place, size } = screen[e];
    if (amount > 0) {
      target.setAttribute(`data-fx-${e}`, place);
      target.style.setProperty(`--fx-${e}`, String(amount / 100));
      if (SIZES[e]) target.style.setProperty(`--fx-${e}-size`, String(size));
      if (place === "behind") behind = true;
    } else {
      target.removeAttribute(`data-fx-${e}`);
      target.style.removeProperty(`--fx-${e}`);
      target.style.removeProperty(`--fx-${e}-size`);
    }
  }
  if (behind) target.setAttribute("data-fx-behind", "");
  else target.removeAttribute("data-fx-behind");
  const preset = presetOf(screen);
  if (preset && preset !== "none") target.setAttribute("data-screen-preset", preset);
  else target.removeAttribute("data-screen-preset");
}
