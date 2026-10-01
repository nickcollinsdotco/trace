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

/**
 * `tauri build` refuses to run when a Tauri crate and its npm package are on
 * different minor releases, and nothing else notices: the app compiles, every
 * test passes, and the failure first shows up in `pnpm update-app`. Adding a
 * plugin with `cargo add` moved the `tauri` crate to 2.12 under an API still
 * locked at 2.11 — this is that check, run where a build is not.
 */
describe("Tauri's two halves", () => {
  const minor = (v: string | undefined) => v?.split(".").slice(0, 2).join(".");
  const crate = (name: string) =>
    versionIn("src-tauri/Cargo.lock", new RegExp(`name = "${name}"\\nversion = "([\\d.]+)"`));
  const pkg = (name: string) =>
    versionIn("pnpm-lock.yaml", new RegExp(`'${name.replace("/", "\\/")}@([\\d.]+)'`));

  it("are on the same minor release", () => {
    expect(minor(crate("tauri"))).toBeDefined();
    expect(minor(pkg("@tauri-apps/api"))).toBe(minor(crate("tauri")));
  });

  it("match for every plugin that has both", () => {
    const plugins = [...read("src-tauri/Cargo.toml").matchAll(/^tauri-plugin-([\w-]+)\s*=/gm)].map(
      (m) => m[1],
    );
    expect(plugins.length).toBeGreaterThan(0);
    for (const name of plugins) {
      // Some plugins are driven from Rust alone (the global shortcut) and
      // have no npm half to disagree with.
      const js = pkg(`@tauri-apps/plugin-${name}`);
      if (js === undefined) continue;
      expect(minor(js), name).toBe(minor(crate(`tauri-plugin-${name}`)));
    }
  });
});
