import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Windows treats `Scope.tsx` and `scope.ts` as the same module, and the
 * development server, once it has seen one, serves the wrong file for the
 * other and renders a blank window. This happened twice in a week: a
 * component and its plain module sharing a name. One rule catches both.
 */
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}

describe("source file names", () => {
  it("never differ only by letter case, ignoring the extension", () => {
    const root = join(process.cwd(), "src");
    // Each file's module name: its path without `.test` or its extension.
    const byLower = new Map<string, Set<string>>();
    for (const file of files(root)) {
      const name = relative(root, file).replace(/(\.test)?\.[a-z]+$/, "");
      const lower = name.toLowerCase();
      byLower.set(lower, (byLower.get(lower) ?? new Set()).add(name));
    }
    const clashes = [...byLower.values()]
      .filter((names) => names.size > 1)
      .map((names) => [...names].join(" / "));
    expect(clashes).toEqual([]);
  });
});
