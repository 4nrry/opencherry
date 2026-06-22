# OpenCherry Task Runner

# Setup the project dependencies
setup:
    ./scripts/setup.sh

# Run the application in development mode
dev:
    pnpm -C apps/desktop tauri dev

# Run all tests (Rust and Frontend)
test: test-rust test-frontend

# Run Rust tests only
test-rust:
    cargo test --workspace

# Run Frontend tests only
test-frontend:
    pnpm -C apps/desktop test

# Run linting and formatting checks
check:
    cargo fmt --all -- --check
    cargo clippy --workspace --all-targets -- -D warnings
    pnpm -C apps/desktop build

# Build the production .deb package (Linux)
build-deb:
    ./scripts/build-deb.sh

# Build the production AppImage (Linux)
build-appimage:
    ./scripts/build-appimage.sh

# Build the production .dmg disk image (macOS)
build-macos:
    ./scripts/build-macos.sh

# Build the production .exe installer (Windows; run from PowerShell)
build-windows:
    pwsh ./scripts/build-windows.ps1

# List all available commands
list:
    @just --list
