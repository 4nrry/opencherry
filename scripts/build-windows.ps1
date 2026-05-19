# Build the OpenCherry desktop app as a Windows installer (.exe, NSIS).
#
# Produces a single, non-sandboxed installer suitable for local install on
# Windows. No signing, no store — just `tauri build`.
#
# Usage:   .\scripts\build-windows.ps1
# Output:  target\release\bundle\nsis\*-setup.exe  (Cargo workspace target dir)
#
# Requirements:
#   - Rust stable (rustup, MSVC toolchain)
#   - Node.js 20+ and pnpm 9+
#   - Microsoft Visual Studio C++ Build Tools (MSVC) — needed to link.
#   - WebView2 runtime (preinstalled on Windows 10/11).
# git2 builds with `vendored-libgit2`, so no system libgit2/OpenSSL is needed.

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path
Set-Location $repoRoot

Write-Host "==> Building OpenCherry Windows installer (release)..."
pnpm -C apps/desktop tauri build --bundles nsis

# This is a Cargo workspace, so the bundle lands in the workspace-root target\.
$nsisDir = Join-Path $repoRoot "target\release\bundle\nsis"
$installer = Get-ChildItem -Path $nsisDir -Filter "*-setup.exe" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if (-not $installer) {
    Write-Error "==> ERROR: no *-setup.exe found in $nsisDir"
    exit 1
}

Write-Host ""
Write-Host "==> Done. Installer built:"
Write-Host "    $($installer.FullName)"
Write-Host ""
Write-Host "    Install by double-clicking the installer, or run it from a shell."
