#!/usr/bin/env bash
#
# Build the OpenCherry desktop app as a Debian package (.deb).
#
# Produces a single, non-sandboxed package suitable for local install on
# Ubuntu/Debian. No signing, no CI, no store — just `tauri build`.
#
# Usage:   ./scripts/build-deb.sh
# Output:  target/release/bundle/deb/*.deb  (Cargo workspace target dir)
#
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

echo "==> Building OpenCherry .deb (release)…"
pnpm -C apps/desktop tauri build --bundles deb

# This is a Cargo workspace, so the bundle lands in the workspace-root target/.
deb_dir="target/release/bundle/deb"
# Resolve the freshly built package by glob so version bumps don't break this.
deb_file="$(ls -t "$deb_dir"/*.deb 2>/dev/null | head -n 1 || true)"

if [[ -z "$deb_file" ]]; then
  echo "==> ERROR: no .deb found in $deb_dir" >&2
  exit 1
fi

echo
echo "==> Done. Package built:"
echo "    $repo_root/$deb_file"
echo
echo "    Install with:   sudo apt install \"$repo_root/$deb_file\""
echo "    Remove with:    sudo apt remove open-cherry"
