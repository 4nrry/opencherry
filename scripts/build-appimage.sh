#!/usr/bin/env bash
#
# Build the OpenCherry desktop app as an AppImage.
#
# Produces a single, self-contained, unsigned executable suitable for direct
# run or one-command install on Linux. No store, no signing — just `tauri build`.
#
# Usage:   ./scripts/build-appimage.sh
# Output:  target/release/bundle/appimage/*.AppImage  (Cargo workspace target dir)
#
# Requirements: same system dependencies and toolchain as the dev shell
# (libgtk-3-dev, libwebkit2gtk-4.1-dev, librsvg2-dev, patchelf, …), plus Rust
# stable and Node.js 20+/pnpm 9+. git2 builds with `vendored-libgit2`, so no
# system libgit2/OpenSSL is needed.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

echo "==> Building OpenCherry AppImage (release)…"
pnpm -C apps/desktop tauri build --bundles appimage

# This is a Cargo workspace, so the bundle lands in the workspace-root target/.
appimage_dir="target/release/bundle/appimage"
# Resolve the freshly built image by glob so version bumps don't break this.
appimage_file="$(ls -t "$appimage_dir"/*.AppImage 2>/dev/null | head -n 1 || true)"

if [[ -z "$appimage_file" ]]; then
  echo "==> ERROR: no .AppImage found in $appimage_dir" >&2
  exit 1
fi

chmod +x "$appimage_file"

echo
echo "==> Done. AppImage built:"
echo "    $repo_root/$appimage_file"
echo
echo "    Run it directly:   \"$repo_root/$appimage_file\""
echo "    AppImages need FUSE at runtime. If launch fails:"
echo "      sudo apt install libfuse2   (Debian/Ubuntu)"
echo "      or:  APPIMAGE_EXTRACT_AND_RUN=1 \"$repo_root/$appimage_file\""
