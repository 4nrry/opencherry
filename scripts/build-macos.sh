#!/usr/bin/env bash
#
# Build the OpenCherry desktop app as a macOS disk image (.dmg).
#
# Produces a single, unsigned, non-notarized disk image suitable for local
# install on macOS. No signing, no store — just `tauri build`.
#
# Usage:   ./scripts/build-macos.sh
# Output:  target/release/bundle/dmg/*.dmg  (Cargo workspace target dir)
#
# Requirements:
#   - macOS with the Xcode Command Line Tools (`xcode-select --install`).
#   - Rust stable via rustup.
#   - Node.js 20+ and pnpm 9+.
# git2 builds with `vendored-libgit2`, so no system libgit2/OpenSSL is needed.
#
# Apple Silicon vs Intel: by default this builds for the host architecture.
# Set OPENCHERRY_MAC_TARGET to a Rust target triple to cross-compile, e.g.
#   OPENCHERRY_MAC_TARGET=universal-apple-darwin ./scripts/build-macos.sh
# (requires the matching `rustup target add` first; `universal-apple-darwin`
# produces a fat binary for both architectures).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "==> ERROR: build-macos.sh must run on macOS (uname -s = $(uname -s))." >&2
  exit 1
fi

tauri_args=(--bundles dmg)
if [[ -n "${OPENCHERRY_MAC_TARGET:-}" ]]; then
  echo "==> Building for target: ${OPENCHERRY_MAC_TARGET}"
  tauri_args+=(--target "${OPENCHERRY_MAC_TARGET}")
fi

echo "==> Building OpenCherry .dmg (release)…"
pnpm -C apps/desktop tauri build "${tauri_args[@]}"

# This is a Cargo workspace, so the bundle lands in the workspace-root target/.
# With an explicit --target the path is nested under the triple.
if [[ -n "${OPENCHERRY_MAC_TARGET:-}" ]]; then
  dmg_dir="target/${OPENCHERRY_MAC_TARGET}/release/bundle/dmg"
else
  dmg_dir="target/release/bundle/dmg"
fi

# Resolve the freshly built image by glob so version bumps don't break this.
dmg_file="$(ls -t "$dmg_dir"/*.dmg 2>/dev/null | head -n 1 || true)"

if [[ -z "$dmg_file" ]]; then
  echo "==> ERROR: no .dmg found in $dmg_dir" >&2
  exit 1
fi

echo
echo "==> Done. Disk image built:"
echo "    $repo_root/$dmg_file"
echo
echo "    Install by opening the .dmg and dragging OpenCherry to Applications."
echo "    The app is unsigned, so on first launch macOS Gatekeeper may block it:"
echo "    right-click the app → Open, or allow it in System Settings → Privacy."
