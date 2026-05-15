# AGENTS.md

Repo-specific guidance for AI coding agents. Keep it short; assume the reader knows Rust, Tauri 2, SolidJS, and pnpm.

## Layout (Cargo workspace + single Tauri app)

- `apps/desktop/src-tauri/` — Rust binary `opencherry-desktop` and lib `opencherry_desktop_lib`. All Tauri commands are registered in `src-tauri/src/lib.rs`. `main.rs` is a thin entry.
- `apps/desktop/src/` — SolidJS frontend. Shared backend ↔ frontend types live in `apps/desktop/src/types.ts`.
- `apps/desktop/e2e/` — separate pnpm package (WebdriverIO + `tauri-driver`). Not part of the root `pnpm` install.
- `crates/opencherry_core` — shared serde types and `CoreError`. Other crates depend on it via `{ workspace = true }`.
- `crates/opencherry_repo` — `git2` workflow + selective `git` CLI shellouts (`run_git`, `run_git_slice`) for remote ops.
- `crates/opencherry_agents` — `sysinfo`-based agent detection (Claude Code, OpenCode, Codex, Gemini CLI, Aider).
- `crates/opencherry_persistence` — SQLite (`opencherry.db`) + legacy `repos.json` import.

Crates expose **free functions in `lib.rs`** — there is no submodule split. Tests are inline `#[cfg(test)] mod tests` at the bottom of each `lib.rs`.

## Commands

Rust (run from repo root):
- `cargo check --workspace`
- `cargo test --workspace` or `cargo test -p opencherry_repo` (etc.)
- `cargo fmt --all -- --check`
- `cargo clippy --workspace --all-targets -- -D warnings`

Frontend (always pass `-C apps/desktop`; do not `cd`):
- `pnpm -C apps/desktop install`
- `pnpm -C apps/desktop test` (Vitest, jsdom, setup at `src/test/setup.ts`)
- `pnpm -C apps/desktop build` (= `tsc -b && vite build`)
- `pnpm -C apps/desktop tauri dev` (full desktop run; Vite serves on `localhost:1420`, port is `strictPort`)

E2E (separate package — do not run via root pnpm):
- `pnpm -C apps/desktop test:e2e` → delegates to `pnpm --dir e2e test`
- Requires `cargo install tauri-driver --locked` and on Linux `WebKitWebDriver` (`sudo apt install webkitgtk-webdriver xvfb`). Skip and note if missing.

## Conventions you would otherwise guess wrong

- **Workspace deps:** declare every dep once in root `Cargo.toml` `[workspace.dependencies]` and reference as `{ workspace = true }` in crate `Cargo.toml`. Don't add direct version pins in member crates.
- **Errors:** `anyhow::Result` at Tauri command boundaries; `thiserror`-derived enums (e.g. `CoreError`) for shared/library errors.
- **Logging:** `tracing` everywhere; `tracing-subscriber` is initialized **only** in the desktop binary.
- **Local vs remote git:** local ops use `git2` (vendored libgit2). Remote ops (publish/sync) shell out via `run_git` / `run_git_slice`. Use the `*_with` injection variants (`publish_branch_with`, `sync_changes_with`, `commit`) when writing deterministic tests.
- **Tauri command surface change:** if you add/modify a `#[tauri::command]` in `src-tauri/src/lib.rs`, update the matching type in `apps/desktop/src/types.ts` and re-run both Rust and frontend tests.
- **Frontend:** SolidJS function components, local signals/resources, no extra abstraction layer. Preserve existing visual language unless asked.

## Repo hygiene gotchas

- `/.serena/`, `/docs/`, `/.opencherry-cache/`, `/data/local/`, `**/src-tauri/gen/`, and the local icon working files (`opencherry-icon-rounded.png`, `apps/desktop/src-tauri/opencherry-icon-source.png`) are **gitignored**. Do not re-add them or commit `/.serena/` unless explicitly asked.
- `docs/` exists locally with planning notes but is not published — do not link from public docs.
- Rust toolchain is pinned via `rust-toolchain.toml` (stable + rustfmt + clippy, minimal profile). Don't add a different channel.

## CI expectations (`.github/workflows/ci.yml`)

Three jobs run on Ubuntu: `cargo test --workspace`, frontend `pnpm test` + `pnpm build`, and the desktop E2E (installs `tauri-driver` + `webkitgtk-webdriver`). Match these locally before pushing.

## Validation checklist after changes

- Rust touched → `cargo check --workspace` then `cargo test -p <crate>` (or `--workspace` if cross-crate). Add fmt/clippy when practical.
- Frontend touched → `pnpm -C apps/desktop test` and `pnpm -C apps/desktop build`.
- Cross-boundary (Tauri command) → both of the above.
- Always state explicitly in your final summary what you ran and what you skipped (especially E2E without WebKitWebDriver).
