# OpenCherry

> Ubuntu/GNOME-first multi-repo × multi-agent control tower for AI-assisted coding.

OpenCherry is an open source desktop app that lets you orchestrate many Git
repositories across many AI coding agents (Claude Code, OpenCode, Codex,
Gemini CLI, Aider, …) from a single VS Code Source Control–style interface.

**Status:** pre-alpha, Sprint 0 v2 (Tauri 2 bootstrap). Not usable yet.

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
- **Git:** `git2` (vendored libgit2); `gix` evaluated for batch reads
- **Process detection:** `sysinfo`
- **Async:** Tokio
- **Filesystem watch:** `notify`
- **Persistence:** `rusqlite` (planned, Sprint 2)

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
  opencherry_agents/    # sysinfo-based agent detection (Sprint 1)
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

## Roadmap

- **Sprint 0 v2 (current):** Tauri shell, IPC ping, repo crate, agent stub.
- **Sprint 1:** Repo registration, status cards, sysinfo agent detection.
- **Sprint 2:** Diff viewer, commit message provider, persistence.
- **Sprint 3:** Agent orchestration (spawn, attach, message bus).
- **Sprint 4:** Settings, providers, packaging (deb/AppImage/dmg/MSI).
