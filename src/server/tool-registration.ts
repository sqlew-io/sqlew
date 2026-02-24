/**
 * MCP Server - Tool Registration
 * Registers all tools via McpServer.registerTool() API.
 *
 * This replaces the manual setRequestHandler(ListToolsRequestSchema/CallToolRequestSchema)
 * pattern. registerTool() automatically handles ListTools and CallTool requests.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TOOL_SCHEMAS, TOOL_DESCRIPTIONS } from './tool-schemas.js';
import { handleToolCall } from './tool-handlers.js';

let agentNameInitialized = false;

/**
 * Register all MCP tools on the given McpServer instance.
 *
 * Each tool is registered with:
 * - Zod input schema (for validation + JSON Schema generation)
 * - Description string
 * - Callback that delegates to handleToolCall()
 */
export function registerAllTools(mcpServer: McpServer): void {
  for (const [name, schema] of Object.entries(TOOL_SCHEMAS)) {
    mcpServer.registerTool(
      name,
      {
        description: TOOL_DESCRIPTIONS[name],
        inputSchema: schema,
      },
      async (args: unknown) => {
        // Lazy initialization of agent name (after MCP handshake)
        if (!agentNameInitialized) {
          agentNameInitialized = true;
          const clientVersion = mcpServer.server.getClientVersion();
          if (clientVersion?.name) {
            const { getBackend } = await import('../backend/backend-factory.js');
            const backend = getBackend();
            if (backend.setAgentName) {
              backend.setAgentName(clientVersion.name);
            }
          }
        }
        // Args are already validated by registerTool's Zod schema
        return await handleToolCall(name, args as Record<string, unknown>);
      },
    );
  }
}
