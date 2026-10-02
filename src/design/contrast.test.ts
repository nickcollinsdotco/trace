import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEMES } from "./theme";

/**
 * Text hierarchy, in every theme, measured.
 *
 * Four levels: `ink` for what is read, `ink-muted` for what supports it,
 * `ink-faint` for what is quietest, and disabled — `ink-faint` at reduced
 * opacity, so it needs no token. Each must be readable on the grounds text
 * sits on, and each a clear step below the one above: Teletext's levels
 * were all near full brightness, so a model's description in its picker
 * read as loudly as the model.
 *
 * Read from the CSS, as type.test.ts does: jsdom cannot resolve the
 * variables, and the stylesheet is what ships.
 */

const css = (name: string) => readFileSync(join(process.cwd(), "src/design", name), "utf8");

function tokens(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/--(color-[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]?.trim()]),
  );
}

const base = tokens(css("tokens.css"));
const themes = css("themes.css");

function themeTokens(theme: string): Record<string, string> {
  const out = { ...base };
  const re = new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([^}]*)\\}`, "g");
  for (const m of themes.matchAll(re)) Object.assign(out, tokens(m[1] ?? ""));
  return out;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = Number.parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

/** Readable: WCAG AA for body text, and 3:1 for the quietest, large or not. */
const FLOOR = { ink: 7, "ink-muted": 4.5, "ink-faint": 3 } as const;
/** A level must be visibly quieter than the one above it, not just different. */
const STEP = 1.35;

describe("text hierarchy", () => {
  for (const theme of THEMES) {
    it(`${theme}: every level readable, each a clear step below the last`, () => {
      const t = themeTokens(theme === "carbon" ? "__none__" : theme);
      for (const ground of ["color-surface-1", "color-surface-2"]) {
        const bg = t[ground] ?? "#000";
        const level = (k: keyof typeof FLOOR) => contrast(t[`color-${k}`] ?? "#000", bg);
        for (const k of Object.keys(FLOOR) as Array<keyof typeof FLOOR>) {
          expect(level(k), `${k} on ${ground}`).toBeGreaterThanOrEqual(FLOOR[k]);
        }
        expect(level("ink") / level("ink-muted"), `ink over muted on ${ground}`).toBeGreaterThan(
          STEP,
        );
        expect(
          level("ink-muted") / level("ink-faint"),
          `muted over faint on ${ground}`,
        ).toBeGreaterThan(STEP);
      }
    });
  }
});
