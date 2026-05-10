# OpenCherry

> Multi-repo × multi-agent control tower for AI-assisted coding.

OpenCherry is an open source desktop app (Linux + macOS) that lets you
orchestrate many Git repositories across many AI coding agents
(Claude Code, OpenCode, Codex, Gemini CLI, Aider, …) from a single
VS Code Source Control–style interface.

**Status:** pre-alpha, Sprint 0 (architecture spike). Not usable yet.

## Why

Existing AI coding tools assume one repo, one agent, one terminal at a
time. Real work spans many repos and benefits from parallel agents.
OpenCherry is the missing dashboard.

## Stack

- **Language:** Rust (stable)
- **UI:** [GPUI](https://github.com/zed-industries/zed/tree/main/crates/gpui) (Zed's framework)
- **Git:** `git2` (vendored libgit2); `gix` evaluated for batch reads
- **Async:** Tokio via `gpui_tokio`
- **Persistence:** `rusqlite` (planned)
- **Process detection:** `sysinfo`
- **Filesystem watch:** `notify`

## License

AGPL-3.0-or-later. See [LICENSE](./LICENSE).

## Repository layout

```
crates/
  opencherry/         # binary entry point
  opencherry_core/    # shared types (RepoId, AgentId, events)
  opencherry_repo/    # git2-backed repo operations
```

Additional crates (`opencherry_ui`, `opencherry_agents`, `opencherry_inject`,
`opencherry_commit_msg`, `opencherry_providers`, `opencherry_watcher`,
`opencherry_persistence`, `opencherry_settings`) will be extracted as the
codebase grows.
