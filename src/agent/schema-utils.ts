/**
 * Shared JSON-Schema → Zod conversion. Extracted from chat-tools.ts so both
 * the built-in tool adapter and the MCP tool bridge (mcp-bridge.ts) can build
 * an AgentTool's `parameters` from an arbitrary JSON-Schema `properties` map
 * (custom tool input_schema, or an MCP server's advertised inputSchema)
 * without an import cycle between the two.
 */

import { z } from 'zod';

/**
 * Convert a JSON Schema properties map to a Zod object schema.
 * Handles string, number, boolean, and array types; falls back to z.any().
 */
export function jsonSchemaToZod(
  properties: Record<string, unknown>,
  required: string[] = []
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, value] of Object.entries(properties)) {
    const prop = value as { type?: string; items?: { type?: string }; description?: string };
    let schema: z.ZodTypeAny;

    switch (prop.type) {
      case 'string':
        schema = z.string();
        break;
      case 'number':
      case 'integer':
        schema = z.number();
        break;
      case 'boolean':
        schema = z.boolean();
        break;
      case 'array':
        if (prop.items?.type === 'string') {
          schema = z.array(z.string());
        } else if (prop.items?.type === 'number') {
          schema = z.array(z.number());
        } else {
          schema = z.array(z.any());
        }
        break;
      default:
        schema = z.any();
    }

    if (prop.description) {
      schema = schema.describe(prop.description);
    }

    if (!required.includes(key)) {
      schema = schema.optional();
    }

    shape[key] = schema;
  }

  return z.object(shape);
}
