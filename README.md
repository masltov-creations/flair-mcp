# Flair MCP

*A politely paranoid bridge between your AI tools and your Flair home data.*

Flair MCP is a standalone MCP server for the Flair API (`api.flair.co`).
It gives MCP-compatible clients (like `mcporter` and other MCP-enabled assistants) a safe, practical way to inspect and control Flair resources without handing raw API complexity to every tool call.

In short: this is the adapter plug. It speaks MCP on one side, Flair JSON:API on the other, and keeps both from spilling tea on the carpet.

*Note* This project is not affiliated with, endorsed by, or maintained by Flair in any way. For official support please see Flair (`api.flair.co`)!

## Start Here (60 Seconds)

What this is:
- A standalone MCP server for Flair.
- OAuth2 client-credentials (no browser login step).
- Read-safe by default, write tools optional.

Fast start:

```bash
mkdir -p /home/$USER/apps && ( [ -d /home/$USER/apps/flair-mcp/.git ] && git -C /home/$USER/apps/flair-mcp pull --ff-only origin main || git clone https://github.com/masltov-creations/flair-mcp /home/$USER/apps/flair-mcp ) && cd /home/$USER/apps/flair-mcp && bash ./scripts/setup.sh
```

What setup asks you for:
- Flair credentials (or it offers to reuse existing values).
- Permission mode: `read` or `write`.
- Optional extras (systemd, OpenClaw, mcporter, SmartThings gateway integration).

Quick verify:

```bash
curl -sS "http://127.0.0.1:8090/healthz?deep=1"
```

If `ok: true`, the bridge is up and the tea stayed in the cup.

---

## Why This Exists (Purpose of the Plug)

If you want an LLM or automation tool to work with Flair, you need four things:
1. A stable MCP endpoint your tools can call.
2. OAuth token handling that doesn’t require ritual sacrifice.
3. Guardrails so read access is easy and write access is deliberate.
4. Predictable, structured outputs suitable for repeated machine use.

Flair MCP provides exactly that: one server, one config target, and one place to enforce security and behavior.

---

## How It Works (Without Summoning Any Knights)

Flair MCP runs as an HTTP service and exposes two core endpoints:

- MCP endpoint: `POST /mcp`
- Health endpoint: `GET /healthz`

Default runtime values:
- Port: `8090`
- MCP path: `/mcp`
- Health path: `/healthz`

### Request flow
1. Your MCP client calls the server at `/mcp`.
2. The server validates request context and host/origin controls.
3. It acquires (or reuses) a Flair OAuth2 client-credentials token.
4. It calls Flair’s JSON:API endpoints.
5. It returns normalized MCP tool results (without leaking secrets).

### Safety model
- Read tools are available by default.
- Write tools are **off** by default.
- You must explicitly enable writes with `WRITE_TOOLS_ENABLED=true`.

So yes, by default this server is more “careful librarian” than “chaotic wizard.”

---

## What You Need to Make It Work

### Required
- Node.js + npm
- A Flair OAuth client with:
  - `FLAIR_CLIENT_ID`
  - `FLAIR_CLIENT_SECRET`

### Getting Flair API Access
For official onboarding and credentials, start at:
- https://api.flair.co/

Follow the getting-started instructions there to obtain your API access.

### Key environment variables
See `.env.example` for the complete list. Most important:

- `FLAIR_CLIENT_ID`
- `FLAIR_CLIENT_SECRET`
- `FLAIR_API_BASE_URL` (default `https://api.flair.co`)
- `FLAIR_TOKEN_PATH` (default `/oauth2/token`)
- `WRITE_TOOLS_ENABLED` (default `false`)
- `ALLOWED_MCP_HOSTS`
- `ALLOWED_MCP_ORIGINS`

---

## What It Enables You to Do

With Flair MCP connected, an MCP-capable assistant or tool can:

- Discover Flair resource types and IDs.
- Enumerate structures, rooms, vents, and devices.
- Fetch specific resources and relationships.
- Run health checks for both service liveness and optional deep Flair verification.
- Optionally perform controlled write operations (when explicitly enabled).

In practical terms, this means you can build assistants that answer things like:
- “Which rooms are in my structure?”
- “What vents are currently available?”
- “Set vent X to 40% open” *(only if writes are enabled)*

You get automation power with intent boundaries, rather than a free-range API free-for-all.

---

## Supported MCP Tools

### Read tools
- `health_check`
- `list_resource_types`
- `list_structures`
- `list_rooms`
- `list_vents`
- `list_devices` (mobile app devices; concise summary by default)
- `list_named_devices` (named HVAC/room devices across vents, pucks, thermostats, sensors)
- `list_resources`
- `get_resource`
- `get_related_resources`

### Optional write tools (disabled by default)
- `update_resource_attributes`
- `create_resource`
- `set_vent_percent_open`

Enable write tools with:

```bash
WRITE_TOOLS_ENABLED=true
```

---

## Quick Start (WSL/Linux)

Recommended layout (keeps source and runtime isolated):
- Source clone: your dev workspace (for edits/PRs)
- Runtime install: `/home/<you>/apps/flair-mcp` (for systemd + secrets)

Fast start (clone/update + setup in one command):

```bash
mkdir -p /home/$USER/apps && ( [ -d /home/$USER/apps/flair-mcp/.git ] && git -C /home/$USER/apps/flair-mcp pull --ff-only origin main || git clone https://github.com/masltov-creations/flair-mcp /home/$USER/apps/flair-mcp ) && cd /home/$USER/apps/flair-mcp && bash ./scripts/setup.sh
```

What setup will do automatically:
- create `.env` from `.env.example` if missing
- prompt for Flair credentials, or offer to reuse existing values
- prompt for permission mode (`read` or `write`)
- offer optional systemd/OpenClaw/mcporter/SmartThings integration steps
- run startup health checks

You can rerun the same command after partial/failed setup; it is designed to be idempotent.

Setup automation now includes:
- dependency install + build
- optional systemd service install/restart
- optional OpenClaw skill install (workspace + global path)
- optional `mcporter` register + verification
- optional SmartThings gateway upstream integration
- startup health wait + deep health probe
- permission switch (`read` or `write`) for MCP tool access

OAuth behavior you should expect:
- This is OAuth2 `client_credentials`.
- Setup does **not** open a browser auth URL.
- Token fetch/refresh is automatic once `FLAIR_CLIENT_ID` and `FLAIR_CLIENT_SECRET` are valid.

Parallel MCP integration (optional):
- The setup script can auto-detect your separate SmartThings MCP project
  (`https://github.com/masltov-creations/smartthings-mcp`) and offer to register Flair as a gateway upstream there.
- This is cross-project wiring, not part of Flair MCP core runtime.
- Default is off unless you explicitly enable it.

Verify service + upstream API health:

```bash
curl -sS "http://localhost:8090/healthz?deep=1"
```

---

Other setup automation flags:
- `INSTALL_SYSTEMD=true|false`
- `INSTALL_OPENCLAW_SKILL=true|false`
- `CONFIGURE_MCPORTER=true|false`
- `VERIFY_MCPORTER=true|false`
- `FORCE_REENTER_CREDS=true|false`
- `STARTUP_HEALTH_TIMEOUT_SEC=90`
- `FLAIR_PERMISSION_MODE=read|write` (maps to `WRITE_TOOLS_ENABLED`)
- `INTEGRATE_SMARTTHINGS_GATEWAY=true|false`
- `SMARTTHINGS_MCP_DIR=/home/<you>/apps/smartthings-mcp`
- `SMARTTHINGS_UPSTREAM_NAME=flair`
- `RESTART_SMARTTHINGS_SERVICE=true|false`

Setup switch examples:

```bash
# Read-only install (safe default)
FLAIR_PERMISSION_MODE=read INTEGRATE_SMARTTHINGS_GATEWAY=false bash ./scripts/setup.sh

# Enable write tools during setup
FLAIR_PERMISSION_MODE=write INTEGRATE_SMARTTHINGS_GATEWAY=false bash ./scripts/setup.sh
```

Change permission mode after setup:

```bash
# Turn write ON after setup
FLAIR_PERMISSION_MODE=write INSTALL_SYSTEMD=false INSTALL_OPENCLAW_SKILL=false CONFIGURE_MCPORTER=false INTEGRATE_SMARTTHINGS_GATEWAY=false bash ./scripts/setup.sh && sudo systemctl restart flair-mcp

# Turn write OFF after setup
FLAIR_PERMISSION_MODE=read INSTALL_SYSTEMD=false INSTALL_OPENCLAW_SKILL=false CONFIGURE_MCPORTER=false INTEGRATE_SMARTTHINGS_GATEWAY=false bash ./scripts/setup.sh && sudo systemctl restart flair-mcp
```

Quick check:

```bash
curl -sS http://127.0.0.1:8090/healthz | grep -o '"writeToolsEnabled":[^,}]*'
```

## Common Changes

Change to write mode:

```bash
cd /home/$USER/apps/flair-mcp && FLAIR_PERMISSION_MODE=write INSTALL_SYSTEMD=false INSTALL_OPENCLAW_SKILL=false CONFIGURE_MCPORTER=false INTEGRATE_SMARTTHINGS_GATEWAY=false bash ./scripts/setup.sh && sudo systemctl restart flair-mcp
```

Change back to read-only:

```bash
cd /home/$USER/apps/flair-mcp && FLAIR_PERMISSION_MODE=read INSTALL_SYSTEMD=false INSTALL_OPENCLAW_SKILL=false CONFIGURE_MCPORTER=false INTEGRATE_SMARTTHINGS_GATEWAY=false bash ./scripts/setup.sh && sudo systemctl restart flair-mcp
```

Re-run setup safely after partial/failed run:

```bash
cd /home/$USER/apps/flair-mcp && bash ./scripts/setup.sh
```

Safe default note:
- SmartThings gateway integration now defaults to **off** unless explicitly enabled.

Cleanup mode:

```bash
./scripts/setup.sh cleanup
```

## mcporter Usage

Register the server:

```bash
npx -y mcporter config add flair http://localhost:8090/mcp --allow-http --transport http --scope home
```

List available tools:

```bash
npx -y mcporter list flair --schema
```

Example calls:

```bash
npx -y mcporter call --server flair --tool list_structures --output json
npx -y mcporter call --server flair --tool list_devices --output json
npx -y mcporter call --server flair --tool list_named_devices --output json
npx -y mcporter call --server flair --tool list_named_devices --args '{"resource_types":["vents","pucks","thermostats","remote-sensors"],"max_items_per_type":100}' --output json
npx -y mcporter call --server flair --tool list_devices --args '{"max_items":50,"page_size":50}' --output json
npx -y mcporter call --server flair --tool list_devices --args '{"include_raw":true}' --output json
npx -y mcporter call --server flair --tool list_rooms --args '{"structure_id":"<structure-id>"}' --output json
```

`list_devices` returns mobile app devices tied to users/geofencing. Some may not have names in Flair's API.
`list_named_devices` is the preferred call when you want room/HVAC device names.

`list_devices` and `list_named_devices` return deduplicated summaries with `name_source` (`api` or `derived`); use `include_raw=true` when you need full JSON:API payloads.
Default fetch limits are `page_size=100` and `max_items=200`; tune `max_items`/`page_size` as needed.

## Troubleshooting Quick Hits

- `deep.ok: false` with `invalid_client`:
  Re-enter valid Flair credentials (`FORCE_REENTER_CREDS=true bash ./scripts/setup.sh`).
- `connection refused` right after restart:
  Wait 2-5 seconds and retry health check (startup race happens).
- `Host not allowed`:
  Update `ALLOWED_MCP_HOSTS` in `.env`, then restart `flair-mcp`.
- Device names still look generic:
  Use `list_named_devices` (preferred for vents/pucks/thermostats/sensors), not `list_devices` (mobile/geofencing devices).

## Keep Skill In Sync

When `SKILL.md` changes, re-install it into OpenClaw:

```bash
cd /home/$USER/apps/flair-mcp && INSTALL_OPENCLAW_SKILL=true INSTALL_SYSTEMD=false CONFIGURE_MCPORTER=false INTEGRATE_SMARTTHINGS_GATEWAY=false bash ./scripts/setup.sh
```

Quick status check:

```bash
cd /home/$USER/apps/flair-mcp && bash ./scripts/sync-skill.sh
```

---

## Security Notes

- OAuth secrets are loaded from environment only.
- Tokens are never returned by MCP tools.
- Non-2xx Flair responses are normalized and surfaced safely.
- Host allowlist enforcement is enabled by default.

Additional docs:
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/THREAT_MODEL.md`

---

## Development

```bash
npm install
npm run dev
```

Build and run:

```bash
npm run build
npm start
```

---

## License

MIT
