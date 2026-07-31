#!/bin/sh
# Retake installer. It downloads the latest release, copies two files, and
# stops. No daemons, no login items, nothing phones home. Read it first — it
# is short on purpose.
set -eu

REPO="tonhaoln/retake"
ASSET="retake-macos-arm64.tar.gz"
BIN_DIR="${BIN_DIR:-/usr/local/bin}"
APP_DIR="${APP_DIR:-$HOME/Applications/Retake}"

[ "$(uname -s)" = "Darwin" ] || {
  echo "The recorder is macOS-only. The editor is a plain HTML file and runs anywhere:"
  echo "  https://github.com/$REPO"
  exit 1
}
[ "$(uname -m)" = "arm64" ] || {
  echo "The release binary is Apple silicon only, and an Intel Mac would install it"
  echo "happily and then fail with 'bad CPU type in executable'."
  echo "Build it yourself instead (two minutes): https://github.com/$REPO#or-build-it-yourself"
  exit 1
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "→ Downloading the latest release"
curl -fsSL "https://github.com/$REPO/releases/latest/download/$ASSET" -o "$TMP/$ASSET"
tar -xzf "$TMP/$ASSET" -C "$TMP"

echo "→ Installing the recorder to $BIN_DIR (sudo may ask for your password)"
sudo mkdir -p "$BIN_DIR"
sudo cp "$TMP/retake" "$BIN_DIR/retake"
sudo chmod +x "$BIN_DIR/retake"

echo "→ Installing the editor to $APP_DIR"
mkdir -p "$APP_DIR"
cp "$TMP/retake-editor.html" "$APP_DIR/retake-editor.html"

cat <<EOF

Installed.

  Record   retake
  Edit     open "$APP_DIR/retake-editor.html" in Chrome

The first recording will ask for Screen Recording permission (and
Accessibility, which is what powers auto-zoom). Grant them to your terminal
app, then quit and reopen it once.
EOF
