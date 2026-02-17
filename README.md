# Flair MCP

*A politely paranoid bridge between AI tools and Flair.*

A standalone MCP server for the Flair API that gives agents clean, safe, structured access without turning every prompt into raw JSON:API archaeology.

This project is not affiliated with, endorsed by, or maintained by Flair.  
For official API onboarding and support, start at: https://api.flair.co/

## Start Here (60 Seconds)

```bash
mkdir -p /home/$USER/apps && ( [ -d /home/$USER/apps/flair-mcp/.git ] && git -C /home/$USER/apps/flair-mcp pull --ff-only origin main || git clone https://github.com/masltov-creations/flair-mcp /home/$USER/apps/flair-mcp ) && cd /home/$USER/apps/flair-mcp && ./scripts/setup.sh
```

Unlike browser OAuth flows, Flair here uses `client_credentials`.  
No browser dance required. No shrubbery required either.

## What Setup Handles For You

`./scripts/setup.sh` can do all of this:
- writes/updates `.env` from defaults
- prompts for Flair credentials
- prompts for permission mode (`read` or `write`)
- installs dependencies and builds
- optionally installs/refreshes systemd service
- optionally installs `SKILL.md` into OpenClaw locations
- optionally configures/verifies `mcporter`
- optionally integrates as an upstream into your SmartThings gateway setup
- waits for local/public health readiness and runs deep health checks

It is built to be idempotent. Re-run it whenever needed.

## What Setup Asks You For

- `FLAIR_CLIENT_ID`
- `FLAIR_CLIENT_SECRET`
- permission mode: `read` or `write`
- optional systemd install
- optional OpenClaw skill install
- optional `mcporter` registration/verification
- optional SmartThings-gateway integration

## Quick Verify

```bash
curl -sS http://127.0.0.1:8090/healthz?deep=1
npx -y mcporter list flair --schema
```

If `ok: true` and `deep.ok: true`, the server is ready.

## Skill (For LLMs)

Use `SKILL.md` as the operator guide for agents:
- tool routing
- progressive disclosure
- output formatting contract
- write-safety confirmation flow

Setup can install this skill for OpenClaw.

## Tool Highlights

### Read and query
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
- `list_vents_by_room_temperature` (generic state + threshold filtering)
- `list_open_vents_in_cold_rooms` (convenience shortcut)
- `list_resources`
- `get_resource`
- `get_related_resources`

### Write and control (disabled by default)
- `update_resource_attributes`
- `create_resource`
- `set_vent_percent_open`

Enable writes via setup (`FLAIR_PERMISSION_MODE=write`) or `WRITE_TOOLS_ENABLED=true`.

## Fast Query Examples

```bash
# Generic filter: open vents in rooms below 68F
npx -y mcporter call --server flair --tool list_vents_by_room_temperature --args '{"temperature_operator":"lt","threshold_temp_f":68,"vent_state":"open"}' --output json

# Generic filter: closed vents in rooms above 74F
npx -y mcporter call --server flair --tool list_vents_by_room_temperature --args '{"temperature_operator":"gt","threshold_temp_f":74,"vent_state":"closed"}' --output json

# Convenience shortcut for the common “cold room + open vent” case
npx -y mcporter call --server flair --tool list_open_vents_in_cold_rooms --args '{"below_temp_f":68,"min_percent_open":1}' --output json
```

## OpenClaw + mcporter

Register server:

```bash
npx -y mcporter config add flair http://localhost:8090/mcp --allow-http --transport http --scope home
```

List tools:

```bash
npx -y mcporter list flair --schema
```

Sample calls:

```bash
npx -y mcporter call --server flair --tool list_structures --output json
npx -y mcporter call --server flair --tool list_named_devices --output json
npx -y mcporter call --server flair --tool list_room_temperatures --output json
npx -y mcporter call --server flair --tool list_device_room_temperatures --output json
```

## Optional: Parallel SmartThings Gateway Integration

If your separate SmartThings MCP gateway repo is detected, setup can offer to register Flair as an upstream there.

That integration is optional and disabled unless you explicitly choose it.

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

Install skill manually (workspace):

```bash
install -Dm644 SKILL.md ~/.openclaw/workspace/skills/flair-mcp/SKILL.md
```

## Troubleshooting (Quick Hits)

- `deep.ok: false` with `invalid_client`
  Credentials are wrong. Re-run setup with `FORCE_REENTER_CREDS=true`.

- Service starts but tools look old
  Pull latest, rebuild, restart service, then re-list tools.

- `Host not allowed`
  Update `ALLOWED_MCP_HOSTS` and restart.

- Device names look generic
  Use `list_named_devices` instead of `list_devices`.

- Query is slow
  Use aggregate tools (`list_device_room_temperatures`, `list_vents_by_room_temperature`) and constrain with `room_id`, `structure_id`, `max_items`.

## Security Notes

- Secrets stay in environment variables.
- Tokens are never returned by tools.
- Host/origin checks are enforced.
- Write operations should always require explicit user confirmation in the agent layer.

## Architecture (High Level)

```text
MCP client -> Flair MCP -> Flair API (api.flair.co)
                    |
              OAuth2 client_credentials
```

## License

MIT
