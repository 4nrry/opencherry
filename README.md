# OpenCherry 🍒

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

### System dependencies (Ubuntu 24.04+)

```bash
sudo apt install libwebkit2gtk-4.1-dev \
  libjavascriptcoregtk-4.1-dev \
  libsoup-3.0-dev \
  librsvg2-dev \
  libssl-dev \
  libayatana-appindicator3-dev
```

### Toolchain

- Rust stable (1.80+)
- Node.js 20+
- pnpm 9+

### Run dev shell

```bash
cd apps/desktop
pnpm install
pnpm tauri dev
```

### Validate

```bash
cargo check --workspace
cargo test --workspace
pnpm -C apps/desktop test
pnpm -C apps/desktop build
pnpm -C apps/desktop test:e2e
```

## Packaging & local install

OpenCherry ships as a plain Debian package (`.deb`) — no sandbox, no store, no
auto-updater. The app spawns external AI CLI agents and manages Git repos in
arbitrary filesystem locations, so an unsandboxed package is the right fit;
Flatpak/Snap are deferred (Snap with `confinement: classic` is the likely future
route).

### Build the `.deb`

The build needs the same system dependencies and toolchain as the dev shell
above. Then:

```bash
./scripts/build-deb.sh
```

This runs `pnpm -C apps/desktop tauri build --bundles deb` and prints the path
of the generated package — `target/release/bundle/deb/OpenCherry_<version>_amd64.deb`
(the Cargo workspace `target/` directory at the repo root). The first release
build is slow (`lto = "thin"`, `codegen-units = 1`); later builds reuse the
cache.

### Install and run

```bash
sudo apt install ./target/release/bundle/deb/OpenCherry_0.0.1_amd64.deb
```

Use `apt install` with a path (not `dpkg -i`) so runtime dependencies resolve
automatically. Then launch **OpenCherry** from the application menu, or run the
installed binary at `/usr/bin/opencherry-desktop`.

### Update and uninstall

There is no auto-update. To update, bump `version` in
`apps/desktop/src-tauri/tauri.conf.json`, rebuild, and reinstall the new `.deb`
over the old one. To remove:

```bash
sudo apt remove open-cherry
```

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
