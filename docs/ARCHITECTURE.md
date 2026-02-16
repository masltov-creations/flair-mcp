# Architecture

## Components
- **HTTP Server (`src/index.ts`)**
  - Serves MCP streamable endpoint and health endpoint.
  - Enforces host/origin checks.
  - Manages per-session MCP transports.
- **MCP Tool Server (`src/mcp.ts`)**
  - Defines read and optional write tool contracts.
  - Maps MCP tools to Flair API operations.
- **Flair API Client (`src/flairApi.ts`)**
  - Handles JSON:API requests, retries, and query shaping.
  - Resolves resource paths from Flair API root links.
- **OAuth Token Manager (`src/flairAuth.ts`)**
  - Uses client-credentials flow.
  - Caches and refreshes access token before expiry.

## Request Flow
1. MCP client initializes a streamable HTTP session at `/mcp`.
2. Tool invocation reaches MCP server.
3. MCP server calls Flair API client.
4. Flair API client obtains/refreshes token if required.
5. Request is sent to Flair API (`api.flair.co`).
6. JSON:API response is returned through MCP tool output.

## Reliability Choices
- Retry with exponential backoff for transient network and 429/5xx responses.
- Session lifecycle tracking with stale session cleanup.
- Optional deep health check (`/healthz?deep=1`) validates API reachability and auth path.

## Safety Defaults
- Write tools are opt-in (`WRITE_TOOLS_ENABLED=false`).
- No secrets/tokens emitted by tools.
- Host allowlist enabled by default.
