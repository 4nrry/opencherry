# Desktop E2E

This directory contains real end-to-end desktop tests for the Tauri 2 app using:

- `tauri-driver`
- WebdriverIO
- the WRY/WebKit WebDriver bridge

## Requirements

On Linux, `tauri-driver` currently requires `WebKitWebDriver` to be available in
`PATH`.

Ubuntu packages commonly needed:

```bash
sudo apt install webkitgtk-webdriver xvfb
```

`tauri-driver` must also be installed:

```bash
cargo install tauri-driver --locked
```

## Run

From `apps/desktop/`:

```bash
pnpm test:e2e
```

Or directly:

```bash
pnpm --dir e2e test
```

## Current Scope

The suite now covers real desktop runs with temporary Git fixtures and seeded
OpenCherry config state. It verifies:

- the app window launches
- the main shell renders
- the initial placeholder renders
- a tracked repo and group load from persisted state
- a group view shows discovered child repos
- `Track` registers a child repo from the group view
- repo actions work against a real Git repo: `Stage`, `Unstage`, `Discard`, and `Commit staged`
