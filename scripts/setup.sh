#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

log() { printf "[setup] %s\n" "$*"; }
warn() { printf "[setup] WARN: %s\n" "$*" >&2; }
fail() { printf "[setup] ERROR: %s\n" "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

is_wsl() {
  grep -qi microsoft /proc/sys/kernel/osrelease
}

is_no() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    n|no|0|false)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

require_wsl_systemd() {
  if ! is_wsl; then
    return
  fi

  if ! command -v systemctl >/dev/null 2>&1; then
    fail "systemctl not found. Enable systemd in WSL2 and restart WSL."
  fi

  if ! systemctl is-system-running >/dev/null 2>&1; then
    cat <<'MSG' >&2
[setup] systemd is not running in WSL2.
Enable by creating /etc/wsl.conf with:

[boot]
systemd=true

Then restart WSL.
MSG
    exit 1
  fi
}

escape_sed() {
  printf "%s" "$1" | sed -e 's/[\\&|]/\\&/g'
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
  if [ ! -f "$ROOT_DIR/.env" ]; then
    return
  fi
  grep -E "^${key}=" "$ROOT_DIR/.env" | head -n1 | cut -d= -f2-
}

read_env_file() {
  local file="$1"
  local key="$2"
  if [ ! -f "$file" ]; then
    return
  fi
  grep -E "^${key}=" "$file" | head -n1 | cut -d= -f2-
}

update_env() {
  local key="$1"
  local value="$2"
  local esc
  esc=$(escape_sed "$value")
  if grep -qE "^${key}=" "$ROOT_DIR/.env"; then
    sed -i "s|^${key}=.*|${key}=${esc}|" "$ROOT_DIR/.env"
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

set_default_if_blank() {
  local key="$1"
  local value="$2"
  local current
  current=$(read_env "$key" || true)
  if [ -z "${current// }" ]; then
    update_env "$key" "$value"
  fi
}

json_query() {
  local file="$1"
  local expr="$2"
  node - "$file" "$expr" <<'NODE'
const fs = require("fs");
const file = process.argv[2];
const expr = process.argv[3];
let data;
try {
  data = JSON.parse(fs.readFileSync(file, "utf8"));
} catch {
  process.exit(0);
}
const value = expr.split(".").reduce((acc, key) => {
  if (acc && Object.prototype.hasOwnProperty.call(acc, key)) return acc[key];
  return undefined;
}, data);
if (typeof value === "undefined" || value === null) process.exit(0);
if (typeof value === "object") {
  console.log(JSON.stringify(value));
} else {
  console.log(String(value));
}
NODE
}

wait_for_health() {
  local url="$1"
  local timeout_sec="$2"
  local output_file="$3"

  local start now
  start=$(date +%s)
  while true; do
    if curl -fsS --max-time 5 "$url" >"$output_file" 2>/dev/null; then
      return 0
    fi
    now=$(date +%s)
    if [ $((now - start)) -ge "$timeout_sec" ]; then
      return 1
    fi
    sleep 2
  done
}

report_health_summary() {
  local file="$1"
  local label="$2"

  local ok sessions deep_ok
  ok=$(json_query "$file" "ok" || true)
  sessions=$(json_query "$file" "sessions" || true)
  deep_ok=$(json_query "$file" "deep.ok" || true)

  local msg="$label health: ok=${ok:-unknown} sessions=${sessions:-unknown}"
  if [ -n "$deep_ok" ]; then
    msg="$msg deep.ok=$deep_ok"
  fi
  log "$msg"
}

install_openclaw_skill() {
  local workspace_skill_path="$HOME/.openclaw/workspace/skills/flair-mcp/SKILL.md"
  local global_skills_dir="/usr/lib/node_modules/openclaw/skills"
  local global_skill_path="$global_skills_dir/flair-mcp/SKILL.md"

  mkdir -p "$(dirname "$workspace_skill_path")"
  install -m 0644 "$ROOT_DIR/SKILL.md" "$workspace_skill_path"
  log "Installed SKILL.md to $workspace_skill_path"

  if [ -d "$global_skills_dir" ]; then
    if sudo install -Dm644 "$ROOT_DIR/SKILL.md" "$global_skill_path"; then
      log "Installed SKILL.md to $global_skill_path"
    else
      warn "Could not install SKILL.md to $global_skill_path"
    fi
  else
    log "Global OpenClaw skills directory not found; workspace install only"
  fi
}

configure_mcporter_server() {
  local server_name="$1"
  local endpoint="$2"
  local transport="$3"

  if ! command -v npx >/dev/null 2>&1; then
    warn "npx not found; skipping mcporter config"
    return 0
  fi

  local output
  output=$(mktemp)
  if npx -y mcporter config add "$server_name" "$endpoint" --transport "$transport" --scope home >"$output" 2>&1; then
    log "$(cat "$output")"
    rm -f "$output"
    return 0
  fi

  warn "mcporter config add failed"
  sed -n '1,20p' "$output" >&2 || true
  rm -f "$output"
  return 1
}

verify_mcporter_server() {
  local server_name="$1"
  local expected_endpoint="$2"

  if ! command -v npx >/dev/null 2>&1; then
    warn "npx not found; skipping mcporter verification"
    return 0
  fi

  local cfg
  cfg=$(mktemp)
  if ! npx -y mcporter config get "$server_name" --json >"$cfg" 2>/dev/null; then
    rm -f "$cfg"
    warn "mcporter verification failed: server '$server_name' not found"
    return 1
  fi

  local verify
  if ! verify=$(node - "$cfg" "$expected_endpoint" <<'NODE'
const fs = require("fs");
const path = process.argv[2];
const expected = process.argv[3];
const data = JSON.parse(fs.readFileSync(path, "utf8"));
const actual = typeof data.baseUrl === "string" ? data.baseUrl : "";
if (!actual) {
  console.error("mcporter baseUrl missing");
  process.exit(1);
}
if (actual !== expected) {
  console.error(`mcporter baseUrl mismatch: ${actual}`);
  process.exit(1);
}
console.log(`mcporter config verified: ${actual}`);
NODE
  ); then
    warn "$verify"
    rm -f "$cfg"
    return 1
  fi
  rm -f "$cfg"
  log "$verify"

  local schema_out
  schema_out=$(mktemp)
  if npx -y mcporter list "$server_name" --schema >"$schema_out" 2>&1; then
    log "mcporter tools/list check passed for '$server_name'"
  else
    warn "mcporter tools/list check returned warnings"
    sed -n '1,16p' "$schema_out" >&2 || true
  fi
  rm -f "$schema_out"
}

configure_credentials() {
  local client_id client_secret
  client_id=${FLAIR_CLIENT_ID:-}
  client_secret=${FLAIR_CLIENT_SECRET:-}

  if [ -z "$client_id" ]; then
    client_id=$(read_env FLAIR_CLIENT_ID || true)
  fi
  if [ -z "$client_secret" ]; then
    client_secret=$(read_env FLAIR_CLIENT_SECRET || true)
  fi

  FORCE_REENTER_CREDS=${FORCE_REENTER_CREDS:-}
  if [ -n "$client_id" ] && [ -n "$client_secret" ] && [ -z "$FORCE_REENTER_CREDS" ] && [ -t 0 ]; then
    local use_existing
    read -rp "Use existing Flair credentials from .env? [Y/n]: " use_existing
    use_existing=${use_existing:-y}
    if is_no "$use_existing"; then
      client_id=""
      client_secret=""
    fi
  fi

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
  log "Systemd service installed/refreshed: flair-mcp.service"
}

detect_smartthings_mcp_dir() {
  local explicit="${SMARTTHINGS_MCP_DIR:-}"
  if [ -n "$explicit" ] && [ -f "$explicit/scripts/manage-upstreams.sh" ] && [ -f "$explicit/.env" ]; then
    printf "%s" "$explicit"
    return
  fi

  local candidates=(
    "$HOME/apps/smartthings-mcp"
    "$HOME/apps/SmartThingsMCP"
    "$ROOT_DIR/../SmartThingsMCP"
    "$ROOT_DIR/../smartthings-mcp"
    "$HOME/SmartThingsMCP"
    "$HOME/smartthings-mcp"
  )

  local dir
  for dir in "${candidates[@]}"; do
    if [ -f "$dir/scripts/manage-upstreams.sh" ] && [ -f "$dir/.env" ]; then
      printf "%s" "$dir"
      return
    fi
  done
}

integrate_smartthings_gateway() {
  local st_dir="$1"
  local st_env="$st_dir/.env"
  local upstream_name="${SMARTTHINGS_UPSTREAM_NAME:-flair}"

  if [ ! -f "$st_env" ]; then
    warn "SmartThings .env not found at $st_env"
    return
  fi

  local gateway_enabled
  gateway_enabled=$(read_env_file "$st_env" MCP_GATEWAY_ENABLED || true)
  gateway_enabled=$(printf "%s" "$gateway_enabled" | tr '[:upper:]' '[:lower:]')
  if [ "$gateway_enabled" != "true" ] && [ "$gateway_enabled" != "1" ] && [ "$gateway_enabled" != "yes" ] && [ "$gateway_enabled" != "y" ]; then
    warn "SmartThings MCP gateway appears disabled (MCP_GATEWAY_ENABLED=${gateway_enabled:-unset})"
  fi

  local st_upstreams_path
  st_upstreams_path=$(read_env_file "$st_env" UPSTREAMS_CONFIG_PATH || true)
  if [ -z "$st_upstreams_path" ]; then
    st_upstreams_path="$st_dir/config/upstreams.json"
  elif [[ "$st_upstreams_path" != /* ]]; then
    st_upstreams_path="$st_dir/$st_upstreams_path"
  fi

  local flair_port flair_path flair_url
  flair_port=$(read_env PORT || true)
  flair_port=${flair_port:-8090}
  flair_path=$(read_env MCP_HTTP_PATH || true)
  flair_path=${flair_path:-/mcp}
  flair_url="http://localhost:${flair_port}${flair_path}"

  mkdir -p "$(dirname "$st_upstreams_path")"

  if node - "$st_upstreams_path" "$upstream_name" "$flair_url" <<'NODE'
const fs = require("fs");
const path = process.argv[2];
const name = process.argv[3];
const url = process.argv[4];

let doc = { upstreams: [] };
if (fs.existsSync(path)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path, "utf8"));
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.upstreams)) {
      doc = parsed;
    }
  } catch {
    console.error(`Invalid JSON in ${path}`);
    process.exit(1);
  }
}

const next = {
  name,
  url,
  description: "Local Flair MCP",
  enabled: true
};

const index = doc.upstreams.findIndex((u) => u && u.name === name);
if (index >= 0) {
  doc.upstreams[index] = { ...doc.upstreams[index], ...next };
} else {
  doc.upstreams.push(next);
}

fs.writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
console.log(`Upstream ${name} -> ${url} written to ${path}`);
NODE
  then
    log "Integrated Flair upstream into SmartThings config: $st_upstreams_path"
  else
    warn "Failed to update SmartThings upstream config"
    return
  fi

  local restart_value="${RESTART_SMARTTHINGS_SERVICE:-}"
  if [ -z "$restart_value" ] && [ -t 0 ]; then
    read -rp "Restart smartthings-mcp.service now? [y/N]: " restart_value
  fi
  restart_value=${restart_value:-n}

  if ! is_no "$restart_value"; then
    if command -v systemctl >/dev/null 2>&1; then
      if sudo systemctl restart smartthings-mcp.service; then
        log "Restarted smartthings-mcp.service"
      else
        warn "Could not restart smartthings-mcp.service"
      fi
    else
      warn "systemctl not found; restart smartthings-mcp.service manually"
    fi
  fi
}

if [ "${1:-}" = "cleanup" ] || [ "${1:-}" = "--cleanup" ]; then
  CLEANUP_SCRIPT="$ROOT_DIR/scripts/cleanup.sh"
  if [ ! -f "$CLEANUP_SCRIPT" ]; then
    fail "Cleanup script not found at $CLEANUP_SCRIPT"
  fi
  shift
  bash "$CLEANUP_SCRIPT" "$@"
  exit 0
fi

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
  set_default ALLOWED_MCP_ORIGINS ""
  set_default WRITE_TOOLS_ENABLED "false"
  set_default LOG_LEVEL "info"
  set_default LOG_FILE "$ROOT_DIR/data/flair-mcp.log"
  set_default_if_blank LOG_FILE "$ROOT_DIR/data/flair-mcp.log"

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
    require_wsl_systemd
    install_systemd_service
  else
    log "Skipping systemd service setup"
  fi

  INSTALL_OPENCLAW_SKILL=${INSTALL_OPENCLAW_SKILL:-}
  if [ -z "$INSTALL_OPENCLAW_SKILL" ] && [ -t 0 ]; then
    read -rp "Install SKILL.md into OpenClaw skill folders now? [Y/n]: " INSTALL_OPENCLAW_SKILL
  fi
  INSTALL_OPENCLAW_SKILL=${INSTALL_OPENCLAW_SKILL:-y}

  if ! is_no "$INSTALL_OPENCLAW_SKILL"; then
    install_openclaw_skill
  else
    log "Skipping OpenClaw skill installation"
  fi

  local port mcp_path public_url endpoint
  port=$(read_env PORT || true)
  mcp_path=$(read_env MCP_HTTP_PATH || true)
  public_url=$(read_env PUBLIC_URL || true)
  port=${port:-8090}
  mcp_path=${mcp_path:-/mcp}

  if [ -n "$public_url" ]; then
    endpoint="${public_url%/}${mcp_path}"
  else
    endpoint="http://localhost:${port}${mcp_path}"
  fi

  CONFIGURE_MCPORTER=${CONFIGURE_MCPORTER:-}
  if [ -z "$CONFIGURE_MCPORTER" ] && [ -t 0 ]; then
    read -rp "Configure mcporter entry (name: flair) now? [Y/n]: " CONFIGURE_MCPORTER
  fi
  CONFIGURE_MCPORTER=${CONFIGURE_MCPORTER:-y}

  if ! is_no "$CONFIGURE_MCPORTER"; then
    if configure_mcporter_server flair "$endpoint" http; then
      VERIFY_MCPORTER=${VERIFY_MCPORTER:-}
      if [ -z "$VERIFY_MCPORTER" ] && [ -t 0 ]; then
        read -rp "Verify mcporter config now? [Y/n]: " VERIFY_MCPORTER
      fi
      VERIFY_MCPORTER=${VERIFY_MCPORTER:-y}
      if ! is_no "$VERIFY_MCPORTER"; then
        verify_mcporter_server flair "$endpoint" || true
      fi
    fi
  else
    log "Skipping mcporter configuration"
  fi

  local smartthings_dir
  smartthings_dir=$(detect_smartthings_mcp_dir || true)
  if [ -n "$smartthings_dir" ]; then
    INTEGRATE_SMARTTHINGS_GATEWAY=${INTEGRATE_SMARTTHINGS_GATEWAY:-}
    if [ -z "$INTEGRATE_SMARTTHINGS_GATEWAY" ] && [ -t 0 ]; then
      read -rp "Detected SmartThings MCP at $smartthings_dir. Add/refresh Flair upstream there now? [y/N]: " INTEGRATE_SMARTTHINGS_GATEWAY
    fi
    INTEGRATE_SMARTTHINGS_GATEWAY=${INTEGRATE_SMARTTHINGS_GATEWAY:-n}
    if ! is_no "$INTEGRATE_SMARTTHINGS_GATEWAY"; then
      integrate_smartthings_gateway "$smartthings_dir"
    else
      log "Skipping SmartThings gateway integration"
    fi
  else
    log "No SmartThings MCP repo detected; skipping gateway integration"
  fi

  if command -v curl >/dev/null 2>&1; then
    STARTUP_HEALTH_TIMEOUT_SEC=${STARTUP_HEALTH_TIMEOUT_SEC:-90}
    local health_path local_health_url public_health_url
    health_path=$(read_env HEALTH_PATH || true)
    health_path=${health_path:-/healthz}
    local_health_url="http://127.0.0.1:${port}${health_path}"

    local local_health_file
    local_health_file=$(mktemp)
    log "Waiting for local health endpoint ($local_health_url)"
    if wait_for_health "$local_health_url" "$STARTUP_HEALTH_TIMEOUT_SEC" "$local_health_file"; then
      report_health_summary "$local_health_file" "Local"
      local deep_file
      deep_file=$(mktemp)
      if curl -fsS "${local_health_url}?deep=1" >"$deep_file" 2>/dev/null; then
        report_health_summary "$deep_file" "Local(deep)"
      else
        warn "Deep health check failed at ${local_health_url}?deep=1"
      fi
      rm -f "$deep_file"
    else
      warn "Local health did not become ready within ${STARTUP_HEALTH_TIMEOUT_SEC}s"
    fi
    rm -f "$local_health_file"

    if [ -n "$public_url" ]; then
      public_health_url="${public_url%/}${health_path}"
      local public_health_file
      public_health_file=$(mktemp)
      log "Waiting for public health endpoint ($public_health_url)"
      if wait_for_health "$public_health_url" "$STARTUP_HEALTH_TIMEOUT_SEC" "$public_health_file"; then
        report_health_summary "$public_health_file" "Public"
      else
        warn "Public health did not become ready within ${STARTUP_HEALTH_TIMEOUT_SEC}s"
      fi
      rm -f "$public_health_file"
    fi
  else
    warn "curl not found; skipping health verification"
  fi

  log "Setup complete"
  log "OAuth mode: client_credentials (no browser auth URL; token refresh is automatic)"
  log "Local health: curl -sS http://127.0.0.1:${port}$(read_env HEALTH_PATH || true)?deep=1"
}

main "$@"
