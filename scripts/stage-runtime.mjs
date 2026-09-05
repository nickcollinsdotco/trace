/**
 * Keep the committed runtime DLLs in step with what the build produces.
 *
 * `DirectML.dll` is emitted into `target/release` by the `ort` build and is a
 * *load-time* import of `trace.exe` — an installer that ships without it
 * produces an application that cannot start at all. It is therefore committed
 * under `src-tauri/redist/` rather than staged during the build, because
 * Tauri's build script validates `bundle.resources` at compile time, which is
 * before any `beforeBundleCommand` runs, and the file is produced *by* that
 * same compile. Committing it is what breaks the circle.
 *
 * The cost of committing a build artefact is drift: `ort` could update, need a
 * newer DirectML, and we would silently keep shipping the old one. So this
 * runs at bundle time and compares the two. It refreshes the committed copy
 * and says so, loudly enough that the change gets committed rather than
 * living only in a working tree.
 *
 * Wired up as `build.beforeBundleCommand`.
 */

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const built = join(root, "src-tauri", "target", "release", "DirectML.dll");
const committed = join(root, "src-tauri", "redist", "DirectML.dll");

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 12);
const mb = (p) => (statSync(p).size / 1024 / 1024).toFixed(1);

if (!existsSync(built)) {
  // Not fatal: the committed copy is what gets bundled, and a bundle run
  // without a fresh release build is still correct. Worth saying, though,
  // because it means the drift check did not happen.
  console.warn(`stage-runtime: no build output at ${built} — drift not checked`);
  process.exit(0);
}

if (!existsSync(committed)) {
  copyFileSync(built, committed);
  console.log(`stage-runtime: DirectML.dll staged (${mb(committed)} MB) — commit it`);
  process.exit(0);
}

if (sha(built) !== sha(committed)) {
  copyFileSync(built, committed);
  console.log(
    `stage-runtime: DirectML.dll CHANGED and was refreshed (${mb(committed)} MB).\n` +
      "  The ort build produced a different binary. Commit src-tauri/redist/DirectML.dll.",
  );
  process.exit(0);
}

console.log("stage-runtime: DirectML.dll up to date");
