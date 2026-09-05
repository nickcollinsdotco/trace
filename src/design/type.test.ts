import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Source-level guards for rules the cascade depends on.
 *
 * jsdom does not resolve `var()` in `getComputedStyle` — it returns the
 * literal `var(--fam)` — and does not inherit a computed font-family to
 * children, so the actual cascade cannot be exercised in a unit test. These
 * assert the rules exist instead. That is weaker than a render test and it is
 * stated plainly, but it does stop a rule being deleted silently, which is
 * exactly how the first version of this axis shipped doing nothing.
 */

const css = readFileSync(join(process.cwd(), "src/design/type.css"), "utf8");

describe("type.css", () => {
  it("declares font-family on the themed root", () => {
    // Without this, prose and titles inherit the family already resolved at
    // `body` and no theme can change them. This was a real bug, not a
    // hypothetical one.
    expect(css).toMatch(/\[data-type\]\s*\{[^}]*font-family:\s*var\(--font-sans\)/);
  });

  it("reassigns the roles in both directions", () => {
    expect(css).toMatch(/\[data-type="mono"\]\s*\{[^}]*--font-sans:\s*var\(--font-mono\)/);
    expect(css).toMatch(/\[data-type="sans"\]\s*\{[^}]*--font-mono:\s*var\(--font-sans\)/);
  });

  it("keeps the default mono stack byte-identical to the token default", () => {
    const tokens = readFileSync(join(process.cwd(), "src/design/tokens.css"), "utf8");
    const stack = (text: string, re: RegExp) =>
      text.match(re)?.[1]?.replace(/\s+/g, " ").trim() ?? "MISSING";

    expect(stack(css, /\[data-mono="geist"\]\s*\{\s*--font-mono:([^;]+);/)).toBe(
      stack(tokens, /--font-mono:([^;]+);/),
    );
  });

  it("applies letter case to system text but never to prose", () => {
    // `.font-mono` is system text — timestamps, transcript, status. Prose
    // carries no such class even in `mono` role, which is the point: an
    // uppercase paragraph is unreadable.
    expect(css).toMatch(/\[data-case="upper"\]\s+\.font-mono\s*\{[^}]*text-transform:\s*uppercase/);
    expect(css).toMatch(/\[data-case="lower"\]\s+\.font-mono\s*\{[^}]*text-transform:\s*lowercase/);
    expect(css).not.toMatch(/\[data-case="normal"\]/);
  });

  it("orders the role axis after the family axis", () => {
    // Same specificity, so source order decides. If `[data-mono]` came last
    // it would win and `sans` mode would keep a monospace face.
    expect(css.indexOf('[data-mono="plex"]')).toBeLessThan(css.indexOf('[data-type="sans"]'));
  });
});
