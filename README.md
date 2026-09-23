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

        TRACE // BUILD 0.2.0

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

### Update your installed copy

TRACE is installed from an installer you build yourself. To update it:

```powershell
pnpm update-app          # pull main, build, close TRACE, launch the installer
pnpm update-app -Yes     # the same, without asking before closing TRACE
```

The script stops with a clear message before touching anything if there are
uncommitted changes, the pull fails, or the build fails, so a failed update
leaves the TRACE you have working. It only closes TRACE once a fresh
installer exists, and asks first, because closing it mid-meeting ends the
recording.

To run it from any folder as `Update-Trace`, add this to your PowerShell
profile (`notepad $PROFILE`; create the file if it does not exist):

```powershell
function Update-Trace {
    powershell.exe -NoProfile -ExecutionPolicy Bypass `
        -File "C:\Users\nfbco\Documents\GITHUB\TRACE\trace\scripts\update.ps1" @args
}
```

Then run `. $PROFILE`, or open a new terminal. If PowerShell refuses to load
the profile ("running scripts is disabled on this system"), allow local
scripts once with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

`pnpm open-installers` opens the folder the installers are built into
(`src-tauri\target\release\bundle\nsis`) and names the newest.

### Versions

Each release gets its own version, so installers and the running app can be
told apart. The version appears in the app's status bar and on its About
page, and names the installer (`TRACE_0.2.0_x64-setup.exe`).

```bash
pnpm bump            # 0.2.0 -> 0.2.1, for fixes
pnpm bump minor      # 0.2.0 -> 0.3.0, for features
pnpm bump 1.0.0      # an exact version
```

It updates `package.json`, `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` and the banner above, and a
test fails if any of them drift apart. Commit the bump with the change it
ships.

In-app updates, like Handy's "Update available", are a later option: see
the updater entry in [docs/10-BACKLOG.md](docs/10-BACKLOG.md).

## Documentation

Specifications live in [docs/](docs/) — product definition, architecture,
roadmap, UX, design direction, data model, and the terminal/easter-egg
language.

## Stats

![Alt](https://repobeats.axiom.co/api/embed/6166a714e9235b6b46e13ec516a249add4165e79.svg "Repobeats analytics image")

## Licence

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for third-party attributions.
