import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "./config.js";
import { buildFlairStatus, FlairApiClient, normalizeFlairError, toJsonOutput } from "./flairApi.js";

const id = z.string().min(1).max(128);
const resourceType = z.string().min(1).max(64);

const listResourcesSchema = {
  resource_type: resourceType,
  page_number: z.number().int().positive().optional(),
  page_size: z.number().int().positive().max(500).optional(),
  max_items: z.number().int().positive().max(5000).optional(),
  sort: z.string().optional(),
  include: z.string().optional(),
  filters: z.record(z.union([z.string(), z.number(), z.boolean()])).optional()
};

const getResourceSchema = {
  resource_type: resourceType,
  resource_id: id,
  include: z.string().optional()
};

const getRelatedSchema = {
  resource_type: resourceType,
  resource_id: id,
  relationship: z.string().min(1).max(96),
  page_number: z.number().int().positive().optional(),
  page_size: z.number().int().positive().max(500).optional(),
  include: z.string().optional()
};

const listRoomsSchema = {
  structure_id: id.optional()
};

const listVentsSchema = {
  room_id: id.optional()
};

const listDevicesSchema = {
  structure_id: id.optional(),
  room_id: id.optional(),
  active_only: z.boolean().optional().default(false),
  page_size: z.number().int().positive().max(500).optional().default(100),
  max_items: z.number().int().positive().max(5000).optional().default(200),
  include_raw: z.boolean().optional().default(false)
};

const namedDeviceType = z.enum(["vents", "pucks", "puck2s", "thermostats", "remote-sensors", "devices"]);
const listNamedDevicesSchema = {
  structure_id: id.optional(),
  room_id: id.optional(),
  resource_types: z.array(namedDeviceType).optional(),
  page_size: z.number().int().positive().max(500).optional().default(100),
  max_items_per_type: z.number().int().positive().max(5000).optional().default(200),
  include_raw: z.boolean().optional().default(false)
};

const listRoomTemperaturesSchema = {
  structure_id: id.optional(),
  room_id: id.optional(),
  page_size: z.number().int().positive().max(500).optional().default(200),
  max_stat_pages: z.number().int().positive().max(30).optional().default(10),
  include_rooms_without_stats: z.boolean().optional().default(false)
};

const listDeviceRoomTemperaturesSchema = {
  structure_id: id.optional(),
  room_id: id.optional(),
  resource_types: z.array(namedDeviceType).optional(),
  page_size: z.number().int().positive().max(500).optional().default(200),
  max_items_per_type: z.number().int().positive().max(5000).optional().default(200),
  max_stat_pages: z.number().int().positive().max(30).optional().default(10),
  include_raw: z.boolean().optional().default(false)
};

const listVentsWithRoomTemperaturesSchema = {
  structure_id: id.optional(),
  room_id: id.optional(),
  page_size: z.number().int().positive().max(500).optional().default(200),
  max_items: z.number().int().positive().max(5000).optional().default(500),
  max_stat_pages: z.number().int().positive().max(30).optional().default(10),
  include_closed: z.boolean().optional().default(true),
  include_raw: z.boolean().optional().default(false)
};

const listOpenVentsInColdRoomsSchema = {
  structure_id: id.optional(),
  room_id: id.optional(),
  below_temp_c: z.number().optional(),
  below_temp_f: z.number().optional(),
  min_percent_open: z.number().min(0).max(100).optional().default(1),
  page_size: z.number().int().positive().max(500).optional().default(200),
  max_items: z.number().int().positive().max(5000).optional().default(500),
  max_stat_pages: z.number().int().positive().max(30).optional().default(10),
  include_raw: z.boolean().optional().default(false)
};

const listVentsByRoomTemperatureSchema = {
  structure_id: id.optional(),
  room_id: id.optional(),
  temperature_operator: z.enum(["lt", "lte", "gt", "gte", "between"]).optional().default("lt"),
  threshold_temp_c: z.number().optional(),
  threshold_temp_f: z.number().optional(),
  min_temp_c: z.number().optional(),
  min_temp_f: z.number().optional(),
  max_temp_c: z.number().optional(),
  max_temp_f: z.number().optional(),
  vent_state: z.enum(["open", "closed", "any"]).optional().default("open"),
  min_percent_open: z.number().min(0).max(100).optional().default(1),
  max_percent_open: z.number().min(0).max(100).optional(),
  include_unknown_temperature: z.boolean().optional().default(false),
  page_size: z.number().int().positive().max(500).optional().default(200),
  max_items: z.number().int().positive().max(5000).optional().default(500),
  max_stat_pages: z.number().int().positive().max(30).optional().default(10),
  include_raw: z.boolean().optional().default(false)
};

const updateResourceSchema = {
  resource_type: resourceType,
  resource_id: id,
  attributes: z.record(z.unknown()),
  dry_run: z.boolean().optional().default(false)
};

const createResourceSchema = {
  resource_type: resourceType,
  attributes: z.record(z.unknown()),
  relationships: z.record(z.unknown()).optional(),
  dry_run: z.boolean().optional().default(false)
};

const setVentPercentOpenSchema = {
  vent_id: id,
  percent_open: z.number().int().min(0).max(100),
  dry_run: z.boolean().optional().default(false)
};

const setVentPercentOpenAndVerifySchema = {
  vent_id: id,
  percent_open: z.number().int().min(0).max(100),
  attempts: z.number().int().min(1).max(10).optional().default(4),
  initial_delay_ms: z.number().int().min(0).max(10000).optional().default(800),
  backoff_multiplier: z.number().min(1).max(4).optional().default(1.8)
};

export function createFlairMcpServer(flairApi: FlairApiClient) {
  const server = new McpServer({
    name: "Flair MCP",
    version: "0.1.0"
  });

  server.tool("health_check", {}, async () => {
    try {
      const resourceTypes = await flairApi.listResourceTypes();
      return toJsonOutput({
        ok: true,
        flair: buildFlairStatus(flairApi),
        resourceTypeCount: resourceTypes.length
      });
    } catch (err) {
      return toJsonOutput({
        ok: false,
        flair: buildFlairStatus(flairApi),
        error: normalizeFlairError(err)
      });
    }
  });

  server.tool("list_resource_types", {}, async () => {
    const data = await flairApi.listResourceTypes();
    return toJsonOutput(data);
  });

  server.tool("list_structures", {}, async () => {
    const data = await flairApi.listStructures();
    return toJsonOutput(data);
  });

  server.tool("list_rooms", listRoomsSchema, async (input) => {
    const data = await flairApi.listRooms(input.structure_id);
    return toJsonOutput(data);
  });

  server.tool("list_vents", listVentsSchema, async (input) => {
    const data = await flairApi.listVents(input.room_id);
    return toJsonOutput(data);
  });

  server.tool("list_devices", listDevicesSchema, async (input) => {
    const data = await flairApi.listDevices({
      structureId: input.structure_id,
      roomId: input.room_id,
      activeOnly: input.active_only,
      pageSize: input.page_size,
      maxItems: input.max_items
    });

    if (!input.include_raw) {
      return toJsonOutput({
        devices: data.devices,
        summary: data.summary
      });
    }

    return toJsonOutput(data);
  });

  server.tool("list_named_devices", listNamedDevicesSchema, async (input) => {
    const data = await flairApi.listNamedDevices({
      structureId: input.structure_id,
      roomId: input.room_id,
      resourceTypes: input.resource_types,
      pageSize: input.page_size,
      maxItemsPerType: input.max_items_per_type,
      includeRaw: input.include_raw
    });
    return toJsonOutput(data);
  });

  server.tool("list_room_temperatures", listRoomTemperaturesSchema, async (input) => {
    const data = await flairApi.listRoomTemperatures({
      structureId: input.structure_id,
      roomId: input.room_id,
      pageSize: input.page_size,
      maxStatPages: input.max_stat_pages,
      includeRoomsWithoutStats: input.include_rooms_without_stats
    });
    return toJsonOutput(data);
  });

  server.tool("list_device_room_temperatures", listDeviceRoomTemperaturesSchema, async (input) => {
    const data = await flairApi.listDeviceRoomTemperatures({
      structureId: input.structure_id,
      roomId: input.room_id,
      resourceTypes: input.resource_types,
      pageSize: input.page_size,
      maxItemsPerType: input.max_items_per_type,
      maxStatPages: input.max_stat_pages,
      includeRaw: input.include_raw
    });
    return toJsonOutput(data);
  });

  server.tool("list_vents_with_room_temperatures", listVentsWithRoomTemperaturesSchema, async (input) => {
    const data = await flairApi.listVentsWithRoomTemperatures({
      structureId: input.structure_id,
      roomId: input.room_id,
      pageSize: input.page_size,
      maxItems: input.max_items,
      maxStatPages: input.max_stat_pages,
      includeClosed: input.include_closed,
      includeRaw: input.include_raw
    });
    return toJsonOutput(data);
  });

  server.tool("list_open_vents_in_cold_rooms", listOpenVentsInColdRoomsSchema, async (input) => {
    if (typeof input.below_temp_c !== "number" && typeof input.below_temp_f !== "number") {
      throw new Error("Provide below_temp_c or below_temp_f");
    }

    const data = await flairApi.listOpenVentsInColdRooms({
      structureId: input.structure_id,
      roomId: input.room_id,
      belowTempC: input.below_temp_c,
      belowTempF: input.below_temp_f,
      minPercentOpen: input.min_percent_open,
      pageSize: input.page_size,
      maxItems: input.max_items,
      maxStatPages: input.max_stat_pages,
      includeRaw: input.include_raw
    });
    return toJsonOutput(data);
  });

  server.tool("list_vents_by_room_temperature", listVentsByRoomTemperatureSchema, async (input) => {
    const data = await flairApi.listVentsByRoomTemperature({
      structureId: input.structure_id,
      roomId: input.room_id,
      temperatureOperator: input.temperature_operator,
      thresholdTempC: input.threshold_temp_c,
      thresholdTempF: input.threshold_temp_f,
      minTempC: input.min_temp_c,
      minTempF: input.min_temp_f,
      maxTempC: input.max_temp_c,
      maxTempF: input.max_temp_f,
      ventState: input.vent_state,
      minPercentOpen: input.min_percent_open,
      maxPercentOpen: input.max_percent_open,
      includeUnknownTemperature: input.include_unknown_temperature,
      pageSize: input.page_size,
      maxItems: input.max_items,
      maxStatPages: input.max_stat_pages,
      includeRaw: input.include_raw
    });
    return toJsonOutput(data);
  });

  server.tool("list_resources", listResourcesSchema, async (input) => {
    const data = await flairApi.listResources(input.resource_type, {
      pageNumber: input.page_number,
      pageSize: input.page_size,
      maxItems: input.max_items,
      sort: input.sort,
      include: input.include,
      filters: input.filters
    });
    return toJsonOutput(data);
  });

  server.tool("get_resource", getResourceSchema, async (input) => {
    const data = await flairApi.getResource(input.resource_type, input.resource_id, input.include);
    return toJsonOutput(data);
  });

  server.tool("get_related_resources", getRelatedSchema, async (input) => {
    const data = await flairApi.getRelatedResources(input.resource_type, input.resource_id, input.relationship, {
      pageNumber: input.page_number,
      pageSize: input.page_size,
      include: input.include
    });
    return toJsonOutput(data);
  });

  if (config.writeToolsEnabled) {
    server.tool("update_resource_attributes", updateResourceSchema, async (input) => {
      if (input.dry_run) {
        return toJsonOutput({
          dryRun: true,
          action: "update_resource_attributes",
          payload: {
            data: {
              type: input.resource_type,
              id: input.resource_id,
              attributes: input.attributes
            }
          }
        });
      }

      const data = await flairApi.updateResourceAttributes(input.resource_type, input.resource_id, input.attributes);
      return toJsonOutput(data);
    });

    server.tool("create_resource", createResourceSchema, async (input) => {
      if (input.dry_run) {
        return toJsonOutput({
          dryRun: true,
          action: "create_resource",
          payload: {
            data: {
              type: input.resource_type,
              attributes: input.attributes,
              ...(input.relationships ? { relationships: input.relationships } : {})
            }
          }
        });
      }

      const data = await flairApi.createResource(input.resource_type, input.attributes, input.relationships);
      return toJsonOutput(data);
    });

    server.tool("set_vent_percent_open", setVentPercentOpenSchema, async (input) => {
      if (input.dry_run) {
        return toJsonOutput({
          dryRun: true,
          action: "set_vent_percent_open",
          payload: {
            type: "vent-states",
            attributes: {
              "percent-open": input.percent_open
            },
            relationships: {
              vent: {
                data: {
                  type: "vents",
                  id: input.vent_id
                }
              }
            }
          }
        });
      }

      const data = await flairApi.setVentPercentOpen(input.vent_id, input.percent_open);
      return toJsonOutput(data);
    });

    server.tool("set_vent_percent_open_and_verify", setVentPercentOpenAndVerifySchema, async (input) => {
      const data = await flairApi.setVentPercentOpenAndVerify(
        input.vent_id,
        input.percent_open,
        input.attempts ?? 4,
        input.initial_delay_ms ?? 800,
        input.backoff_multiplier ?? 1.8
      );
      return toJsonOutput(data);
    });
  }

  return server;
}
