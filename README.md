# OpenCherry 🍒

<img width="2952" height="1808" alt="image" src="https://github.com/user-attachments/assets/5bb79d23-9413-4b8f-a5c9-ed159d600e9f" />

> Ubuntu/GNOME-first multi-repo × multi-agent control tower for AI-assisted coding.

OpenCherry is an open source desktop app that lets you orchestrate many Git
repositories across many AI coding agents (Claude Code, OpenCode, Codex,
Gemini CLI, Aider, …) from a single VS Code Source Control–style interface.

**Status:** alpha. Usable for the current multi-repo Git + agent-correlation MVP, with Ubuntu/GNOME as the primary target and rough edges still expected.

## Why

Existing AI coding tools assume one repo, one agent, one terminal at a time.
Real work spans many repos and benefits from parallel agents. OpenCherry is the
missing dashboard.

The closest neighbour is [superset-sh/superset](https://github.com/superset-sh/superset),
which targets macOS only. OpenCherry targets **Ubuntu/GNOME first**, with macOS
and Windows as supported secondary platforms via Tauri 2.

## Stack

- **Shell:** [Tauri 2](https://tauri.app) (Rust core + WebView UI)
- **Frontend:** [SolidJS](https://solidjs.com) + Vite + TypeScript
- **Language:** Rust (stable, 1.80+)
- **Git:** `git2` (vendored libgit2) plus selective `git` CLI calls for remote operations
- **Process detection:** `sysinfo`
- **Async:** Tokio
- **Filesystem watch:** `notify`
- **Persistence:** `rusqlite` + SQLite

## Current Capabilities

### Repositories

- register and remove tracked repositories
- persist tracked repositories in SQLite
- import legacy `repos.json` data automatically
- show a multi-repo sidebar and per-repo detail view

### Git workflow

- repository status snapshot
- grouped diff sections:
  - conflicted
  - staged
  - unstaged
  - untracked
- stage file
- unstage file
- commit staged changes
- stage all + commit
- publish current branch
- sync local and remote changes

### Agents

- detect running CLI agents via `sysinfo`
- classify supported agents:
  - Claude Code
  - OpenCode
  - Codex
  - Gemini CLI
  - Aider
- ignore Antigravity extension processes
- filter Linux thread duplicates from process snapshots

### Frontend

- repository sidebar with add/remove actions
- repo status cards
- commit message box and commit actions
- dynamic primary action bar for commit/publish/sync states
- grouped diff rendering with per-file stage/unstage actions
- detected agent panel

## License

AGPL-3.0-or-later. See [LICENSE](./LICENSE).

## Repository layout

```
apps/
  desktop/              # Tauri 2 app
    src-tauri/          # Rust binary + tauri.conf.json
    src/                # SolidJS frontend
crates/
  opencherry_core/      # shared types (RepoId, AgentId, events)
  opencherry_repo/      # git2-backed repo operations
  opencherry_agents/    # sysinfo-based agent detection
  opencherry_persistence/ # SQLite-backed repo persistence
```

Additional crates (`opencherry_inject`, `opencherry_commit_msg`,
`opencherry_providers`, `opencherry_watcher`, `opencherry_persistence`,
`opencherry_settings`) will be extracted as the codebase grows.

## Development

### Quick Start (Recommended)

The easiest way to set up the project is using the provided setup script and `just` task runner.

1. **Install all dependencies:**
   ```bash
   ./scripts/setup.sh
   ```

2. **Run the app:**
   ```bash
   just dev
   ```

3. **Run tests:**
   ```bash
   just test
   ```

### Manual Setup

#### System dependencies (Ubuntu 24.04+)

```bash
sudo apt install libwebkit2gtk-4.1-dev \
  libjavascriptcoregtk-4.1-dev \
  libsoup-3.0-dev \
  librsvg2-dev \
  libssl-dev \
  libayatana-appindicator3-dev
```

#### System dependencies (macOS)

- Xcode Command Line Tools: `xcode-select --install`

WebKit (the WebView used by Tauri) ships with macOS, so there is nothing else
to install for the GUI.

#### System dependencies (Windows)

- Microsoft Visual Studio C++ Build Tools (MSVC linker)
- WebView2 runtime (preinstalled on Windows 10/11)

`git2` builds with `vendored-libgit2`, so no system libgit2 or OpenSSL is
needed on any platform.

#### Toolchain (all platforms)

- Rust stable (1.80+) via `rustup`
- Node.js 20+
- pnpm 9+

#### Run dev shell

```bash
pnpm -C apps/desktop install
pnpm -C apps/desktop tauri dev
```

### Validate

```bash
just check
```

## Packaging & local install

OpenCherry ships as unsandboxed packages — no store, no auto-updater. The app
spawns external AI CLI agents and manages Git repos in arbitrary filesystem
locations, so an unsandboxed package is the right fit; Flatpak/Snap are deferred
(Snap with `confinement: classic` is the likely future route). Linux releases
are published as `.AppImage`, `.deb`, and `.rpm`; macOS as `.dmg`; Windows as an
NSIS `.exe`. Every release asset ships with a matching `.sha256` checksum.

### Quick install (one command)

The fastest way to get OpenCherry on Linux (x86_64):

```sh
curl -fsSL https://raw.githubusercontent.com/4nrry/opencherry/main/scripts/install.sh | sh
```

This resolves the latest `.AppImage` for your architecture, verifies its
SHA-256, installs it to `~/.local/bin/opencherry`, and adds an application-menu
entry. AppImages need FUSE at runtime — if launch fails, install it with
`sudo apt install libfuse2` (Debian/Ubuntu) or run
`APPIMAGE_EXTRACT_AND_RUN=1 opencherry`.

### Build the `.deb`

The build needs the same system dependencies and toolchain as the dev shell
above. Then:

```bash
./scripts/build-deb.sh
```

This runs `pnpm -C apps/desktop tauri build --bundles deb` and prints the path
of the generated package — `target/release/bundle/deb/opencherry_<version>_amd64.deb`
(the Cargo workspace `target/` directory at the repo root). The first release
build is slow (`lto = "thin"`, `codegen-units = 1`); later builds reuse the
cache.

### Build the AppImage

```bash
just build-appimage      # or: ./scripts/build-appimage.sh
```

This produces `target/release/bundle/appimage/opencherry_<version>_amd64.AppImage`
(Tauri uses the Debian `amd64` arch token for the AppImage and `.deb`).
Run it directly (it needs FUSE — `sudo apt install libfuse2`), or use the
one-command installer above to fetch a published build instead.

### Install and run

```bash
sudo apt install "$(pwd)/target/release/bundle/deb/opencherry_0.0.1_amd64.deb"
```

Use `apt install` with a path (not `dpkg -i`) so runtime dependencies resolve
automatically. Pass an **absolute** path — `apt` rejects a relative path with
`Unsupported file ... given on commandline` when it can't resolve it from the
current directory (`build-deb.sh` prints the absolute install command for you).
Then launch **OpenCherry** from the application menu, or run the installed
binary at `/usr/bin/opencherry-desktop`.

### Update and uninstall

There is no auto-update. To update, bump `version` in
`apps/desktop/src-tauri/tauri.conf.json`, rebuild, and reinstall the new `.deb`
over the old one. To remove:

```bash
sudo apt remove open-cherry
```

### Windows installer (`.exe`)

Windows builds produce an NSIS installer. There are two ways to get one.

**Download from CI** — every tagged release (`v*`) attaches a Windows installer
to its GitHub Release. Manually triggering the **Release (Windows)** workflow
(`workflow_dispatch`) also builds one and uploads it as a downloadable build
artifact, so contributors can grab a build without a Windows machine.

**Build locally on Windows** — install the prerequisites first:

- Rust stable via `rustup` (MSVC toolchain)
- Node.js 20+ and pnpm 9+
- Microsoft Visual Studio C++ Build Tools (MSVC linker)
- WebView2 runtime (preinstalled on Windows 10/11)

`git2` builds with `vendored-libgit2`, so no system libgit2 or OpenSSL is
needed. Then, from the repo root in PowerShell:

```powershell
.\scripts\build-windows.ps1
```

This runs `pnpm -C apps/desktop tauri build --bundles nsis` and prints the path
of the generated installer — `target\release\bundle\nsis\opencherry_<version>_x64-setup.exe`.
Double-click it to install. The installer is unsigned, so Windows SmartScreen
may warn on first run; choose **More info → Run anyway**.

### macOS disk image (`.dmg`)

macOS builds produce a `.dmg` disk image. There are two ways to get one.

**Download from CI** — every tagged release (`v*`) attaches Apple Silicon
(`aarch64`) and Intel (`x86_64`) disk images to its GitHub Release. Manually
triggering the **Release (macOS)** workflow (`workflow_dispatch`) builds both
and uploads them as downloadable build artifacts.

**Build locally on macOS** — install the Xcode Command Line Tools
(`xcode-select --install`), Rust stable via `rustup`, and Node.js 20+ / pnpm 9+.
Then, from the repo root:

```bash
./scripts/build-macos.sh
```

This runs `pnpm -C apps/desktop tauri build --bundles dmg` and prints the path
of the generated image — `target/release/bundle/dmg/opencherry_<version>_<arch>.dmg`
(`<arch>` is `aarch64` or `x64`).
Open it and drag **OpenCherry** to Applications. The app is unsigned and not
notarized, so on first launch macOS Gatekeeper may block it; right-click the app
→ **Open**, or allow it in **System Settings → Privacy & Security**.

To cross-compile for both architectures from one machine, add the targets with
`rustup target add aarch64-apple-darwin x86_64-apple-darwin` and set
`OPENCHERRY_MAC_TARGET` (e.g. `OPENCHERRY_MAC_TARGET=universal-apple-darwin`).

## Testing

The current codebase includes backend and frontend automated coverage for the
already shipped behavior.

- persistence tests cover add/list/remove and legacy JSON import
- repo tests cover clean/dirty status, ahead/behind, grouped diff states,
  stage/unstage, commit flows, and publish/sync command behavior
- agent tests cover classification, Antigravity filtering, and Linux thread
  filtering behavior
- frontend tests cover grouped diff rendering, stage/unstage buttons, primary
  action rendering, and commit UI states
- desktop E2E scaffolding exists under `apps/desktop/e2e/` using Tauri WebDriver
  tooling; on Linux it requires `WebKitWebDriver` from the system package set

## Roadmap

- **Current focus:** stabilize the current alpha, deepen the existing Git UX, and improve internal testability.
- **Next likely steps:**
  - discard/revert by file
  - stage/unstage by hunk
  - structured diff model (hunks/lines instead of file patch blobs)
  - richer merge/rebase-aware primary actions
  - replace polling with watchers/events where appropriate
  - improve publish/sync error surfacing in the UI
  - expand test coverage as new behavior lands
