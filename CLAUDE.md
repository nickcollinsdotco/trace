# TRACE — working notes for agents

Local-first meeting capture. Mic + system audio → on-device transcription →
sparse human notes → local LLM → structured Markdown. **No audio leaves the
machine, and nothing needs a network after setup.** That constraint decides
most arguments here.

## The rule that has caught the most bugs

**Check the artefact, not the source.**

Every serious bug this project has had looked correct in the source and was
wrong in the thing that actually ships. The pattern repeats:

| What looked right | What was true |
|---|---|
| `--duration-fast` token defined | Not a Tailwind namespace; generated no utility |
| `--shadow-*` tokens defined | Tailwind inlines them; a theme override would silently do nothing |
| `--measure`, `--content-leading` defined | Never read by anything; width was a hardcoded class |
| VC++ DLLs added to `bundle.resources` | Installed into a *subfolder*, so the loader never found them |
| "DirectML is the execution provider" | `ort-directml` was never enabled; it runs on CPU |
| Adaptive VAD "fixed" with a floor multiple | Muted speech whenever the silence-to-speech gap was narrow |

So: grep the **built CSS**, list the **MSI file table**, read the **installed
process's loaded modules**, run the engine over **real audio**. A passing test
that asserts the wrong thing is worse than no test — see `Gallery.test.tsx`,
where "renders without a console error" was satisfied for weeks by rendering
the wrong screen.

## Verify before claiming anything works

Run `/verify`, or by hand:

```bash
# Frontend
pnpm lint && pnpm check && pnpm test

# Rust
cd src-tauri
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test
```

Everything must be green. Report failures with their output rather than
around them.

## Shape

```
src/                    React 19 + TS strict + Tailwind v4 (CSS-first @theme)
  app/                  shell, routing (a union, not a router), first-run gate
  features/             capture, library, note, firstrun
  design/               tokens.css, themes.css, type.css, terminal.css
  fixtures/             the gallery — every screen, every state, no recording
  lib/ipc.ts            the ONLY place Tauri commands are named
src-tauri/src/
  audio/                cpal mic + wasapi loopback, two independent streams
  transcribe/           chunker (adaptive VAD), streaming, Parakeet via ONNX
  synthesis/            windowed prompts, citation validation
  store/                append-only journal, atomic Markdown writes
  examples/             spikes and diagnostics, run with --example
docs/                   specs, plan (11), visual triage (12), backlog (10)
```

## Things worth knowing before changing them

- **Windows only for v1.** macOS loopback is a later phase.
- **Dual-stream capture is the speaker attribution.** Mic is "you", system is
  "them". No diarisation model. `Segment.source` is load-bearing.
- **The journal is the source of truth**, not memory and not the Markdown.
  Both the normal path and crash recovery replay it, so they cannot diverge.
- **Note bodies are never re-parsed.** Only frontmatter and action-item
  checkboxes are read back. Regeneration replays the journal instead.
- **Synthesis must cite.** Claims whose evidence ids do not resolve are
  dropped, and the count is shown to the user rather than hidden.
- **Audio is deleted after synthesis** unless the keep-audio setting is on.
  Turn it on before investigating anything transcription-related, or the
  evidence is gone by the time you look.

## Diagnostics that already exist

```bash
cd src-tauri
cargo run --release --example chunk_check   -- <session dir>   # VAD + chunk boundaries
cargo run --release --example wav_check     -- <session dir>   # are the two streams distinct
cargo run --release --example transcribe_spike -- <session dir>
```

Sessions live in `~/Documents/TRACE/.sessions/`.

## The gallery

`#gallery` in dev, or **Ctrl+Shift+G**. Renders the real screens against
fixtures — every state, including the failures, with no recording needed.
Themes switch on `1`–`5`.

Add a scenario for any state you build. A state nobody can look at is a state
that rots.

## Style

Prose comments explaining *why*, not *what*. British English. Match the
surrounding density — this codebase comments decisions and trade-offs, not
mechanics. If a comment would restate the line below it, delete it.
