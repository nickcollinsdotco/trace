---
name: verify
description: Run TRACE's full check gate — frontend lint, typecheck and tests, then Rust fmt, clippy and tests. Use before claiming a change works, before committing, and after any dependency change.
---

Run every check. Do not stop at the first failure — a full picture beats a
fast one, and failures often share a cause.

```bash
pnpm lint
pnpm check
pnpm test

cd src-tauri
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test
```

Report the result honestly: green means every one passed, and anything else
gets its actual output, not a summary of it.

## Green is not the same as correct

This gate proves the code compiles, is formatted, and that the tests pass. It
does **not** prove the tests assert the right thing, and in this project that
has been the more common failure. `Gallery.test.tsx` passed for weeks while
every capture scenario rendered the wrong screen, because "renders without a
console error" is satisfied by rendering anything at all.

So when the change touches something with a shipped artefact, check the
artefact too:

- **CSS or design tokens** — build, then grep `dist/assets/*.css` for the rule.
  Tailwind silently emits nothing for a token in a namespace it does not know,
  and inlines `--shadow-*` rather than emitting a variable.
- **Packaging or dependencies** — build the installer, list the MSI file
  table, and read the loaded module paths of the *installed* process. A DLL
  beside `target/release/trace.exe` proves nothing about where the installer
  puts it.
- **Transcription** — run it over real audio from
  `~/Documents/TRACE/.sessions/`, with `cargo run --release --example
  chunk_check`. Turn the keep-audio setting on first, or the evidence is
  deleted before you can look at it.

## Mutation-check a new test

A test that cannot fail is not a test. Break the thing it covers, confirm it
goes red, then restore. Cheap, and it has caught assertions that were passing
for the wrong reason.
