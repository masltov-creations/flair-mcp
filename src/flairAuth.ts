import { z } from "zod";
import { config } from "./config.js";
import { logger } from "./logger.js";

type TokenRecord = {
  accessToken: string;
  tokenType: string;
  expiresAtMs: number;
  issuedAtMs: number;
};

const tokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().default("bearer"),
  expires_in: z.coerce.number().int().positive().optional()
});

export class FlairTokenManager {
  private token: TokenRecord | null = null;
  private inflight: Promise<TokenRecord> | null = null;

  constructor(private readonly skewSec: number) {}

  private tokenValid(nowMs = Date.now()) {
    if (!this.token) return false;
    return nowMs + this.skewSec * 1000 < this.token.expiresAtMs;
  }

  async getAccessToken(): Promise<string> {
    if (this.tokenValid()) {
      return this.token!.accessToken;
    }

    if (!this.inflight) {
      this.inflight = this.refreshToken();
    }

    try {
      const token = await this.inflight;
      return token.accessToken;
    } finally {
      this.inflight = null;
    }
  }

  getStatus() {
    const now = Date.now();
    return {
      hasToken: !!this.token,
      expiresAt: this.token ? new Date(this.token.expiresAtMs).toISOString() : undefined,
      secondsRemaining: this.token ? Math.max(0, Math.floor((this.token.expiresAtMs - now) / 1000)) : 0
    };
  }

  private async refreshToken(): Promise<TokenRecord> {
    const endpoint = new URL(config.flairTokenPath, `${config.flairApiBaseUrl}/`).toString();
    const body = new URLSearchParams({
      client_id: config.flairClientId,
      client_secret: config.flairClientSecret,
      grant_type: "client_credentials"
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body,
        signal: controller.signal
      });
    } catch (err) {
      throw new Error(`Flair token request failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    let json: unknown = undefined;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      // keep raw text only
    }

    if (!response.ok) {
      throw new Error(
        `Flair token request failed (${response.status}): ${typeof json === "object" ? JSON.stringify(json) : text}`
      );
    }

    const parsed = tokenSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(`Unexpected token response shape from Flair OAuth endpoint`);
    }

    const issuedAtMs = Date.now();
    const expiresInSec = parsed.data.expires_in ?? 3600;
    const expiresAtMs = issuedAtMs + expiresInSec * 1000;

    const token: TokenRecord = {
      accessToken: parsed.data.access_token,
      tokenType: parsed.data.token_type,
      expiresAtMs,
      issuedAtMs
    };

    this.token = token;
    logger.info(
      {
        tokenType: token.tokenType,
        expiresInSec
      },
      "Refreshed Flair access token"
    );

    return token;
  }
}
