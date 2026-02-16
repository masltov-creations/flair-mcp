# Flair MCP

A standalone, security-focused MCP server for the Flair API (`api.flair.co`), designed for team use.

This project was built as a human + AI engineering collaboration.

## What You Get
- OAuth2 client-credentials token management with automatic refresh.
- Streamable HTTP MCP endpoint with session handling built for repeated `mcporter` calls.
- JSON:API-native tooling for resource discovery and control.
- Safe-by-default behavior: write tools are disabled unless explicitly enabled.
- Health endpoint with optional deep API verification.

## Core Endpoints
- MCP: `POST /mcp`
- Health: `GET /healthz`

Defaults:
- Port: `8090`
- MCP path: `/mcp`
- Health path: `/healthz`

## Supported MCP Tools
Read tools:
- `health_check`
- `list_resource_types`
- `list_structures`
- `list_rooms`
- `list_vents`
- `list_devices`
- `list_resources`
- `get_resource`
- `get_related_resources`

Optional write tools (disabled by default):
- `update_resource_attributes`
- `create_resource`
- `set_vent_percent_open`

Enable write tools by setting:
- `WRITE_TOOLS_ENABLED=true`

## Quick Start (WSL/Linux)
1. Clone the repo:
```bash
git clone https://github.com/masltov-creations/flair-mcp && cd flair-mcp
```

2. Create `.env` and add Flair credentials:
```bash
cp .env.example .env
```
Set:
- `FLAIR_CLIENT_ID`
- `FLAIR_CLIENT_SECRET`

3. Run setup:
```bash
./scripts/setup.sh
```

4. Validate health:
```bash
curl -sS "http://localhost:8090/healthz?deep=1"
```

## mcporter Usage
Register server:
```bash
npx -y mcporter config add flair http://localhost:8090/mcp --allow-http --transport http --scope home
```

List tools:
```bash
npx -y mcporter list flair --schema
```

Call examples:
```bash
npx -y mcporter call --server flair --tool list_structures --output json
npx -y mcporter call --server flair --tool list_devices --output json
npx -y mcporter call --server flair --tool list_rooms --args '{"structure_id":"<structure-id>"}' --output json
```

## Environment Variables
See `.env.example` for full list.

Most important:
- `FLAIR_CLIENT_ID`
- `FLAIR_CLIENT_SECRET`
- `FLAIR_API_BASE_URL` (default `https://api.flair.co`)
- `WRITE_TOOLS_ENABLED` (default `false`)
- `ALLOWED_MCP_HOSTS`
- `ALLOWED_MCP_ORIGINS`

## Team Sharing Checklist
1. Keep `.env` out of git (already ignored).
2. Use a dedicated OAuth client per environment (dev/staging/prod).
3. Keep write tools disabled for read-only consumers.
4. Restrict host/origin allowlists in `.env`.
5. Use a reverse proxy or tunnel with HTTPS for remote access.
6. Monitor `/healthz?deep=1` and logs.

## Security Notes
- Tokens are never returned by MCP tools.
- OAuth secrets are loaded from environment only.
- Non-2xx Flair responses are normalized and surfaced without secret leakage.
- Host allowlist enforcement is enabled by default.

See:
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/THREAT_MODEL.md`

## Development
```bash
npm install
npm run dev
```

Build:
```bash
npm run build
npm start
```

## License
MIT
