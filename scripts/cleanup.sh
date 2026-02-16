#!/usr/bin/env bash
set -euo pipefail

log() { printf "[cleanup] %s\n" "$*"; }

if command -v systemctl >/dev/null 2>&1; then
  sudo systemctl disable --now flair-mcp.service >/dev/null 2>&1 || true
  sudo rm -f /etc/systemd/system/flair-mcp.service
  sudo systemctl daemon-reload || true
  log "Removed systemd service flair-mcp.service"
else
  log "systemctl not found; nothing to remove"
fi

log "Cleanup complete"
