#!/bin/zsh
# Double-click this file in Finder to launch Kinetic Pro with zero manual setup!
cd "$(dirname "$0")"

echo "=== Kinetic Pro — Zero-Dependency Launcher ==="

# 1. Clear macOS Gatekeeper quarantine flag (added when downloading ZIPs from GitHub in Safari/Chrome)
#    and ensure native Apple Metal binaries are executable.
if [ -d "Kinetic Pro.app" ]; then
  xattr -cr "Kinetic Pro.app" 2>/dev/null || true
  chmod +x "Kinetic Pro.app/Contents/MacOS/SpineForge" "Kinetic Pro.app/Contents/MacOS/spineforge-metal-cli" 2>/dev/null || true
  echo "[OK] Launching Native Apple Metal 120Hz App: Kinetic Pro.app ..."
  open "Kinetic Pro.app"
fi

# 2. Optionally start the WebGL2 Studio if Node.js is available
export PATH="$HOME/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if command -v npm >/dev/null 2>&1; then
  if [ ! -d "node_modules" ]; then
    echo "[INFO] Installing Web Studio packages..."
    npm install --no-audit --no-fund
  fi
  if ! lsof -ti :3460 >/dev/null 2>&1; then
    echo "[OK] Starting WebGL2 Studio on http://localhost:3460 ..."
    nohup npm run dev >/tmp/kinetic-web-studio.log 2>&1 &
    sleep 2
  fi
  open "http://localhost:3460"
fi

echo "Done! Kinetic Pro is running."
