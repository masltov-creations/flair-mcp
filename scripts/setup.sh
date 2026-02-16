#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

log() { printf "[setup] %s\n" "$*"; }
warn() { printf "[setup] WARN: %s\n" "$*" >&2; }
fail() { printf "[setup] ERROR: %s\n" "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

is_no() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    n|no|0|false) return 0 ;;
    *) return 1 ;;
  esac
}

ensure_env() {
  if [ -f "$ROOT_DIR/.env" ]; then
    return
  fi
  if [ -f "$ROOT_DIR/.env.example" ]; then
    cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
    log "Created .env from .env.example"
    return
  fi
  fail "No .env or .env.example found"
}

read_env() {
  local key="$1"
  grep -E "^${key}=" "$ROOT_DIR/.env" | head -n1 | cut -d= -f2-
}

update_env() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key}=" "$ROOT_DIR/.env"; then
    sed -i "s#^${key}=.*#${key}=${value//\/\\}#" "$ROOT_DIR/.env"
  else
    printf "%s=%s\n" "$key" "$value" >> "$ROOT_DIR/.env"
  fi
}

set_default() {
  local key="$1"
  local value="$2"
  if ! grep -qE "^${key}=" "$ROOT_DIR/.env"; then
    update_env "$key" "$value"
  fi
}

configure_credentials() {
  local client_id client_secret
  client_id=$(read_env FLAIR_CLIENT_ID || true)
  client_secret=$(read_env FLAIR_CLIENT_SECRET || true)

  if [ -z "$client_id" ]; then
    read -rp "Flair Client ID: " client_id
  fi

  if [ -z "$client_secret" ]; then
    read -rp "Flair Client Secret: " client_secret
  fi

  [ -z "$client_id" ] && fail "FLAIR_CLIENT_ID is required"
  [ -z "$client_secret" ] && fail "FLAIR_CLIENT_SECRET is required"

  update_env FLAIR_CLIENT_ID "$client_id"
  update_env FLAIR_CLIENT_SECRET "$client_secret"
}

install_systemd_service() {
  require_cmd systemctl
  local node_bin
  node_bin=$(command -v node)

  local service_file=/etc/systemd/system/flair-mcp.service
  sudo tee "$service_file" >/dev/null <<SERVICE
[Unit]
Description=Flair MCP Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$ROOT_DIR
EnvironmentFile=$ROOT_DIR/.env
ExecStart=$node_bin dist/index.js
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
SERVICE

  sudo systemctl daemon-reload
  sudo systemctl enable --now flair-mcp.service
  sudo systemctl restart flair-mcp.service
  log "Systemd service installed: flair-mcp.service"
}

configure_mcporter() {
  if ! command -v npx >/dev/null 2>&1; then
    warn "npx not found; skipping mcporter setup"
    return
  fi

  local public_url port mcp_path base_url
  public_url=$(read_env PUBLIC_URL || true)
  port=$(read_env PORT || true)
  mcp_path=$(read_env MCP_HTTP_PATH || true)

  port=${port:-8090}
  mcp_path=${mcp_path:-/mcp}

  if [ -n "$public_url" ]; then
    base_url="$public_url"
  else
    base_url="http://localhost:$port"
  fi

  local endpoint="${base_url%/}${mcp_path}"
  if npx -y mcporter config add flair "$endpoint" --transport http --scope home >/tmp/flair-mcporter.log 2>&1; then
    log "Configured mcporter server flair -> $endpoint"
    npx -y mcporter list flair --schema >/dev/null 2>&1 || true
  else
    warn "mcporter config add failed"
    sed -n '1,12p' /tmp/flair-mcporter.log >&2 || true
  fi
}

main() {
  require_cmd node
  require_cmd npm

  ensure_env
  set_default PORT "8090"
  set_default MCP_HTTP_PATH "/mcp"
  set_default HEALTH_PATH "/healthz"
  set_default FLAIR_API_BASE_URL "https://api.flair.co"
  set_default FLAIR_API_ROOT_PATH "/api/"
  set_default FLAIR_TOKEN_PATH "/oauth/token"
  set_default FLAIR_REQUEST_TIMEOUT_MS "12000"
  set_default FLAIR_RETRY_MAX "2"
  set_default FLAIR_RETRY_BASE_MS "250"
  set_default FLAIR_TOKEN_SKEW_SEC "30"
  set_default ALLOWED_MCP_HOSTS "localhost,127.0.0.1"
  set_default WRITE_TOOLS_ENABLED "false"
  set_default LOG_LEVEL "info"

  configure_credentials

  cd "$ROOT_DIR"
  if [ -f package-lock.json ]; then
    npm ci
  else
    npm install
  fi
  npm run build

  INSTALL_SYSTEMD=${INSTALL_SYSTEMD:-}
  if [ -z "$INSTALL_SYSTEMD" ] && [ -t 0 ]; then
    read -rp "Install/refresh systemd service now? [Y/n]: " INSTALL_SYSTEMD
  fi
  INSTALL_SYSTEMD=${INSTALL_SYSTEMD:-y}
  if ! is_no "$INSTALL_SYSTEMD"; then
    install_systemd_service
  else
    log "Skipping systemd service setup"
  fi

  CONFIGURE_MCPORTER=${CONFIGURE_MCPORTER:-}
  if [ -z "$CONFIGURE_MCPORTER" ] && [ -t 0 ]; then
    read -rp "Configure mcporter entry (name: flair) now? [Y/n]: " CONFIGURE_MCPORTER
  fi
  CONFIGURE_MCPORTER=${CONFIGURE_MCPORTER:-y}
  if ! is_no "$CONFIGURE_MCPORTER"; then
    configure_mcporter
  else
    log "Skipping mcporter configuration"
  fi

  local port health_path
  port=$(read_env PORT || true)
  health_path=$(read_env HEALTH_PATH || true)
  port=${port:-8090}
  health_path=${health_path:-/healthz}

  log "Setup complete"
  log "Local health check: curl -sS http://localhost:${port}${health_path}?deep=1"
}

main "$@"
