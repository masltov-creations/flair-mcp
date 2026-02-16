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
4. `list_vents` or `list_devices`
5. `get_resource` / `get_related_resources` for deeper inspection

## Safety Rules
- Treat all write tools as change-management actions.
- Run dry-run options before writes.
- Never expose client secrets or tokens in output.

## Troubleshooting
- `403 Host not allowed`: update `ALLOWED_MCP_HOSTS`.
- `401/403` upstream: verify Flair client credentials.
- Timeouts: increase client timeout and inspect `/healthz?deep=1`.
