/**
 * MCP Server - Tool Registry
 * Generates MCP Tool[] list from Zod schemas.
 *
 * Previously: hand-written JSON Schema (273 lines)
 * Now: Zod schemas → toJSONSchema() + description
 *
 * Note: This function is no longer used by index.ts (registerTool handles ListTools
 * automatically), but is retained for verification and external consumers.
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { toJSONSchema } from 'zod';
import { TOOL_SCHEMAS, TOOL_DESCRIPTIONS } from './tool-schemas.js';

/**
 * Get list of all available MCP tools (JSON Schema format)
 */
export function getToolRegistry(): Tool[] {
  return Object.entries(TOOL_SCHEMAS).map(([name, schema]) => ({
    name,
    description: TOOL_DESCRIPTIONS[name],
    inputSchema: toJSONSchema(schema) as Tool['inputSchema'],
  }));
}
