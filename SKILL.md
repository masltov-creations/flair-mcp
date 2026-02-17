---
name: flair-mcp
description: Operate Flair through MCP with fast tool routing, safety gates, and human-first output formatting.
---

# Flair MCP Operator

## Mission
Use Flair MCP tools to answer comfort/control questions quickly, clearly, and safely.

## Use This Skill When
- The user asks about structures, rooms, vents, pucks, thermostats, remote sensors, or device state.
- The user asks to compare room temperatures with vent state (for example: open vents in cold rooms).
- The user asks to change vent settings or other write operations.

## Required Preconditions
- MCP endpoint is reachable (`/mcp`).
- `GET /healthz?deep=1` reports `ok: true`.
- Flair credentials are valid (`deep.ok: true`).
- For OpenClaw, call through `mcporter`.

## Connection Checks (Run In Order)
1. Confirm server mapping:
```bash
npx -y mcporter config get flair --json
```
2. Confirm tools are reachable:
```bash
npx -y mcporter list flair --schema
```
3. Confirm API auth path:
```bash
curl -sS http://127.0.0.1:8090/healthz?deep=1
```

If checks fail, stop and return one concrete fix from Troubleshooting.

## Progressive Disclosure Model
1. L1 Answer: one-line direct answer.
2. L2 Summary: compact table/list with counts.
3. L3 Detail: selected rows with key IDs.
4. L4 Raw: full payload only when user asks.

Keep default responses L1+L2 unless the user explicitly requests deeper detail.

## Tool Router (Intent -> Tool)
- "What structures/rooms do I have?" -> `list_structures`, `list_rooms`
- "What vents exist?" -> `list_vents` or `list_named_devices` (`resource_types:["vents"]`)
- "What temperature is each room?" -> `list_room_temperatures`
- "What temperature is the room each device is in?" -> `list_device_room_temperatures`
- "Show vents with room temps" -> `list_vents_with_room_temperatures`
- "Filter vents by room temperature + state" -> `list_vents_by_room_temperature`
- "Get open vents in rooms colder than X" -> `list_open_vents_in_cold_rooms` (convenience shortcut)
- "Inspect this exact object" -> `get_resource` / `get_related_resources`
- "Set vent to X%" -> `set_vent_percent_open_and_verify` (preferred, confirmation required)

## Fast Paths (Use First)
- Temperature + devices question: `list_device_room_temperatures`
- Vent + room temperature question: `list_vents_with_room_temperatures`
- Any threshold/state vent filter: `list_vents_by_room_temperature`

Avoid multi-call fan-out when one aggregate tool can answer directly.

## Read Workflow
1. Start with aggregate tools.
2. Use name-bearing tools before raw resources.
3. Include IDs only where follow-up action is likely.
4. Only expose raw payload when asked.

## Write Workflow (Safety Gate)
Before any write (`set_vent_percent_open_and_verify`, `update_resource_attributes`, `create_resource`):
1. Echo target and planned change.
2. Request explicit confirmation.
3. Prefer `dry_run=true` first where available.
4. Execute and return a concise success/failure summary.

For vent state changes, prefer `set_vent_percent_open_and_verify` so the write and verification happen in one MCP call.

## Output Contract (Always)
1. Start with one direct sentence.
2. Then present a compact, scannable table/list.
3. Include trust counts:
- total items considered
- matched items
- unknown/missing values
4. Prefer names first, IDs in parentheses when needed.
5. Use explicit `unknown` for missing values.

Preferred row format for vent/temperature queries:
- `Vent | Room | Percent Open | Room Temp (F/C) | Notes`

## Output Examples

### Example: Open Vents In Cold Rooms
`Found 3 open vents in rooms colder than 68°F.`

| Vent | Room | Percent Open | Room Temp (F/C) | Notes |
|---|---|---:|---:|---|
| Hall Vent | Hall | 42% | 66.9 / 19.4 | matched threshold |
| Office Vent | Office | 18% | 67.2 / 19.6 | matched threshold |

### Example: Write Confirmation Prompt
`I can set "Office Vent" to 30% open (ventId: ...). Confirm and I will apply this now.`

## Troubleshooting
- `403 Host not allowed`
Update `ALLOWED_MCP_HOSTS` and restart.

- `401` / `invalid_client`
Verify Flair credentials in `.env`, rerun setup, restart service.

- Tool missing
Pull latest repo, rebuild, restart service, rerun `mcporter list flair --schema`.

- Timeout / slow response
Use aggregate tools first and constrain with `room_id`, `structure_id`, `max_items`.

- Names look generic
Use `list_named_devices` rather than `list_devices`.

## Security Rules
- Never print secrets/tokens.
- Never run write operations without explicit confirmation.
- Return only the minimum needed data for the user’s request.

## Style Note
A little wit is welcome. Keep it dry, brief, and never at the expense of clarity.
