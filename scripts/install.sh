#!/bin/sh
#
# OpenCherry one-command installer (Linux, AppImage).
#
#   curl -fsSL https://raw.githubusercontent.com/4nrry/opencherry/main/scripts/install.sh | sh
#
# Downloads the latest OpenCherry AppImage for your architecture from GitHub
# Releases, verifies its SHA-256, installs it to ~/.local/bin, and adds a
# desktop menu entry. No root required. POSIX sh; needs curl or wget.
set -eu

REPO="4nrry/opencherry"
BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}"
DESKTOP_DIR="$DATA_DIR/applications"
ICON_DIR="$DATA_DIR/icons/hicolor/256x256/apps"
APPIMAGE="$BIN_DIR/opencherry.AppImage"

info() { printf '==> %s\n' "$1"; }
err()  { printf 'Error: %s\n' "$1" >&2; exit 1; }

[ "$(uname -s)" = "Linux" ] || err "this installer supports Linux only (use the .dmg on macOS, .exe on Windows)"

# Tauri names the AppImage with the Debian-style arch token (amd64), while
# uname reports x86_64 — match either so resolution is robust.
case "$(uname -m)" in
  x86_64|amd64)  ARCH="$(uname -m)"; arch_re='amd64|x86_64' ;;
  aarch64|arm64) ARCH="$(uname -m)"; arch_re='aarch64|arm64' ;;
  *) err "unsupported architecture: $(uname -m)" ;;
esac

if command -v curl >/dev/null 2>&1; then
  dl()  { curl -fsSL "$1"; }
  dlo() { curl -fsSL -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
  dl()  { wget -qO- "$1"; }
  dlo() { wget -qO "$2" "$1"; }
else
  err "need curl or wget"
fi

if command -v sha256sum >/dev/null 2>&1; then
  sha() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  sha() { echo ""; }
fi

info "Finding the latest OpenCherry release for $ARCH…"
urls=$(dl "https://api.github.com/repos/$REPO/releases/latest" | grep -o 'https://[^"]*' || true)
[ -n "$urls" ] || err "could not reach the GitHub API (rate-limited or offline?)"
app_url=$(printf '%s\n' "$urls" | grep -E '\.AppImage$' | grep -E "(${arch_re})" | head -n1 || true)
[ -n "$app_url" ] || err "no AppImage asset for $ARCH found in the latest release"
sum_url=$(printf '%s\n' "$urls" | grep -E '\.AppImage\.sha256$' | grep -E "(${arch_re})" | head -n1 || true)

tmp=$(mktemp -d) || err "mktemp failed"
trap 'rm -rf "$tmp"' EXIT INT TERM

info "Downloading $(basename "$app_url")…"
dlo "$app_url" "$tmp/opencherry.AppImage" || err "download failed"

if [ -n "$sum_url" ]; then
  expected=$(dl "$sum_url" | cut -d' ' -f1)
  actual=$(sha "$tmp/opencherry.AppImage")
  if [ -n "$expected" ] && [ -n "$actual" ]; then
    [ "$expected" = "$actual" ] || err "checksum mismatch (expected $expected, got $actual)"
    info "SHA-256 verified."
  else
    info "Warning: could not verify checksum (no sha256 tool available); continuing."
  fi
else
  info "Warning: no published checksum found; skipping verification."
fi

mkdir -p "$BIN_DIR" "$DESKTOP_DIR" "$ICON_DIR"
chmod +x "$tmp/opencherry.AppImage"
mv -f "$tmp/opencherry.AppImage" "$APPIMAGE"
ln -sf "$APPIMAGE" "$BIN_DIR/opencherry"
info "Installed to $APPIMAGE"

# Best-effort icon for menu integration. --appimage-extract needs no FUSE and
# unpacks into ./squashfs-root, so run it inside the temp dir.
icon="opencherry"
if ( cd "$tmp" && "$APPIMAGE" --appimage-extract >/dev/null 2>&1 ); then
  cand=$(ls "$tmp"/squashfs-root/opencherry.png 2>/dev/null | head -n1 || true)
  [ -n "$cand" ] || cand=$(ls -S "$tmp"/squashfs-root/*.png 2>/dev/null | head -n1 || true)
  if [ -n "$cand" ]; then
    cp "$cand" "$ICON_DIR/opencherry.png" && icon="$ICON_DIR/opencherry.png"
  fi
fi

cat > "$DESKTOP_DIR/opencherry.desktop" <<EOF
[Desktop Entry]
Name=OpenCherry
Comment=Multi-repo × multi-agent control tower for AI coding
Exec=$APPIMAGE
Icon=$icon
Terminal=false
Type=Application
Categories=Development;
StartupWMClass=opencherry
EOF
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true

# FUSE check (warn only — AppImages need libfuse2 at runtime).
if command -v ldconfig >/dev/null 2>&1; then
  if ! ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2'; then
    info "Note: AppImages need FUSE. If launch fails:"
    info "      Debian/Ubuntu: sudo apt install libfuse2"
    info "      or run: APPIMAGE_EXTRACT_AND_RUN=1 opencherry"
  fi
fi

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) info "Note: add $BIN_DIR to your PATH to launch 'opencherry' from a shell." ;;
esac

info "Done. Launch OpenCherry from your app menu, or run: opencherry"
