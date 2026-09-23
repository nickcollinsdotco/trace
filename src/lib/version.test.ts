import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The version lives in five files, and `pnpm bump` keeps them in step.
 *
 * This is what catches a hand edit to one of them. The installer is named
 * after `tauri.conf.json`, and the app shows that same version in its status
 * bar and on About, so a drifted `package.json` would mean a build whose name
 * and label disagree with the code that produced it.
 */

const root = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

function versionIn(path: string, pattern: RegExp): string | undefined {
  return read(path).match(pattern)?.[1];
}

describe("version", () => {
  it("is the same everywhere it is written", () => {
    const installer = versionIn("src-tauri/tauri.conf.json", /"version":\s*"(\d+\.\d+\.\d+)"/);
    expect(installer).toBeDefined();

    expect(versionIn("package.json", /"version":\s*"(\d+\.\d+\.\d+)"/)).toBe(installer);
    expect(versionIn("src-tauri/Cargo.toml", /^version = "(\d+\.\d+\.\d+)"/m)).toBe(installer);
    expect(versionIn("src-tauri/Cargo.lock", /name = "trace"\nversion = "(\d+\.\d+\.\d+)"/)).toBe(
      installer,
    );
    expect(versionIn("README.md", /TRACE \/\/ BUILD (\d+\.\d+\.\d+)/)).toBe(installer);
  });
});
