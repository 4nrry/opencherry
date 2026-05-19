#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🍒 Starting OpenCherry setup...${NC}"

# 1. System Dependencies (Ubuntu/Debian)
if command -v apt-get &> /dev/null; then
    echo -e "${BLUE}Installing system dependencies...${NC}"
    sudo apt-get update
    sudo apt-get install -y \
        libwebkit2gtk-4.1-dev \
        libjavascriptcoregtk-4.1-dev \
        libsoup-3.0-dev \
        librsvg2-dev \
        libssl-dev \
        libayatana-appindicator3-dev \
        build-essential \
        curl \
        wget
else
    echo -e "${BLUE}Non-Debian system detected. Please ensure you have the required Tauri dependencies installed manually.${NC}"
fi

# 2. Rust Toolchain
if ! command -v cargo &> /dev/null; then
    echo -e "${BLUE}Installing Rust via rustup...${NC}"
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
else
    echo -e "${GREEN}Rust is already installed.${NC}"
fi

# 3. Node.js & pnpm
if ! command -v node &> /dev/null; then
    echo -e "${BLUE}Node.js not found. Please install Node.js 20+ manually.${NC}"
    exit 1
fi

if ! command -v pnpm &> /dev/null; then
    echo -e "${BLUE}Installing pnpm...${NC}"
    sudo npm install -g pnpm@9
else
    echo -e "${GREEN}pnpm is already installed.${NC}"
fi

# 4. Project Dependencies
echo -e "${BLUE}Installing project dependencies...${NC}"
pnpm -C apps/desktop install

echo -e "${GREEN}✅ OpenCherry setup complete!${NC}"
echo -e "You can now run the project with: ${BLUE}pnpm -C apps/desktop tauri dev${NC}"
echo -e "Or if you have 'just' installed, simply run: ${BLUE}just dev${NC}"
