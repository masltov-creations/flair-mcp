# Security

## Security Goals
- Keep Flair OAuth credentials and tokens confidential.
- Prevent accidental control actions by default.
- Restrict untrusted web origins and hosts.
- Provide transparent operational status without leaking secrets.

## Controls Implemented
- OAuth secrets loaded from environment only (`.env` is ignored by git).
- Access token cached in memory only; not persisted on disk.
- Write operations disabled by default.
- Host allowlist enforced for MCP endpoint.
- Optional origin allowlist support.
- Structured logs with no token output.

## Operational Guidance
- Use separate credentials per environment.
- Place behind HTTPS terminator (reverse proxy/tunnel) for remote usage.
- Keep `WRITE_TOOLS_ENABLED=false` unless explicitly needed.
- Pin trusted hosts and origins in `.env`.

## Residual Risks
- Compromised host runtime can access in-memory secrets.
- Overly broad Flair OAuth client permissions increase blast radius.
- Misconfigured external proxy can expose endpoint publicly.
