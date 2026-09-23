/**
 * Open the folder the Windows installers are built into.
 *
 * A script rather than a bare `explorer …` in package.json, because Explorer
 * exits with status 1 even when it succeeds, so pnpm would report every
 * successful run as a failure. It also says what to do when nothing has been
 * built yet, instead of opening a folder that does not exist.
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "src-tauri", "target", "release", "bundle", "nsis");

const installers = existsSync(dir)
  ? readdirSync(dir)
      .filter((f) => f.endsWith("-setup.exe"))
      .map((f) => ({ name: f, time: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time)
  : [];

if (installers.length === 0) {
  console.error("No installers built yet. Run `pnpm update-app`, or `pnpm tauri build`.");
  process.exit(1);
}

console.log(`Newest: ${installers[0].name}`);
console.log(dir);

if (process.platform === "win32") {
  // Detached and ignored, so Explorer's exit status never reaches pnpm.
  spawn("explorer.exe", [dir], { detached: true, stdio: "ignore" }).unref();
}
