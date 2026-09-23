/**
 * Set TRACE's version everywhere it is written, in one step.
 *
 *   pnpm bump            0.1.0 -> 0.1.1
 *   pnpm bump minor      0.1.0 -> 0.2.0
 *   pnpm bump major      0.1.0 -> 1.0.0
 *   pnpm bump 0.3.0      exactly that
 *
 * Five places carry the version, and an installer is named after the one in
 * `tauri.conf.json` — which is also what the app shows in its status bar and
 * on About. Updating them by hand is how two different builds end up both
 * called `TRACE_0.1.0_x64-setup.exe`. `src/lib/version.test.ts` fails if they
 * ever disagree.
 *
 * Edits text in place rather than re-serialising JSON or TOML, so formatting
 * and comments in those files are left exactly as they were.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Each file, and the one pattern in it that holds TRACE's own version. */
const FILES = [
  { path: "package.json", pattern: /("version":\s*")(\d+\.\d+\.\d+)(")/ },
  { path: "src-tauri/tauri.conf.json", pattern: /("version":\s*")(\d+\.\d+\.\d+)(")/ },
  // The first `version =` in Cargo.toml is `[package]`'s.
  { path: "src-tauri/Cargo.toml", pattern: /^(version = ")(\d+\.\d+\.\d+)(")/m },
  // Only TRACE's own entry: the lock holds hundreds of other versions.
  { path: "src-tauri/Cargo.lock", pattern: /(name = "trace"\nversion = ")(\d+\.\d+\.\d+)(")/ },
  { path: "README.md", pattern: /(TRACE \/\/ BUILD )(\d+\.\d+\.\d+)()/ },
];

function next(current, spec) {
  if (/^\d+\.\d+\.\d+$/.test(spec)) return spec;
  const [major, minor, patch] = current.split(".").map(Number);
  switch (spec) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      console.error(`Not a version or a part: "${spec}". Use patch, minor, major, or x.y.z.`);
      process.exit(1);
  }
}

const read = (f) => readFileSync(join(root, f.path), "utf8");

const found = FILES.map((f) => {
  const match = read(f).match(f.pattern);
  if (!match) {
    console.error(`bump: no version found in ${f.path}. Has its format changed?`);
    process.exit(1);
  }
  return match[2];
});

// Bump from the version the installer is named after, and say so if the
// others had drifted: this run fixes them, and that is worth knowing.
const current = found[1];
const drifted = FILES.filter((_, i) => found[i] !== current).map((f) => f.path);
if (drifted.length > 0) {
  console.warn(`bump: out of step with tauri.conf.json (${current}): ${drifted.join(", ")}`);
}

const version = next(current, process.argv[2] ?? "patch");

for (const f of FILES) {
  writeFileSync(join(root, f.path), read(f).replace(f.pattern, `$1${version}$3`));
}

console.log(`TRACE ${current} -> ${version}`);
console.log("Commit it with the change it belongs to; the next build is named after it:");
console.log(`  TRACE_${version}_x64-setup.exe`);
