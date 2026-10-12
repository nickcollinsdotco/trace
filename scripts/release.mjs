/**
 * Build TRACE and publish it as a GitHub Release the in-app updater finds.
 *
 *   pnpm release             build, sign, and publish the version in tauri.conf.json
 *   pnpm release --dry-run   build and sign, write latest.json, publish nothing
 *
 * Run on this machine, not in CI, because the updater's private key lives
 * here: `~/.tauri/trace-updater.key`, or wherever TAURI_SIGNING_PRIVATE_KEY
 * points. Its public half is in `tauri.conf.json`, and every installed copy
 * refuses an update not signed by it. **Lose the key and no installed TRACE
 * can update itself again** — keep a copy somewhere other than this laptop.
 *
 * The installer is not Authenticode-signed. An update the app downloads
 * itself carries no Mark of the Web, so SmartScreen should only ever warn on
 * a first install from the browser.
 *
 * Publishes what is on GitHub's main, so a release always matches a commit
 * anyone can read: it refuses uncommitted changes, another branch, or a main
 * not yet pushed.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "nickcollinsdotco/trace";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");

function stop(message) {
  console.error(`\nRelease stopped: ${message}`);
  console.error("Nothing was published.");
  process.exit(1);
}

/** Run a command, failing the release if it fails; returns its output. */
function run(command, args, { quiet = false, env } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    // pnpm and gh are .cmd shims on Windows, which need a shell to start.
    shell: process.platform === "win32",
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    env: env ?? process.env,
  });
  if (result.status !== 0) {
    stop(`${command} ${args[0]} failed${quiet ? `:\n${result.stderr}` : " (output above)"}.`);
  }
  return (result.stdout ?? "").trim();
}

/** Quotes an argument for the shell `run` starts on Windows; as-is elsewhere. */
const q = (arg) => (process.platform === "win32" ? `"${arg.replaceAll('"', "'")}"` : arg);

function step(text) {
  console.log(`\n== ${text}`);
}

const version = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8")).version;
const tag = `v${version}`;
console.log(`TRACE ${version}${dryRun ? " (dry run: nothing is published)" : ""}`);

// --- What is being released ----------------------------------------------

step("Checking the tree is what GitHub has");
if (run("git", ["status", "--porcelain", "--untracked-files=no"], { quiet: true })) {
  stop("there are uncommitted changes. A release must be a commit anyone can read.");
}
run("git", ["fetch", "--quiet", "origin", "main"], { quiet: true });
const head = run("git", ["rev-parse", "HEAD"], { quiet: true });
const main = run("git", ["rev-parse", "origin/main"], { quiet: true });
if (head !== main) {
  if (!dryRun) stop("HEAD is not origin/main. Merge and push first, then release from main.");
  console.log("HEAD is not origin/main — fine for a dry run, not for a release.");
} else {
  console.log(`origin/main, ${head.slice(0, 7)}.`);
}

// The newest changelog entry is this version's: version.test.ts fails
// otherwise. Its title and notes become the release's.
const changelog = readFileSync(join(root, "src/changelog.ts"), "utf8");
const entry = changelog.slice(changelog.indexOf(`version: "${version}"`));
const title = entry.match(/title:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
if (!title) stop(`src/changelog.ts has no entry for ${version}. Run \`pnpm bump\` and write one.`);
const notesBlock = entry.match(/notes:\s*\[([\s\S]*?)\n\s*\],/)?.[1] ?? "";
const notes = [...notesBlock.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`));

const key = process.env.TAURI_SIGNING_PRIVATE_KEY ?? join(homedir(), ".tauri", "trace-updater.key");
if (!process.env.TAURI_SIGNING_PRIVATE_KEY && !existsSync(key)) {
  stop(`no updater key at ${key}. Restore it from your backup; a new one would not match
the public key every installed TRACE holds.`);
}

if (!dryRun) {
  run("gh", ["auth", "status"], { quiet: true });
  const existing = spawnSync("gh", ["release", "view", tag, "--repo", REPO], {
    cwd: root,
    shell: process.platform === "win32",
    stdio: "ignore",
  });
  if (existing.status === 0) stop(`${tag} is already released. \`pnpm bump\` first.`);
}

// --- Build -----------------------------------------------------------------

step(`Building TRACE ${version} (several minutes)`);
// Updater artifacts only here, through a config overlay: in tauri.conf.json
// they would make every build need the private key, `pnpm update-app` too.
const overlay = join(mkdtempSync(join(tmpdir(), "trace-release-")), "updater.json");
writeFileSync(overlay, JSON.stringify({ bundle: { createUpdaterArtifacts: true } }));
const started = Date.now();
run("pnpm", ["tauri", "build", "--bundles", "nsis", "--config", q(overlay)], {
  env: {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: key,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "",
  },
});

const bundle = join(root, "src-tauri/target/release/bundle/nsis");
const installerName = `TRACE_${version}_x64-setup.exe`;
const installer = join(bundle, installerName);
const signature = `${installer}.sig`;
for (const file of [installer, signature]) {
  // An old file from an earlier build would publish the wrong bytes.
  if (!existsSync(file) || statSync(file).mtimeMs < started) {
    stop(`the build wrote no new ${file}.`);
  }
}

// --- The manifest the updater reads ----------------------------------------

const manifest = {
  version,
  notes: title,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: readFileSync(signature, "utf8").trim(),
      url: `https://github.com/${REPO}/releases/download/${tag}/${installerName}`,
    },
  },
};
const latest = join(bundle, "latest.json");
writeFileSync(latest, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${latest}.`);

if (dryRun) {
  console.log("\nDry run: built and signed, nothing published.");
  console.log(`  ${installer}\n  ${latest}`);
  process.exit(0);
}

// --- Publish ---------------------------------------------------------------

step(`Publishing ${tag}`);
const body = [...notes.map((n) => `- ${n}`), "", `Installer: \`${installerName}\`.`].join("\n");
const notesFile = join(dirname(overlay), "notes.md");
writeFileSync(notesFile, body);
run("gh", [
  "release",
  "create",
  tag,
  q(installer),
  q(latest),
  "--repo",
  REPO,
  "--target",
  head,
  "--title",
  q(`TRACE ${version}: ${title}`),
  "--notes-file",
  q(notesFile),
]);
console.log(`\nReleased ${tag}. Installed copies find it when the version is clicked.`);
