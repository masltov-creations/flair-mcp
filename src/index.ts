import crypto from "node:crypto";
import express, { Request, Response } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { FlairTokenManager } from "./flairAuth.js";
import { buildFlairStatus, FlairApiClient, normalizeFlairError } from "./flairApi.js";
import { createFlairMcpServer } from "./mcp.js";

type SessionState = {
  transport: StreamableHTTPServerTransport;
  server: ReturnType<typeof createFlairMcpServer>;
  createdAt: number;
  lastSeenAt: number;
};

const app = express();
app.set("trust proxy", true);

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);
app.use(
  pinoHttp({
    logger: logger as any
  })
);
app.use(
  express.json({
    limit: "1mb"
  })
);

const tokenManager = new FlairTokenManager(config.tokenSkewSec);
const flairApi = new FlairApiClient(tokenManager);

const sessions = new Map<string, SessionState>();
const sessionTtlMs = 30 * 60 * 1000;

const getSessionId = (headers: Request["headers"]) => {
  const value = headers["mcp-session-id"];
  if (Array.isArray(value)) return value[0];
  return typeof value === "string" ? value : undefined;
};

const allowedHosts = new Set(config.allowedHosts);
const allowedOrigins = new Set(config.allowedOrigins);

const isHostAllowed = (hostHeader?: string) => {
  if (!hostHeader) return false;
  const host = hostHeader.split(":")[0].toLowerCase();
  return allowedHosts.has(host);
};

const isOriginAllowed = (originHeader?: string) => {
  if (!originHeader) return true;
  if (allowedOrigins.size === 0) return true;
  try {
    const origin = new URL(originHeader);
    return allowedOrigins.has(origin.hostname.toLowerCase());
  } catch {
    return false;
  }
};

const closeSession = async (sessionId: string) => {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  try {
    await session.transport.close();
  } catch {
    // ignore
  }
  try {
    const maybeClosable = session.server as unknown as { close?: () => Promise<void> | void };
    if (typeof maybeClosable.close === "function") {
      await maybeClosable.close();
    }
  } catch {
    // ignore
  }
};

const cleanupStaleSessions = async () => {
  const cutoff = Date.now() - sessionTtlMs;
  for (const [sessionId, session] of sessions.entries()) {
    if (session.lastSeenAt < cutoff) {
      logger.info({ sessionId }, "Closing stale MCP session");
      await closeSession(sessionId);
    }
  }
};

setInterval(() => {
  cleanupStaleSessions().catch((err) => {
    logger.warn({ err }, "Failed to cleanup stale sessions");
  });
}, 5 * 60 * 1000);

app.get(config.healthPath, async (req, res) => {
  const deep = typeof req.query.deep === "string" && ["1", "true", "yes"].includes(req.query.deep.toLowerCase());

  let deepResult: unknown = undefined;
  let deepOk = true;

  if (deep) {
    try {
      const types = await flairApi.listResourceTypes();
      deepResult = {
        ok: true,
        resourceTypeCount: types.length
      };
    } catch (err) {
      deepOk = false;
      deepResult = {
        ok: false,
        error: normalizeFlairError(err)
      };
    }
  }

  const status = {
    ok: deep ? deepOk : true,
    service: "flair-mcp",
    version: "0.1.0",
    time: new Date().toISOString(),
    uptimeSec: Math.floor(process.uptime()),
    writeToolsEnabled: config.writeToolsEnabled,
    sessions: sessions.size,
    flair: buildFlairStatus(flairApi),
    ...(deep ? { deep: deepResult } : {})
  };

  res.status(status.ok ? 200 : 503).json(status);
});

app.all(config.mcpPath, async (req: Request, res: Response) => {
  if (!isHostAllowed(req.headers.host)) {
    return res.status(403).json({ error: "Host not allowed" });
  }

  if (!isOriginAllowed(req.headers.origin)) {
    return res.status(403).json({ error: "Origin not allowed" });
  }

  const sessionId = getSessionId(req.headers);
  let session = sessionId ? sessions.get(sessionId) : undefined;

  try {
    if (!session) {
      const isInit = req.method === "POST" && isInitializeRequest(req.body);
      if (sessionId || !isInit) {
        return res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: No valid session ID provided"
          },
          id: null
        });
      }

      const server = createFlairMcpServer(flairApi);
      const createdAt = Date.now();
      let initializedSessionId: string | undefined;

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => {
          initializedSessionId = id;
          sessions.set(id, {
            transport,
            server,
            createdAt,
            lastSeenAt: Date.now()
          });
        }
      });

      transport.onclose = () => {
        const id = initializedSessionId ?? transport.sessionId;
        if (id) {
          sessions.delete(id);
        }
      };

      await server.connect(transport);

      session = {
        transport,
        server,
        createdAt,
        lastSeenAt: Date.now()
      };
    }

    session.lastSeenAt = Date.now();

    if (req.method === "GET" || req.method === "DELETE") {
      await session.transport.handleRequest(req, res);
    } else {
      await session.transport.handleRequest(req, res, req.body);
    }
  } catch (err) {
    logger.error({ err, path: req.path, sessionId }, "MCP request failed");
    if (!res.headersSent) {
      res.status(500).json({ error: "MCP internal error" });
    }
  }
});

app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      mcpPath: config.mcpPath,
      healthPath: config.healthPath,
      writeToolsEnabled: config.writeToolsEnabled
    },
    "Flair MCP listening"
  );
});
