---
name: flair-mcp
description: Operate Flair API resources via MCP tools.
---

# Flair MCP Operator

## Purpose
Use Flair MCP safely to inspect structures/rooms/vents/devices and perform controlled updates when write tools are enabled.

## Prechecks
1. `GET /healthz?deep=1` returns `ok: true`.
2. `mcporter list flair --schema` succeeds.
3. Confirm if write tools are enabled before attempting control operations.

## Read-first Workflow
1. `list_resource_types`
2. `list_structures`
3. `list_rooms` (optionally filtered)
4. `list_named_devices` for human-friendly names (`vents`, `pucks`, `thermostats`, `remote-sensors`)
5. `list_devices` for mobile app/geofencing devices
6. `list_room_temperatures` for room-level current conditions
7. `list_device_room_temperatures` for “device -> room -> temperature” in one call
8. `get_resource` / `get_related_resources` for deeper inspection

## Safety Rules
- Treat all write tools as change-management actions.
- Confirm setup permission mode (`read` vs `write`) before requesting write tools.
- Run dry-run options before writes.
- Never expose client secrets or tokens in output.

## Troubleshooting
- `403 Host not allowed`: update `ALLOWED_MCP_HOSTS`.
- `401/403` upstream: verify Flair client credentials.
- Timeouts: increase client timeout and inspect `/healthz?deep=1`.
- If `list_devices` needs raw payloads, call with `{"include_raw": true}`.
- If device names are missing in `list_devices`, use `list_named_devices`.
- For “what temperature is each device room”, use `list_device_room_temperatures`.
- For faster responses, add `{"max_items": <n>, "page_size": <n>}`.
