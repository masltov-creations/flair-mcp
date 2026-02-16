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
      activeOnly: input.active_only
    });

    if (!input.include_raw) {
      return toJsonOutput({
        devices: data.devices,
        summary: data.summary
      });
    }

    return toJsonOutput(data);
  });

  server.tool("list_resources", listResourcesSchema, async (input) => {
    const data = await flairApi.listResources(input.resource_type, {
      pageNumber: input.page_number,
      pageSize: input.page_size,
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
      const payload = {
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
      };

      if (input.dry_run) {
        return toJsonOutput({
          dryRun: true,
          action: "set_vent_percent_open",
          payload
        });
      }

      const data = await flairApi.createResource(
        payload.type,
        payload.attributes,
        payload.relationships as Record<string, unknown>
      );
      return toJsonOutput(data);
    });
  }

  return server;
}
