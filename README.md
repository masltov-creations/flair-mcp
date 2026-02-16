# Flair MCP

*A politely paranoid bridge between your AI tools and your Flair home data.*

Flair MCP is a standalone MCP server for the Flair API (`api.flair.co`).
It gives MCP-compatible clients (like `mcporter` and other MCP-enabled assistants) a safe, practical way to inspect and control Flair resources without handing raw API complexity to every tool call.

In short: this is the adapter plug. It speaks MCP on one side, Flair JSON:API on the other, and keeps both from spilling tea on the carpet.

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

### Strongly recommended
- Restrictive host/origin allowlists
- Separate OAuth clients per environment (dev/staging/prod)
- HTTPS via reverse proxy/tunnel if accessed remotely

### Key environment variables
See `.env.example` for the complete list. Most important:

- `FLAIR_CLIENT_ID`
- `FLAIR_CLIENT_SECRET`
- `FLAIR_API_BASE_URL` (default `https://api.flair.co`)
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
- `list_devices`
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

1. Clone the repository:

```bash
git clone https://github.com/masltov-creations/flair-mcp /home/$USER/apps/flair-mcp
cd /home/$USER/apps/flair-mcp
```

2. Create your environment file:

```bash
cp .env.example .env
```

3. Set required credentials in `.env`:

- `FLAIR_CLIENT_ID`
- `FLAIR_CLIENT_SECRET`

4. Run setup:

```bash
./scripts/setup.sh
```
Setup automation now includes:
- dependency install + build
- optional systemd service install/restart
- optional OpenClaw skill install (workspace + global path)
- optional `mcporter` register + verification
- optional SmartThings gateway upstream integration
- startup health wait + deep health probe

OAuth behavior you should expect:
- This is OAuth2 `client_credentials`.
- Setup does **not** open a browser auth URL.
- Token fetch/refresh is automatic once `FLAIR_CLIENT_ID` and `FLAIR_CLIENT_SECRET` are valid.

The setup script can auto-detect your existing SmartThings MCP
(`https://github.com/masltov-creations/smartthings-mcp`) repo and offer to
register Flair as a gateway upstream.

5. Verify service + upstream API health:

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
- `INTEGRATE_SMARTTHINGS_GATEWAY=true|false`
- `SMARTTHINGS_MCP_DIR=/home/<you>/apps/smartthings-mcp`
- `SMARTTHINGS_UPSTREAM_NAME=flair`
- `RESTART_SMARTTHINGS_SERVICE=true|false`

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
npx -y mcporter call --server flair --tool list_rooms --args '{"structure_id":"<structure-id>"}' --output json
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
