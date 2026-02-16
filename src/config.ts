import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const emptyToUndefined = (value: unknown) => {
  if (typeof value === "string" && value.trim().length === 0) return undefined;
  return value;
};

const boolFromEnv = (value: string | undefined, defaultValue: boolean) => {
  if (typeof value === "undefined") return defaultValue;
  return ["1", "true", "yes", "y"].includes(value.toLowerCase());
};

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8090),
  PUBLIC_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  MCP_HTTP_PATH: z.string().default("/mcp"),
  HEALTH_PATH: z.string().default("/healthz"),

  FLAIR_CLIENT_ID: z.string().min(1),
  FLAIR_CLIENT_SECRET: z.string().min(1),
  FLAIR_API_BASE_URL: z.string().url().default("https://api.flair.co"),
  FLAIR_API_ROOT_PATH: z.string().default("/api/"),
  FLAIR_TOKEN_PATH: z.string().default("/oauth2/token"),

  FLAIR_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(12000),
  FLAIR_RETRY_MAX: z.coerce.number().int().min(0).max(8).default(2),
  FLAIR_RETRY_BASE_MS: z.coerce.number().int().positive().default(250),
  FLAIR_TOKEN_SKEW_SEC: z.coerce.number().int().min(0).default(30),

  ALLOWED_MCP_HOSTS: z.preprocess(emptyToUndefined, z.string().optional()),
  ALLOWED_MCP_ORIGINS: z.preprocess(emptyToUndefined, z.string().optional()),
  WRITE_TOOLS_ENABLED: z.preprocess(emptyToUndefined, z.string().optional()),

  LOG_LEVEL: z.string().default("info"),
  LOG_FILE: z.preprocess(emptyToUndefined, z.string().optional())
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

const publicHost = (() => {
  if (!env.PUBLIC_URL) return undefined;
  try {
    return new URL(env.PUBLIC_URL).hostname.toLowerCase();
  } catch {
    return undefined;
  }
})();

const splitCsv = (raw?: string) =>
  raw
    ? raw
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    : [];

const allowedHosts = splitCsv(env.ALLOWED_MCP_HOSTS).map((v) => v.toLowerCase());
if (publicHost && !allowedHosts.includes(publicHost)) {
  allowedHosts.push(publicHost);
}
if (!allowedHosts.includes("localhost")) {
  allowedHosts.push("localhost");
}
if (!allowedHosts.includes("127.0.0.1")) {
  allowedHosts.push("127.0.0.1");
}

export const config = {
  port: env.PORT,
  publicUrl: env.PUBLIC_URL,
  mcpPath: env.MCP_HTTP_PATH,
  healthPath: env.HEALTH_PATH,

  flairClientId: env.FLAIR_CLIENT_ID,
  flairClientSecret: env.FLAIR_CLIENT_SECRET,
  flairApiBaseUrl: env.FLAIR_API_BASE_URL.replace(/\/$/, ""),
  flairApiRootPath: env.FLAIR_API_ROOT_PATH,
  flairTokenPath: env.FLAIR_TOKEN_PATH,

  requestTimeoutMs: env.FLAIR_REQUEST_TIMEOUT_MS,
  retryMax: env.FLAIR_RETRY_MAX,
  retryBaseMs: env.FLAIR_RETRY_BASE_MS,
  tokenSkewSec: env.FLAIR_TOKEN_SKEW_SEC,

  allowedHosts,
  allowedOrigins: splitCsv(env.ALLOWED_MCP_ORIGINS).map((v) => v.toLowerCase()),
  writeToolsEnabled: boolFromEnv(env.WRITE_TOOLS_ENABLED, false),

  logLevel: env.LOG_LEVEL,
  logFile: env.LOG_FILE && env.LOG_FILE.trim().length > 0 ? env.LOG_FILE.trim() : undefined
};
