#!/usr/bin/env bash
set -euo pipefail

# Clawterm installer (macOS Apple Silicon only)
# Usage: curl -fsSL https://raw.githubusercontent.com/Axelj00/clawterm/main/install.sh | bash

REPO="Axelj00/clawterm"
APP_NAME="Clawterm"

info() { printf "\033[1;34m==>\033[0m %s\n" "$1"; }
error() { printf "\033[1;31merror:\033[0m %s\n" "$1" >&2; exit 1; }

OS="$(uname -s)"
ARCH="$(uname -m)"

[ "$OS" != "Darwin" ] && error "Clawterm only supports macOS. Detected OS: $OS"
[ "$ARCH" != "arm64" ] && error "Clawterm requires Apple Silicon (M-series). Detected arch: $ARCH"

# Fetch latest release tag
info "Fetching latest release..."
TAG=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | head -1 | cut -d'"' -f4)
[ -z "$TAG" ] && error "Could not determine latest release"
info "Latest release: ${TAG}"

ASSET="${APP_NAME}_${TAG#v}_aarch64.dmg"
URL="https://github.com/${REPO}/releases/download/${TAG}/${ASSET}"

TMPDIR_DL="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_DL"' EXIT

info "Downloading ${ASSET}..."
curl -fSL -o "${TMPDIR_DL}/${ASSET}" "$URL" || error "Download failed. Check that the release exists at:\n  ${URL}"

info "Mounting disk image..."
MOUNT_DIR=$(hdiutil attach "${TMPDIR_DL}/${ASSET}" -nobrowse -noautoopen | tail -1 | awk '{print $NF}')

if [ -d "/Applications/${APP_NAME}.app" ]; then
  info "Removing existing installation..."
  rm -rf "/Applications/${APP_NAME}.app"
fi

info "Installing to /Applications..."
cp -R "${MOUNT_DIR}/${APP_NAME}.app" /Applications/

hdiutil detach "$MOUNT_DIR" -quiet

info "Installed! You can open ${APP_NAME} from /Applications."
info ""
info "Note: On first launch, macOS may block the app."
info "If that happens: right-click the app → Open → Open"
info "Or: System Settings → Privacy & Security → Open Anyway"
