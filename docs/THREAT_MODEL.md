# Threat Model

## Assets
- Flair client ID and client secret.
- Flair access token.
- Device, structure, room, and vent control surface.

## Threats
- Credential exfiltration via logs or source control.
- Unauthorized MCP access from untrusted hosts.
- Replay/abuse of write tools.
- Upstream API outages or throttling causing degraded behavior.

## Mitigations
- `.env` excluded from git.
- Tokens never printed in tool output.
- Host/origin checks at ingress.
- Write tools opt-in only.
- Retries with bounded backoff on transient upstream failures.
- Deep health endpoint for detection and alerting.

## Recommended Hardening
- Run behind authenticated reverse proxy.
- Network restrict endpoint to known client IPs.
- Enable centralized log shipping and anomaly alerts.
- Rotate credentials on a regular schedule.
