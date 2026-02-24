/**
 * MCP Server - Tool Call Handlers
 * Processes CallToolRequest and dispatches to appropriate tool actions
 *
 * v4.4.0+: Uses ToolBackend pattern for Local/Plugin abstraction
 * All tool execution logic is delegated to the active backend.
 */

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { debugLogToolCall, debugLogToolResponse } from '../utils/debug-logger.js';
import { handleToolError } from '../utils/error-handler.js';
import { getBackend, getBackendType } from '../backend/index.js';
import { LocalBackend } from '../backend/index.js';

/**
 * Handle tool call - dispatch to appropriate tool action
 *
 * Routes requests through the ToolBackend abstraction layer:
 * - LocalBackend: Executes against local database via Knex
 * - Plugin backends: Execute via plugin implementation (e.g., HTTP API)
 */
export async function handleToolCall(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const name = toolName;
  const params = args;
  const action = (params.action as string) || 'N/A';

  // Debug logging: Tool call
  debugLogToolCall(name, action, params);

  try {
    const backend = getBackend();

    // Execute via backend (all tool logic is in backend implementations)
    let result: unknown;
    try {
      result = await backend.execute(name, action, params);
    } catch (backendError) {
      // Fallback to LocalBackend for:
      // - UNSUPPORTED_TOOL: Tool not supported in SaaS mode
      // - LOCAL_ONLY_ACTION: Action requires local processing (help/example/use_case/suggest_pending)
      if (getBackendType() === 'saas' && isLocalFallbackRequired(backendError)) {
        const localBackend = new LocalBackend();
        result = await localBackend.execute(name, action, params);
      } else {
        throw backendError;
      }
    }

    // Debug logging: Success
    debugLogToolResponse(name, action, true, result);

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    // Use centralized error handler (stack goes to logs only, not returned to client)
    const errorResult = handleToolError(name, action, error, params);

    // Check if this is a structured validation error or a simple message
    const errorResponse = errorResult.message !== undefined
      ? { error: errorResult.message }  // Regular error: wrap message
      : errorResult;  // Validation error: use structured object as-is

    debugLogToolResponse(name, action, false, undefined, errorResponse);

    return {
      content: [{ type: 'text', text: JSON.stringify(errorResponse, null, 2) }],
      isError: true,
    };
  }
}

/**
 * Check if error requires fallback to LocalBackend
 *
 * Detects two types of errors from plugin backend:
 * - UNSUPPORTED_TOOL: The tool itself is not supported in SaaS mode
 * - LOCAL_ONLY_ACTION: The specific action requires local processing (e.g., help, example, use_case)
 */
export function isLocalFallbackRequired(error: unknown): boolean {
  if (error && typeof error === 'object') {
    // UNSUPPORTED_TOOL: Tool itself is not supported
    if ('code' in error && error.code === 'UNSUPPORTED_TOOL') {
      return true;
    }
    // LOCAL_ONLY_ACTION: Action requires local processing (TOML/hardcoded data)
    if ('code' in error && error.code === 'LOCAL_ONLY_ACTION') {
      return true;
    }
    // Legacy: Message pattern matching for backwards compatibility
    if ('message' in error && typeof error.message === 'string') {
      return error.message.includes('not supported in SaaS mode');
    }
  }
  return false;
}
