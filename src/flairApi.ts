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

type VentPercentOpenVerificationResult = {
  ok: boolean;
  ventId: string;
  expectedPercentOpen: number;
  actualPercentOpen: number | null;
  attemptsUsed: number;
  durationMs: number;
  commandResponse: unknown;
  error: string | null;
};

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

const getRelationId = (resource: JsonApiResource, relationshipName: string) => {
  const rel = resource.relationships?.[relationshipName];
  if (!rel?.data) return undefined;
  if (Array.isArray(rel.data)) return rel.data[0]?.id;
  return rel.data.id;
};

const firstString = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
};

const toBool = (value: unknown) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
  }
  return undefined;
};

const toNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const toFahrenheit = (celsius: number) => (celsius * 9) / 5 + 32;

const extractNextLink = (doc: JsonApiDocument) => {
  const fromLinks = doc.links && typeof doc.links === "object" ? (doc.links as Record<string, unknown>).next : undefined;
  const fromMeta = doc.meta && typeof doc.meta === "object" ? (doc.meta as Record<string, unknown>).next : undefined;
  const nextValue = fromLinks ?? fromMeta;
  if (!nextValue) return undefined;
  if (typeof nextValue === "string" && nextValue.trim().length > 0) return nextValue.trim();
  if (typeof nextValue === "object" && nextValue !== null) {
    const href = (nextValue as Record<string, unknown>).href;
    if (typeof href === "string" && href.trim().length > 0) return href.trim();
  }
  return undefined;
};

const mergeIncludedResources = (base: JsonApiResource[] | undefined, incoming: JsonApiResource[] | undefined) => {
  if (!base?.length && !incoming?.length) return undefined;
  const map = new Map<string, JsonApiResource>();
  for (const item of base ?? []) {
    map.set(`${item.type}:${item.id}`, item);
  }
  for (const item of incoming ?? []) {
    map.set(`${item.type}:${item.id}`, item);
  }
  return Array.from(map.values());
};

const dedupeResourcesById = (resources: JsonApiResource[]) => {
  const seen = new Set<string>();
  const unique: JsonApiResource[] = [];
  let duplicates = 0;

  for (const item of resources) {
    if (seen.has(item.id)) {
      duplicates += 1;
      continue;
    }
    seen.add(item.id);
    unique.push(item);
  }

  return { unique, duplicates };
};

const resolveDeviceName = (resource: JsonApiResource) => {
  const attrs = resource.attributes ?? {};
  const explicit = firstString(attrs, ["name", "display-name", "display_name", "label", "title"]);
  if (explicit) return { name: explicit, source: "api" as const };

  const manufacturer = firstString(attrs, ["manufacturer", "brand", "device-brand-name"]);
  const model = firstString(attrs, ["model", "model-name", "model_name", "device-model"]);
  if (manufacturer || model) {
    return {
      name: [manufacturer, model].filter(Boolean).join(" "),
      source: "derived" as const
    };
  }

  return { name: `Device ${resource.id.slice(0, 8)}`, source: "derived" as const };
};

const withDeviceFallbackName = (resource: JsonApiResource): JsonApiResource => {
  const attrs = { ...(resource.attributes ?? {}) };
  const resolved = resolveDeviceName(resource);
  if (!firstString(attrs, ["name", "display-name", "display_name", "label", "title"])) {
    attrs.name = resolved.name;
  }
  return {
    ...resource,
    attributes: attrs
  };
};

const resolveResourceName = (resource: JsonApiResource, fallbackPrefix: string) => {
  const attrs = resource.attributes ?? {};
  const explicit = firstString(attrs, ["name", "display-name", "display_name", "label", "title"]);
  if (explicit) return { name: explicit, source: "api" as const };
  return { name: `${fallbackPrefix} ${resource.id.slice(0, 8)}`, source: "derived" as const };
};

const titleCase = (value: string) =>
  value
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const compactObject = <T extends Record<string, unknown>>(value: T) => {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v !== "undefined")) as T;
};

const SENSITIVE_KEY = /(?:^|[-_])(secret|token|password|passphrase|api[-_]?key|authorization)(?:$|[-_])/i;

const redactSensitive = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item));
  }

  if (typeof value === "object" && value !== null) {
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) {
        next[key] = "[REDACTED]";
      } else {
        next[key] = redactSensitive(item);
      }
    }
    return next;
  }

  return value;
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
      maxItems?: number;
    }
  ) {
    const path = await this.resolveResourcePath(resourceType);
    const query = this.createResourceQuery(options);
    const maxItems = options?.maxItems && options.maxItems > 0 ? options.maxItems : undefined;
    let doc = await this.requestJsonApi("GET", path, { query });

    let data = Array.isArray(doc.data) ? doc.data : doc.data ? [doc.data] : [];
    let included = doc.included;
    let pagesFetched = 1;
    const visitedNext = new Set<string>();
    let nextLink = extractNextLink(doc);

    while (nextLink && (!maxItems || data.length < maxItems)) {
      if (visitedNext.has(nextLink)) break;
      visitedNext.add(nextLink);

      const nextDoc = await this.requestJsonApi("GET", nextLink);
      const nextData = Array.isArray(nextDoc.data) ? nextDoc.data : nextDoc.data ? [nextDoc.data] : [];
      data = data.concat(nextData);
      included = mergeIncludedResources(included, nextDoc.included);
      doc = {
        ...doc,
        links: nextDoc.links ?? doc.links,
        meta: nextDoc.meta ?? doc.meta
      };
      pagesFetched += 1;
      if (pagesFetched >= 20) break;

      nextLink = extractNextLink(nextDoc);
    }

    if (maxItems && data.length > maxItems) {
      data = data.slice(0, maxItems);
    }

    return {
      data,
      meta: doc.meta,
      links: doc.links,
      included
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

  async setVentPercentOpen(ventId: string, percentOpen: number) {
    return this.createResource(
      "vent-states",
      {
        "percent-open": percentOpen
      },
      {
        vent: {
          data: {
            type: "vents",
            id: ventId
          }
        }
      }
    );
  }

  async setVentPercentOpenAndVerify(
    ventId: string,
    percentOpen: number,
    attempts: number,
    initialDelayMs: number,
    backoffMultiplier: number
  ): Promise<VentPercentOpenVerificationResult> {
    const startedAt = Date.now();
    const commandResponse = await this.setVentPercentOpen(ventId, percentOpen);

    let nextDelayMs = Math.max(0, Math.floor(initialDelayMs));
    let lastActualPercentOpen: number | null = null;
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      await sleep(nextDelayMs);
      nextDelayMs = Math.floor(nextDelayMs * backoffMultiplier);

      try {
        const vent = await this.getResource("vents", ventId);
        const resource = vent.data as JsonApiResource | null | undefined;
        const actualPercentOpen = resource ? toNumber(resource.attributes?.["percent-open"]) : undefined;

        if (typeof actualPercentOpen === "number") {
          lastActualPercentOpen = actualPercentOpen;
          if (actualPercentOpen === percentOpen) {
            return {
              ok: true,
              ventId,
              expectedPercentOpen: percentOpen,
              actualPercentOpen,
              attemptsUsed: attempt,
              durationMs: Date.now() - startedAt,
              commandResponse,
              error: null
            };
          }
        } else {
          lastActualPercentOpen = null;
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        logger.warn({ err, ventId, attempt }, "Failed to verify vent percent-open after write");
      }
    }

    return {
      ok: false,
      ventId,
      expectedPercentOpen: percentOpen,
      actualPercentOpen: lastActualPercentOpen,
      attemptsUsed: attempts,
      durationMs: Date.now() - startedAt,
      commandResponse,
      error: lastError ?? "Expected vent percent-open value was not observed after all verification attempts"
    };
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

  async listDevices(options?: {
    structureId?: string;
    roomId?: string;
    activeOnly?: boolean;
    pageSize?: number;
    maxItems?: number;
  }) {
    const result = await this.listResources("devices", {
      pageSize: options?.pageSize,
      maxItems: options?.maxItems
    });

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

    const { unique, duplicates } = dedupeResourcesById(filtered);
    const normalized = unique.map((item) => withDeviceFallbackName(item));
    const devices = unique.map((item) => {
      const attrs = item.attributes ?? {};
      const resolved = resolveDeviceName(item);
      return compactObject({
        id: item.id,
        type: item.type,
        name: resolved.name,
        name_source: resolved.source,
        structure_id: getRelationId(item, "structure"),
        room_id: getRelationId(item, "room"),
        active: toBool(attrs["active"] ?? attrs["is-active"]),
        online: toBool(attrs["online"] ?? attrs["is-online"]),
        manufacturer: firstString(attrs, ["manufacturer", "brand", "device-brand-name"]),
        model: firstString(attrs, ["model", "model-name", "model_name", "device-model"])
      });
    });

    return {
      ...result,
      data: unique,
      normalized_data: normalized,
      devices,
      summary: {
        count: devices.length,
        duplicatesRemoved: duplicates
      }
    };
  }

  async listNamedDevices(options?: {
    structureId?: string;
    roomId?: string;
    resourceTypes?: string[];
    pageSize?: number;
    maxItemsPerType?: number;
    includeRaw?: boolean;
  }) {
    const requestedTypes =
      options?.resourceTypes && options.resourceTypes.length > 0
        ? options.resourceTypes
        : ["vents", "pucks", "thermostats", "remote-sensors", "puck2s"];

    const pageSize = options?.pageSize ?? 100;
    const maxItemsPerType = options?.maxItemsPerType ?? 200;

    const devices: Array<Record<string, unknown>> = [];
    const byType: Record<string, { count: number; duplicatesRemoved: number }> = {};
    const rawByType: Record<string, JsonApiResource[]> = {};

    for (const type of requestedTypes) {
      const result = await this.listResources(type, {
        pageSize,
        maxItems: maxItemsPerType
      });

      let filtered = result.data;
      if (options?.structureId) {
        filtered = filtered.filter((item) => relationContainsId(item, "structure", options.structureId!));
      }
      if (options?.roomId) {
        filtered = filtered.filter((item) => relationContainsId(item, "room", options.roomId!));
      }

      const { unique, duplicates } = dedupeResourcesById(filtered);
      byType[type] = {
        count: unique.length,
        duplicatesRemoved: duplicates
      };

      if (options?.includeRaw) {
        rawByType[type] = unique;
      }

      for (const item of unique) {
        const attrs = item.attributes ?? {};
        const resolved = resolveResourceName(item, titleCase(type.replace(/s$/, "")));
        const percentOpen = type === "vents" ? toNumber(attrs["percent-open"]) : undefined;
        devices.push(
          compactObject({
            id: item.id,
            resource_type: type,
            name: resolved.name,
            name_source: resolved.source,
            structure_id: getRelationId(item, "structure"),
            room_id: getRelationId(item, "room"),
            active: toBool(attrs["active"] ?? attrs["is-active"]),
            online: toBool(attrs["online"] ?? attrs["is-online"]),
            percent_open: percentOpen,
            is_open: typeof percentOpen === "number" ? percentOpen > 0 : undefined
          })
        );
      }
    }

    devices.sort((a, b) => {
      const typeA = String(a.resource_type ?? "");
      const typeB = String(b.resource_type ?? "");
      if (typeA !== typeB) return typeA.localeCompare(typeB);
      const nameA = String(a.name ?? "");
      const nameB = String(b.name ?? "");
      return nameA.localeCompare(nameB);
    });

    return {
      devices,
      summary: {
        count: devices.length,
        by_type: byType
      },
      ...(options?.includeRaw ? { raw_by_type: rawByType } : {})
    };
  }

  async listRoomTemperatures(options?: {
    structureId?: string;
    roomId?: string;
    pageSize?: number;
    maxStatPages?: number;
    includeRoomsWithoutStats?: boolean;
  }) {
    const roomsResult = await this.listRooms(options?.structureId);
    let rooms = roomsResult.data;
    if (options?.roomId) {
      rooms = rooms.filter((room) => room.id === options.roomId);
    }

    const roomIds = new Set(rooms.map((room) => room.id));
    const statsByRoom = await this.getLatestRoomStatsByRoom(roomIds, {
      pageSize: options?.pageSize,
      maxPages: options?.maxStatPages
    });

    const includeRoomsWithoutStats = options?.includeRoomsWithoutStats ?? false;
    const rows = rooms
      .map((room) => {
        const roomAttrs = room.attributes ?? {};
        const stats = statsByRoom.get(room.id);
        const tempC = stats?.temperature_c;
        return compactObject({
          room_id: room.id,
          room_name: firstString(roomAttrs, ["name", "display-name", "display_name", "label"]) ?? `Room ${room.id.slice(0, 8)}`,
          structure_id: getRelationId(room, "structure"),
          temperature_c: tempC,
          temperature_f: typeof tempC === "number" ? toFahrenheit(tempC) : undefined,
          humidity: stats?.humidity,
          measured_at: stats?.measured_at
        });
      })
      .filter((row) => includeRoomsWithoutStats || typeof row.temperature_c === "number");

    rows.sort((a, b) => String(a.room_name ?? "").localeCompare(String(b.room_name ?? "")));

    return {
      rooms: rows,
      summary: {
        room_count: rows.length,
        with_temperature: rows.filter((row) => typeof row.temperature_c === "number").length
      }
    };
  }

  async listDeviceRoomTemperatures(options?: {
    structureId?: string;
    roomId?: string;
    resourceTypes?: string[];
    pageSize?: number;
    maxItemsPerType?: number;
    maxStatPages?: number;
    includeRaw?: boolean;
  }) {
    const named = await this.listNamedDevices({
      structureId: options?.structureId,
      roomId: options?.roomId,
      resourceTypes: options?.resourceTypes,
      pageSize: options?.pageSize,
      maxItemsPerType: options?.maxItemsPerType,
      includeRaw: options?.includeRaw
    });

    const roomsResult = await this.listRooms(options?.structureId);
    let rooms = roomsResult.data;
    if (options?.roomId) {
      rooms = rooms.filter((room) => room.id === options.roomId);
    }
    const roomNameById = new Map(
      rooms.map((room) => {
        const attrs = room.attributes ?? {};
        const roomName = firstString(attrs, ["name", "display-name", "display_name", "label"]) ?? `Room ${room.id.slice(0, 8)}`;
        return [room.id, roomName];
      })
    );

    const relevantRoomIds = new Set(
      named.devices
        .map((device) => (typeof device.room_id === "string" ? device.room_id : undefined))
        .filter((roomId): roomId is string => typeof roomId === "string" && roomId.length > 0)
    );

    const statsByRoom = await this.getLatestRoomStatsByRoom(relevantRoomIds, {
      pageSize: options?.pageSize,
      maxPages: options?.maxStatPages
    });

    const devices = named.devices.map((device) => {
      const roomId = typeof device.room_id === "string" ? device.room_id : undefined;
      const stats = roomId ? statsByRoom.get(roomId) : undefined;
      const tempC = stats?.temperature_c;
      return compactObject({
        ...device,
        room_name: roomId ? roomNameById.get(roomId) : undefined,
        room_temperature_c: tempC,
        room_temperature_f: typeof tempC === "number" ? toFahrenheit(tempC) : undefined,
        room_humidity: stats?.humidity,
        room_measured_at: stats?.measured_at
      });
    });

    return {
      devices,
      summary: {
        ...named.summary,
        with_room_temperature: devices.filter((device) => typeof device.room_temperature_c === "number").length
      },
      ...(options?.includeRaw && named.raw_by_type ? { raw_by_type: named.raw_by_type } : {})
    };
  }

  async listVentsWithRoomTemperatures(options?: {
    structureId?: string;
    roomId?: string;
    pageSize?: number;
    maxItems?: number;
    maxStatPages?: number;
    includeClosed?: boolean;
    includeRaw?: boolean;
  }) {
    const ventsResult = await this.listResources("vents", {
      pageSize: options?.pageSize,
      maxItems: options?.maxItems
    });

    let vents = ventsResult.data;
    if (options?.structureId) {
      vents = vents.filter((item) => relationContainsId(item, "structure", options.structureId!));
    }
    if (options?.roomId) {
      vents = vents.filter((item) => relationContainsId(item, "room", options.roomId!));
    }

    const { unique } = dedupeResourcesById(vents);

    const roomsResult = await this.listRooms(options?.structureId);
    let rooms = roomsResult.data;
    if (options?.roomId) {
      rooms = rooms.filter((room) => room.id === options.roomId);
    }

    const roomNameById = new Map<string, string>(
      rooms.map((room) => {
        const attrs = room.attributes ?? {};
        const roomName = firstString(attrs, ["name", "display-name", "display_name", "label"]) ?? `Room ${room.id.slice(0, 8)}`;
        return [room.id, roomName];
      })
    );

    const roomIds = new Set<string>(
      unique
        .map((item) => getRelationId(item, "room"))
        .filter((roomId): roomId is string => typeof roomId === "string" && roomId.length > 0)
    );
    const statsByRoom = await this.getLatestRoomStatsByRoom(roomIds, {
      pageSize: options?.pageSize,
      maxPages: options?.maxStatPages
    });

    const includeClosed = options?.includeClosed ?? true;
    const ventsWithTemps = unique
      .map((item) => {
        const attrs = item.attributes ?? {};
        const resolved = resolveResourceName(item, "Vent");
        const roomId = getRelationId(item, "room");
        const structureId = getRelationId(item, "structure");
        const percentOpen = toNumber(attrs["percent-open"]);
        const roomStats = roomId ? statsByRoom.get(roomId) : undefined;
        const tempC = roomStats?.temperature_c;

        return compactObject({
          id: item.id,
          name: resolved.name,
          name_source: resolved.source,
          structure_id: structureId,
          room_id: roomId,
          room_name: roomId ? roomNameById.get(roomId) : undefined,
          percent_open: percentOpen,
          is_open: typeof percentOpen === "number" ? percentOpen > 0 : undefined,
          room_temperature_c: tempC,
          room_temperature_f: typeof tempC === "number" ? toFahrenheit(tempC) : undefined,
          room_humidity: roomStats?.humidity,
          room_measured_at: roomStats?.measured_at
        });
      })
      .filter((item) => includeClosed || item.is_open === true)
      .sort((a, b) => {
        const roomA = String(a.room_name ?? a.room_id ?? "");
        const roomB = String(b.room_name ?? b.room_id ?? "");
        if (roomA !== roomB) return roomA.localeCompare(roomB);
        return String(a.name ?? "").localeCompare(String(b.name ?? ""));
      });

    return {
      vents: ventsWithTemps,
      summary: {
        vent_count: ventsWithTemps.length,
        open_vents: ventsWithTemps.filter((vent) => vent.is_open === true).length,
        with_room_temperature: ventsWithTemps.filter((vent) => typeof vent.room_temperature_c === "number").length
      },
      ...(options?.includeRaw ? { raw_vents: unique } : {})
    };
  }

  async listOpenVentsInColdRooms(options: {
    belowTempC?: number;
    belowTempF?: number;
    minPercentOpen?: number;
    structureId?: string;
    roomId?: string;
    pageSize?: number;
    maxItems?: number;
    maxStatPages?: number;
    includeRaw?: boolean;
  }) {
    return this.listVentsByRoomTemperature({
      structureId: options.structureId,
      roomId: options.roomId,
      temperatureOperator: "lt",
      thresholdTempC: options.belowTempC,
      thresholdTempF: options.belowTempF,
      ventState: "open",
      minPercentOpen: options.minPercentOpen,
      pageSize: options.pageSize,
      maxItems: options.maxItems,
      maxStatPages: options.maxStatPages,
      includeRaw: options.includeRaw
    });
  }

  async listVentsByRoomTemperature(options: {
    structureId?: string;
    roomId?: string;
    temperatureOperator?: "lt" | "lte" | "gt" | "gte" | "between";
    thresholdTempC?: number;
    thresholdTempF?: number;
    minTempC?: number;
    minTempF?: number;
    maxTempC?: number;
    maxTempF?: number;
    ventState?: "open" | "closed" | "any";
    minPercentOpen?: number;
    maxPercentOpen?: number;
    includeUnknownTemperature?: boolean;
    pageSize?: number;
    maxItems?: number;
    maxStatPages?: number;
    includeRaw?: boolean;
  }) {
    const toCelsius = (tempC?: number, tempF?: number) => {
      if (typeof tempC === "number") return tempC;
      if (typeof tempF === "number") return (tempF - 32) * (5 / 9);
      return undefined;
    };

    const operator = options.temperatureOperator ?? "lt";
    const thresholdC = toCelsius(options.thresholdTempC, options.thresholdTempF);
    let minTempC = toCelsius(options.minTempC, options.minTempF);
    let maxTempC = toCelsius(options.maxTempC, options.maxTempF);

    if (operator === "between") {
      if (typeof minTempC !== "number" || typeof maxTempC !== "number") {
        throw new FlairApiError("For temperature_operator=between, provide min_temp_c/min_temp_f and max_temp_c/max_temp_f");
      }
      if (minTempC > maxTempC) {
        const swap = minTempC;
        minTempC = maxTempC;
        maxTempC = swap;
      }
    } else if (typeof thresholdC !== "number") {
      throw new FlairApiError("Provide threshold_temp_c or threshold_temp_f for temperature filtering");
    }

    const ventState = options.ventState ?? "open";
    const minPercentOpen = typeof options.minPercentOpen === "number" ? options.minPercentOpen : (ventState === "open" ? 1 : 0);
    const maxPercentOpen = typeof options.maxPercentOpen === "number" ? options.maxPercentOpen : undefined;
    const includeUnknownTemperature = options.includeUnknownTemperature ?? false;

    const data = await this.listVentsWithRoomTemperatures({
      structureId: options.structureId,
      roomId: options.roomId,
      pageSize: options.pageSize,
      maxItems: options.maxItems,
      maxStatPages: options.maxStatPages,
      includeClosed: true,
      includeRaw: options.includeRaw
    });

    const matchesTemp = (tempC: number) => {
      if (operator === "between") {
        return tempC >= (minTempC as number) && tempC <= (maxTempC as number);
      }
      if (operator === "lt") return tempC < (thresholdC as number);
      if (operator === "lte") return tempC <= (thresholdC as number);
      if (operator === "gt") return tempC > (thresholdC as number);
      return tempC >= (thresholdC as number);
    };

    const vents = data.vents.filter((vent) => {
      const percentOpen = typeof vent.percent_open === "number" ? vent.percent_open : undefined;
      const isOpen = percentOpen !== undefined ? percentOpen > 0 : vent.is_open === true;

      if (ventState === "open" && isOpen !== true) return false;
      if (ventState === "closed" && isOpen !== false) return false;
      if (typeof percentOpen === "number") {
        if (percentOpen < minPercentOpen) return false;
        if (typeof maxPercentOpen === "number" && percentOpen > maxPercentOpen) return false;
      }

      const tempC = typeof vent.room_temperature_c === "number" ? vent.room_temperature_c : undefined;
      if (tempC === undefined) return includeUnknownTemperature;
      return matchesTemp(tempC);
    });

    return {
      vents,
      summary: compactObject({
        matched_vents: vents.length,
        temperature_operator: operator,
        threshold_c: typeof thresholdC === "number" ? Number(thresholdC.toFixed(2)) : undefined,
        threshold_f: typeof thresholdC === "number" ? Number(toFahrenheit(thresholdC).toFixed(2)) : undefined,
        min_temp_c: typeof minTempC === "number" ? Number(minTempC.toFixed(2)) : undefined,
        min_temp_f: typeof minTempC === "number" ? Number(toFahrenheit(minTempC).toFixed(2)) : undefined,
        max_temp_c: typeof maxTempC === "number" ? Number(maxTempC.toFixed(2)) : undefined,
        max_temp_f: typeof maxTempC === "number" ? Number(toFahrenheit(maxTempC).toFixed(2)) : undefined,
        vent_state: ventState,
        min_percent_open: minPercentOpen,
        max_percent_open: maxPercentOpen,
        include_unknown_temperature: includeUnknownTemperature
      }),
      ...(options.includeRaw ? { raw_vents: data.raw_vents } : {})
    };
  }

  private async getLatestRoomStatsByRoom(
    roomIds: Set<string>,
    options?: { pageSize?: number; maxPages?: number }
  ): Promise<Map<string, { temperature_c?: number; humidity?: number; measured_at?: string }>> {
    const path = await this.resolveResourcePath("room-stats");
    const pageSize = options?.pageSize ?? 200;
    const maxPages = options?.maxPages ?? 10;
    const statsByRoom = new Map<string, { temperature_c?: number; humidity?: number; measured_at?: string }>();

    for (let page = 1; page <= maxPages; page += 1) {
      const doc = await this.requestJsonApi("GET", path, {
        query: {
          "page[number]": String(page),
          "page[size]": String(pageSize),
          sort: "-created-at"
        }
      });

      const rows = Array.isArray(doc.data) ? doc.data : doc.data ? [doc.data] : [];
      for (const row of rows) {
        const attrs = row.attributes ?? {};
        const roomId = firstString(attrs, ["room-id"]) ?? getRelationId(row, "room");
        if (!roomId) continue;
        if (roomIds.size > 0 && !roomIds.has(roomId)) continue;
        if (statsByRoom.has(roomId)) continue;

        statsByRoom.set(roomId, {
          temperature_c: toNumber(attrs["temperature-c"]),
          humidity: toNumber(attrs.humidity),
          measured_at: firstString(attrs, ["created-at", "updated-at"])
        });
      }

      if (roomIds.size > 0 && statsByRoom.size >= roomIds.size) break;
      if (rows.length < pageSize) break;
      const next = extractNextLink(doc);
      if (!next) break;
    }

    return statsByRoom;
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
  content: [{ type: "text" as const, text: JSON.stringify(redactSensitive(data), null, 2) }]
});
