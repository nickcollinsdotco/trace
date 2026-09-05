```text
████████╗██████╗  █████╗  ██████╗███████╗
╚══██╔══╝██╔══██╗██╔══██╗██╔════╝██╔════╝
   ██║   ██████╔╝███████║██║     █████╗
   ██║   ██╔══██╗██╔══██║██║     ██╔══╝
   ██║   ██║  ██║██║  ██║╚██████╗███████╗
   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚══════╝

       MEETING INTELLIGENCE SYSTEM

· · · · · · · · · · · · · · · · · · · · · · · ·

        [ OK ] AUDIO INPUT
        [ OK ] TRANSCRIPTION ENGINE
        [ OK ] LOCAL INDEX
        [ OK ] CONTEXT BUFFER
        [ -- ] AWAITING SESSION

        TRACE // BUILD 0.1.0

· · · · · · · · · · · · · · · · · · · · · · · ·
```

# TRACE

```Conversations leave traces.```

A lightweight, local-first meeting companion for capturing conversations,
transcribing them, and turning them into useful notes.

**Everything runs on your machine.** No API keys, no subscription, no
per-meeting cost, and no audio leaving the computer.

## Status

`EARLY DEVELOPMENT` — M0 (scaffold) complete. M1 (audio capture) is next.

## Stack

Tauri 2 · Rust · React 19 · TypeScript · Tailwind v4 · Parakeet · Ollama · Markdown

## How it works

```text
mic + system audio ─► local transcription ─► your notes ─► local LLM ─► Markdown
```

Microphone and system audio are captured as **two independent streams**, so
every transcript line already knows whether you said it or they did — speaker
attribution without a diarisation model.

Markdown files are the canonical source of truth. SQLite is only ever a
rebuildable index.

## Setup

### Prerequisites

| | |
|---|---|
| Node.js | 22+ |
| pnpm | 10+ |
| Rust | stable, via [rustup](https://rustup.rs) |
| MSVC C++ build tools | "Desktop development with C++" workload, incl. Windows SDK |
| WebView2 | preinstalled on Windows 10/11 |

Rust and the MSVC toolchain are required for anything that touches
`src-tauri/`. The frontend alone runs without them.

```powershell
winget install Rustlang.Rustup
winget install Microsoft.VisualStudio.2022.BuildTools `
  --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

No `winget`? Install [rustup](https://rustup.rs) and the
[Build Tools for Visual Studio](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022)
manually, selecting the **Desktop development with C++** workload.

### Run

```bash
pnpm install
pnpm tauri dev     # full desktop app (needs Rust)
pnpm dev           # frontend only, in a browser
```

### Verify

```bash
pnpm verify        # lint + typecheck + tests
cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test
```

## Documentation

Specifications live in [docs/](docs/) — product definition, architecture,
roadmap, UX, design direction, data model, and the terminal/easter-egg
language.

## Stats

![Alt](https://repobeats.axiom.co/api/embed/6166a714e9235b6b46e13ec516a249add4165e79.svg "Repobeats analytics image")

## Licence

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for third-party attributions.
