import { z } from "zod";
import { config } from "./config.js";
import type { ApiRootLink, JsonApiDocument, JsonApiResource } from "./flairTypes.js";
import { FlairTokenManager } from "./flairAuth.js";
import { logger } from "./logger.js";

const JSON_API = "application/vnd.api+json";
const apiRootLinksSchema = z.record(
  z.object({
    self: z.string(),
    type: z.string()
  })
);

export class FlairApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly details?: unknown,
    public readonly retryable = false
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const relationContainsId = (resource: JsonApiResource, relationshipName: string, id: string) => {
  const rel = resource.relationships?.[relationshipName];
  if (!rel?.data) return false;
  if (Array.isArray(rel.data)) {
    return rel.data.some((item) => item.id === id);
  }
  return rel.data?.id === id;
};

export class FlairApiClient {
  private apiRootCache: Record<string, ApiRootLink> | null = null;

  constructor(private readonly tokenManager: FlairTokenManager) {}

  getTokenStatus() {
    return this.tokenManager.getStatus();
  }

  getApiRootCacheStatus() {
    return {
      cached: !!this.apiRootCache,
      resourceTypes: this.apiRootCache ? Object.keys(this.apiRootCache).length : 0
    };
  }

  async getApiRootLinks(force = false): Promise<Record<string, ApiRootLink>> {
    if (!force && this.apiRootCache) {
      return this.apiRootCache;
    }

    const doc = await this.requestJsonApi("GET", config.flairApiRootPath, {
      auth: true,
      retryMax: config.retryMax
    });

    const linksValue = isObject(doc) ? doc.links : undefined;
    const parsed = apiRootLinksSchema.safeParse(linksValue);
    if (!parsed.success) {
      throw new FlairApiError("Flair API root links missing or invalid", undefined, parsed.error.flatten());
    }

    this.apiRootCache = parsed.data;
    return this.apiRootCache;
  }

  async listResourceTypes() {
    const links = await this.getApiRootLinks();
    return Object.entries(links)
      .map(([name, link]) => ({
        name,
        type: link.type,
        path: link.self
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async listResources(
    resourceType: string,
    options?: {
      pageNumber?: number;
      pageSize?: number;
      sort?: string;
      filters?: Record<string, string | number | boolean>;
      include?: string;
    }
  ) {
    const path = await this.resolveResourcePath(resourceType);
    const query = this.createResourceQuery(options);
    const doc = await this.requestJsonApi("GET", path, { query });

    const data = Array.isArray(doc.data) ? doc.data : doc.data ? [doc.data] : [];
    return {
      data,
      meta: doc.meta,
      links: doc.links,
      included: doc.included
    };
  }

  async getResource(resourceType: string, resourceId: string, include?: string) {
    const path = `${await this.resolveResourcePath(resourceType)}/${encodeURIComponent(resourceId)}`;
    const query = include ? ({ include } as Record<string, string>) : undefined;
    const doc = await this.requestJsonApi("GET", path, { query });
    return {
      data: doc.data,
      included: doc.included,
      links: doc.links,
      meta: doc.meta
    };
  }

  async getRelatedResources(
    resourceType: string,
    resourceId: string,
    relationship: string,
    options?: { pageNumber?: number; pageSize?: number; include?: string }
  ) {
    const resource = await this.getResource(resourceType, resourceId);
    const root = resource.data as JsonApiResource | null | undefined;

    let relatedPath: string | undefined;
    if (root?.relationships?.[relationship]?.links?.related) {
      relatedPath = root.relationships[relationship].links?.related;
    }
    if (!relatedPath) {
      relatedPath = `${await this.resolveResourcePath(resourceType)}/${encodeURIComponent(resourceId)}/${encodeURIComponent(
        relationship
      )}`;
    }

    const query: Record<string, string> = {};
    if (options?.pageNumber) query["page[number]"] = String(options.pageNumber);
    if (options?.pageSize) query["page[size]"] = String(options.pageSize);
    if (options?.include) query.include = options.include;

    const doc = await this.requestJsonApi("GET", relatedPath, {
      query: Object.keys(query).length > 0 ? query : undefined
    });

    const data = Array.isArray(doc.data) ? doc.data : doc.data ? [doc.data] : [];
    return {
      data,
      meta: doc.meta,
      links: doc.links,
      included: doc.included
    };
  }

  async updateResourceAttributes(resourceType: string, resourceId: string, attributes: Record<string, unknown>) {
    const path = `${await this.resolveResourcePath(resourceType)}/${encodeURIComponent(resourceId)}`;
    const payload = {
      data: {
        type: resourceType,
        id: resourceId,
        attributes
      }
    };

    return await this.requestJsonApi("PATCH", path, { body: payload });
  }

  async createResource(
    resourceType: string,
    attributes: Record<string, unknown>,
    relationships?: Record<string, unknown>
  ) {
    const path = await this.resolveResourcePath(resourceType);
    const payload: Record<string, unknown> = {
      data: {
        type: resourceType,
        attributes
      }
    };

    if (relationships && Object.keys(relationships).length > 0) {
      (payload.data as Record<string, unknown>).relationships = relationships;
    }

    return await this.requestJsonApi("POST", path, { body: payload });
  }

  async listStructures() {
    return this.listResources("structures");
  }

  async listRooms(structureId?: string) {
    const result = await this.listResources("rooms");
    if (!structureId) return result;
    return {
      ...result,
      data: result.data.filter((room) => relationContainsId(room, "structure", structureId))
    };
  }

  async listVents(roomId?: string) {
    const result = await this.listResources("vents");
    if (!roomId) return result;
    return {
      ...result,
      data: result.data.filter((vent) => relationContainsId(vent, "room", roomId))
    };
  }

  async listDevices(options?: { structureId?: string; roomId?: string; activeOnly?: boolean }) {
    const result = await this.listResources("devices");

    let filtered = result.data;
    if (options?.structureId) {
      filtered = filtered.filter((item) => relationContainsId(item, "structure", options.structureId!));
    }
    if (options?.roomId) {
      filtered = filtered.filter((item) => relationContainsId(item, "room", options.roomId!));
    }
    if (options?.activeOnly) {
      filtered = filtered.filter((item) => {
        const attrs = item.attributes ?? {};
        return attrs["active"] === true || attrs["is-active"] === true || attrs["online"] === true;
      });
    }

    return {
      ...result,
      data: filtered
    };
  }

  private createResourceQuery(options?: {
    pageNumber?: number;
    pageSize?: number;
    sort?: string;
    filters?: Record<string, string | number | boolean>;
    include?: string;
  }) {
    if (!options) return undefined;

    const query: Record<string, string> = {};
    if (options.pageNumber) query["page[number]"] = String(options.pageNumber);
    if (options.pageSize) query["page[size]"] = String(options.pageSize);
    if (options.sort) query.sort = options.sort;
    if (options.include) query.include = options.include;
    if (options.filters) {
      for (const [key, value] of Object.entries(options.filters)) {
        query[`filter[${key}]`] = String(value);
      }
    }

    return Object.keys(query).length > 0 ? query : undefined;
  }

  private async resolveResourcePath(resourceType: string): Promise<string> {
    const links = await this.getApiRootLinks();
    const entry = links[resourceType];
    if (entry?.self) {
      return entry.self;
    }
    return `${config.flairApiRootPath.replace(/\/$/, "")}/${encodeURIComponent(resourceType)}`;
  }

  private async requestJsonApi(
    method: string,
    path: string,
    options?: {
      auth?: boolean;
      query?: Record<string, string>;
      body?: Record<string, unknown>;
      retryMax?: number;
    }
  ): Promise<JsonApiDocument> {
    const auth = options?.auth ?? true;
    const retryMax = options?.retryMax ?? config.retryMax;

    let attempt = 0;
    while (true) {
      try {
        const response = await this.doRequest(method, path, {
          auth,
          query: options?.query,
          body: options?.body
        });

        if (response.ok) {
          return response.doc;
        }

        const retryable = response.statusCode === 429 || response.statusCode >= 500;
        if (retryable && attempt < retryMax) {
          attempt += 1;
          await sleep(this.backoffMs(attempt, response.retryAfterMs));
          continue;
        }

        throw new FlairApiError(
          `Flair API ${method} ${path} failed with status ${response.statusCode}`,
          response.statusCode,
          response.doc,
          retryable
        );
      } catch (err) {
        if (err instanceof FlairApiError) {
          throw err;
        }

        const retryable = true;
        if (attempt < retryMax) {
          attempt += 1;
          await sleep(this.backoffMs(attempt));
          continue;
        }

        throw new FlairApiError(
          `Flair API ${method} ${path} failed: ${err instanceof Error ? err.message : String(err)}`,
          undefined,
          undefined,
          retryable
        );
      }
    }
  }

  private backoffMs(attempt: number, retryAfterMs?: number) {
    if (retryAfterMs && retryAfterMs > 0) {
      return retryAfterMs;
    }
    const exp = config.retryBaseMs * Math.pow(2, attempt - 1);
    const jitter = Math.floor(Math.random() * 150);
    return exp + jitter;
  }

  private async doRequest(
    method: string,
    path: string,
    options: { auth: boolean; query?: Record<string, string>; body?: Record<string, unknown> }
  ) {
    const url = this.buildUrl(path, options.query);
    const headers: Record<string, string> = {
      Accept: JSON_API
    };

    if (options.body) {
      headers["Content-Type"] = "application/json";
    }

    if (options.auth) {
      const token = await this.tokenManager.getAccessToken();
      headers.Authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;

    const text = await response.text();
    let parsed: JsonApiDocument = {};
    if (text) {
      try {
        parsed = JSON.parse(text) as JsonApiDocument;
      } catch {
        parsed = { errors: [{ detail: text }] };
      }
    }

    return {
      ok: response.ok,
      statusCode: response.status,
      doc: parsed,
      retryAfterMs
    };
  }

  private buildUrl(path: string, query?: Record<string, string>) {
    const url = path.startsWith("http://") || path.startsWith("https://")
      ? new URL(path)
      : new URL(path.startsWith("/") ? path : `/${path}`, `${config.flairApiBaseUrl}/`);

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }

    return url.toString();
  }
}

export type FlairApiClientStatus = {
  token: ReturnType<FlairTokenManager["getStatus"]>;
  apiRootCache: {
    cached: boolean;
    resourceTypes: number;
  };
};

export const buildFlairStatus = (client: FlairApiClient): FlairApiClientStatus => ({
  token: client.getTokenStatus(),
  apiRootCache: client.getApiRootCacheStatus()
});

export const normalizeFlairError = (err: unknown) => {
  if (err instanceof FlairApiError) {
    return {
      message: err.message,
      statusCode: err.statusCode,
      details: err.details,
      retryable: err.retryable
    };
  }

  return {
    message: err instanceof Error ? err.message : String(err)
  };
};

export const toJsonOutput = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }]
});
