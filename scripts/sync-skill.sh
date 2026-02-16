#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SRC="$ROOT_DIR/SKILL.md"
WORKSPACE_TARGET="$HOME/.openclaw/workspace/skills/flair-mcp/SKILL.md"
GLOBAL_TARGET="/usr/lib/node_modules/openclaw/skills/flair-mcp/SKILL.md"

log() { printf "[skill-sync] %s\n" "$*"; }
warn() { printf "[skill-sync] WARN: %s\n" "$*" >&2; }
fail() { printf "[skill-sync] ERROR: %s\n" "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

sha256_of() {
  sha256sum "$1" | awk '{print $1}'
}

print_status() {
  local target="$1"
  if [ ! -f "$target" ]; then
    printf "missing\t%s\n" "$target"
    return
  fi

  local src_hash target_hash
  src_hash=$(sha256_of "$SRC")
  target_hash=$(sha256_of "$target")
  if [ "$src_hash" = "$target_hash" ]; then
    printf "in-sync\t%s\n" "$target"
  else
    printf "out-of-sync\t%s\n" "$target"
  fi
}

sync_workspace() {
  mkdir -p "$(dirname "$WORKSPACE_TARGET")"
  install -m 0644 "$SRC" "$WORKSPACE_TARGET"
  log "Workspace skill synced: $WORKSPACE_TARGET"
}

sync_global() {
  local global_dir
  global_dir=$(dirname "$GLOBAL_TARGET")
  if [ ! -d "$global_dir" ]; then
    warn "Global OpenClaw skills directory not found: $global_dir"
    return
  fi
  sudo install -Dm644 "$SRC" "$GLOBAL_TARGET"
  log "Global skill synced: $GLOBAL_TARGET"
}

require_cmd sha256sum

DO_SYNC_WORKSPACE=false
DO_SYNC_GLOBAL=false

while [ $# -gt 0 ]; do
  case "$1" in
    --sync-workspace)
      DO_SYNC_WORKSPACE=true
      ;;
    --sync-global)
      DO_SYNC_GLOBAL=true
      ;;
    --sync-all)
      DO_SYNC_WORKSPACE=true
      DO_SYNC_GLOBAL=true
      ;;
    -h|--help)
      cat <<'HELP'
Usage: ./scripts/sync-skill.sh [--sync-workspace] [--sync-global] [--sync-all]

Without flags, prints sync status for workspace/global OpenClaw skill copies.
HELP
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
  shift
done

if [ ! -f "$SRC" ]; then
  fail "Source SKILL.md not found at $SRC"
fi

if [ "$DO_SYNC_WORKSPACE" = true ]; then
  sync_workspace
fi

if [ "$DO_SYNC_GLOBAL" = true ]; then
  sync_global
fi

print_status "$WORKSPACE_TARGET"
print_status "$GLOBAL_TARGET"
