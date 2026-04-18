#!/usr/bin/env bash
# Poko macOS installer — downloads and installs without Gatekeeper issues.
# Usage: curl -sL <url>/install-mac.sh | bash
set -euo pipefail

APP_NAME="Poko"
DMG_URL="https://github.com/resplendentHSHI/Regrade/releases/download/latest-mac/Poko-mac.dmg"
INSTALL_DIR="/Applications"
TMP_DMG="/tmp/Poko-mac.dmg"
MOUNT_POINT="/tmp/poko-dmg-mount"

echo ""
echo "  ✿ Installing Poko…"
echo ""

# 1. Download
echo "  → Downloading Poko…"
curl -fSL --progress-bar -o "$TMP_DMG" "$DMG_URL"

# 2. Mount the DMG
echo "  → Mounting disk image…"
hdiutil attach "$TMP_DMG" -nobrowse -quiet -mountpoint "$MOUNT_POINT"

# 3. Copy .app to /Applications (remove old version if present)
echo "  → Installing to ${INSTALL_DIR}…"
if [ -d "${INSTALL_DIR}/${APP_NAME}.app" ]; then
  rm -rf "${INSTALL_DIR}/${APP_NAME}.app"
fi
cp -R "${MOUNT_POINT}/${APP_NAME}.app" "${INSTALL_DIR}/"

# 4. Unmount + cleanup
hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true
rm -f "$TMP_DMG"

# 5. Strip quarantine (curl doesn't set it, but just in case)
xattr -cr "${INSTALL_DIR}/${APP_NAME}.app" 2>/dev/null || true

echo ""
echo "  ✓ Poko installed to ${INSTALL_DIR}/${APP_NAME}.app"
echo ""
echo "  Opening Poko…"
open "${INSTALL_DIR}/${APP_NAME}.app"
echo ""
echo "  Done! If you see a security warning, go to"
echo "  System Settings → Privacy & Security → Open Anyway."
echo ""
