#!/usr/bin/env bash
set -euo pipefail

# Clawterm installer (macOS, Apple Silicon and Intel)
# Usage:
#   Install:    curl -fsSL https://raw.githubusercontent.com/clawterm/clawterm/main/install.sh | bash
#   Uninstall:  curl -fsSL https://raw.githubusercontent.com/clawterm/clawterm/main/install.sh | bash -s -- --uninstall

REPO="clawterm/clawterm"
APP_NAME="Clawterm"

info() { printf "\033[1;34m==>\033[0m %s\n" "$1"; }
warn() { printf "\033[1;33m==>\033[0m %s\n" "$1"; }
error() { printf "\033[1;31merror:\033[0m %s\n" "$1" >&2; exit 1; }

# ── Uninstall mode ──
if [ "${1:-}" = "--uninstall" ]; then
  info "Uninstalling Clawterm..."
  if [ -d "/Applications/${APP_NAME}.app" ]; then
    rm -rf "/Applications/${APP_NAME}.app"
    info "Removed /Applications/${APP_NAME}.app"
  else
    warn "App not found at /Applications/${APP_NAME}.app"
  fi
  CONFIG_DIR="${HOME}/.config/clawterm"
  if [ -d "$CONFIG_DIR" ]; then
    printf "Remove config at %s? [y/N] " "$CONFIG_DIR"
    read -r answer
    if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
      rm -rf "$CONFIG_DIR"
      info "Removed $CONFIG_DIR"
    else
      info "Config preserved at $CONFIG_DIR"
    fi
  fi
  info "Clawterm has been uninstalled."
  exit 0
fi

OS="$(uname -s)"
ARCH="$(uname -m)"

[ "$OS" != "Darwin" ] && error "This script is for macOS. For Windows, use install.ps1 or download from GitHub Releases."
if [ "$ARCH" = "arm64" ]; then
  ARCH_SUFFIX="aarch64"
elif [ "$ARCH" = "x86_64" ]; then
  ARCH_SUFFIX="x64"
else
  error "Unsupported architecture: $ARCH"
fi

# Fetch latest release tag
info "Fetching latest release..."
TAG=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | head -1 | cut -d'"' -f4)
[ -z "$TAG" ] && error "Could not determine latest release"
info "Latest release: ${TAG}"

# Check if already installed and up to date
if [ -d "/Applications/${APP_NAME}.app" ]; then
  INSTALLED=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "/Applications/${APP_NAME}.app/Contents/Info.plist" 2>/dev/null || echo "unknown")
  LATEST="${TAG#v}"
  if [ "$INSTALLED" = "$LATEST" ]; then
    info "Clawterm ${INSTALLED} is already installed and up to date."
    exit 0
  fi
  info "Updating Clawterm ${INSTALLED} → ${LATEST}..."
else
  info "Installing Clawterm ${TAG#v}..."
fi

ASSET="${APP_NAME}_${TAG#v}_${ARCH_SUFFIX}.dmg"
URL="https://github.com/${REPO}/releases/download/${TAG}/${ASSET}"

TMPDIR_DL="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_DL"' EXIT

info "Downloading ${ASSET}..."
curl -fSL -o "${TMPDIR_DL}/${ASSET}" "$URL" || error "Download failed. Check that the release exists at:\n  ${URL}"

# Verify checksum if SHA256SUMS.txt is available
SUMS_URL="https://github.com/${REPO}/releases/download/${TAG}/SHA256SUMS.txt"
if curl -fsSL -o "${TMPDIR_DL}/SHA256SUMS.txt" "$SUMS_URL" 2>/dev/null; then
  info "Verifying checksum..."
  EXPECTED=$(grep "${ASSET}" "${TMPDIR_DL}/SHA256SUMS.txt" | awk '{print $1}')
  if [ -n "$EXPECTED" ]; then
    ACTUAL=$(shasum -a 256 "${TMPDIR_DL}/${ASSET}" | awk '{print $1}')
    if [ "$EXPECTED" != "$ACTUAL" ]; then
      error "Checksum mismatch! Expected ${EXPECTED}, got ${ACTUAL}. Download may be corrupted."
    fi
    info "Checksum verified."
  else
    warn "Asset not found in SHA256SUMS.txt — skipping verification."
  fi
else
  warn "SHA256SUMS.txt not available — skipping checksum verification."
fi

info "Mounting disk image..."
MOUNT_DIR=$(hdiutil attach "${TMPDIR_DL}/${ASSET}" -nobrowse -noautoopen | tail -1 | awk '{print $NF}')

if [ -d "/Applications/${APP_NAME}.app" ]; then
  rm -rf "/Applications/${APP_NAME}.app"
fi

info "Copying to /Applications..."
cp -R "${MOUNT_DIR}/${APP_NAME}.app" /Applications/

hdiutil detach "$MOUNT_DIR" -quiet

# Clear quarantine so macOS doesn't block the unsigned app
xattr -cr "/Applications/${APP_NAME}.app" 2>/dev/null || true

info "Done! Clawterm ${TAG#v} is ready."
info "Open it from /Applications or run: open /Applications/${APP_NAME}.app"
