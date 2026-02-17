# Flair MCP

*A politely paranoid bridge between AI tools and Flair.*

A practical MCP server for Flair with OAuth2 client-credentials auth, safe defaults, and setup automation that handles the operator plumbing.

This project is not affiliated with, endorsed by, or maintained by Flair.  
For official API onboarding: https://api.flair.co/

## Start Here (60 Seconds)

```bash
mkdir -p /home/$USER/apps && ( [ -d /home/$USER/apps/flair-mcp/.git ] && git -C /home/$USER/apps/flair-mcp pull --ff-only origin main || git clone https://github.com/masltov-creations/flair-mcp /home/$USER/apps/flair-mcp ) && cd /home/$USER/apps/flair-mcp && ./scripts/setup.sh
```

No browser OAuth step here. This server uses `client_credentials`.

## What Setup Handles For You

`./scripts/setup.sh` is the primary workflow and is safe to rerun.

It can:
- write/update `.env` defaults
- collect Flair API credentials
- configure read/write permission mode
- install dependencies and build
- optionally install/refresh systemd service
- optionally install `SKILL.md` for OpenClaw
- optionally configure and verify `mcporter`
- optionally register Flair as upstream in SmartThings gateway setup
- wait for health readiness and deep health verification

## What Setup Asks You For

- `FLAIR_CLIENT_ID`
- `FLAIR_CLIENT_SECRET`
- permission mode (`read` or `write`)
- optional systemd install
- optional OpenClaw skill install
- optional `mcporter` registration/verification
- optional SmartThings gateway integration

## Provider Access Checklist

1. Start at https://api.flair.co/
2. Follow official getting-started steps to obtain:
- `FLAIR_CLIENT_ID`
- `FLAIR_CLIENT_SECRET`
3. Run `./scripts/setup.sh` and provide credentials.
4. Verify with `/healthz?deep=1`.

## Quick Verify

```bash
curl -sS http://127.0.0.1:8090/healthz?deep=1
npx -y mcporter list flair --schema
```

If `ok: true` and `deep.ok: true`, the server is ready.

## Skill (For LLMs)

Use `SKILL.md` as the operator guide:
- tool routing
- progressive disclosure
- output formatting contract
- write-safety confirmation flow

Setup can install this automatically when OpenClaw is detected.

## Tool Highlights

### Read/query
- `health_check`
- `list_resource_types`
- `list_structures`
- `list_rooms`
- `list_vents`
- `list_devices`
- `list_named_devices`
- `list_room_temperatures`
- `list_device_room_temperatures`
- `list_vents_with_room_temperatures`
- `list_vents_by_room_temperature`
- `list_open_vents_in_cold_rooms` (convenience shortcut)
- `list_resources`
- `get_resource`
- `get_related_resources`

### Write/control (disabled by default)
- `update_resource_attributes`
- `create_resource`
- `set_vent_percent_open`
- `set_vent_percent_open_and_verify` (preferred: write + state verification)

Enable writes via setup (`FLAIR_PERMISSION_MODE=write`) or `WRITE_TOOLS_ENABLED=true`.

## Fast Query Examples

```bash
# Generic vent filter: open vents in rooms below 68F
npx -y mcporter call --server flair --tool list_vents_by_room_temperature --args '{"temperature_operator":"lt","threshold_temp_f":68,"vent_state":"open"}' --output json

# Generic vent filter: closed vents in rooms above 74F
npx -y mcporter call --server flair --tool list_vents_by_room_temperature --args '{"temperature_operator":"gt","threshold_temp_f":74,"vent_state":"closed"}' --output json

# Convenience shortcut
npx -y mcporter call --server flair --tool list_open_vents_in_cold_rooms --args '{"below_temp_f":68,"min_percent_open":1}' --output json

# Preferred write path: set vent and verify observed state in one call
npx -y mcporter call --server flair --tool set_vent_percent_open_and_verify --args '{"vent_id":"<vent-id>","percent_open":30}' --output json
```

`set_vent_percent_open_and_verify` is available only when write mode is enabled.

## OpenClaw + mcporter

Register server:

```bash
npx -y mcporter config add flair http://localhost:8090/mcp --allow-http --transport http --scope home
```

List tools:

```bash
npx -y mcporter list flair --schema
```

## Optional Integrations

If you run SmartThings MCP gateway separately, setup can add Flair as a named upstream there.

That integration is optional and only enabled when you choose it.

## Common Operations

Update runtime install and restart:

```bash
cd /home/$USER/apps/flair-mcp && git pull --ff-only origin main && npm run build && sudo systemctl restart flair-mcp
```

Switch to write mode:

```bash
cd /home/$USER/apps/flair-mcp && FLAIR_PERMISSION_MODE=write INSTALL_SYSTEMD=false INSTALL_OPENCLAW_SKILL=false CONFIGURE_MCPORTER=false INTEGRATE_SMARTTHINGS_GATEWAY=false ./scripts/setup.sh && sudo systemctl restart flair-mcp
```

Switch back to read-only:

```bash
cd /home/$USER/apps/flair-mcp && FLAIR_PERMISSION_MODE=read INSTALL_SYSTEMD=false INSTALL_OPENCLAW_SKILL=false CONFIGURE_MCPORTER=false INTEGRATE_SMARTTHINGS_GATEWAY=false ./scripts/setup.sh && sudo systemctl restart flair-mcp
```

Re-run setup safely:

```bash
cd /home/$USER/apps/flair-mcp && ./scripts/setup.sh
```

Install workspace skill manually:

```bash
install -Dm644 SKILL.md ~/.openclaw/workspace/skills/flair-mcp/SKILL.md
```

## Troubleshooting (Quick Hits)

- `deep.ok: false` with `invalid_client`
  Credentials are wrong. Re-run setup with `FORCE_REENTER_CREDS=true`.

- Service starts but tools look old
  Pull latest, rebuild, restart service, re-list tools.

- `Host not allowed`
  Update `ALLOWED_MCP_HOSTS` and restart.

- Names look generic
  Use `list_named_devices` instead of `list_devices`.

- Query is slow
  Use aggregate tools (`list_device_room_temperatures`, `list_vents_by_room_temperature`) with `room_id`, `structure_id`, `max_items`.

## Security Notes

- Keep secrets in `.env`, never in git.
- Tokens are never returned by tools.
- Host/origin checks are enforced.
- Agent layer should require explicit confirmation before write actions.

## Architecture (High Level)

```text
MCP client -> Flair MCP -> Flair API (api.flair.co)
                    |
          OAuth2 client_credentials token flow
```

## License

MIT
