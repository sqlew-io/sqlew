/**
 * Backend Abstraction Types
 *
 * Defines the ToolBackend interface for local and SaaS backends.
 */

/**
 * Backend type identifier
 * - 'local': Direct database connection via Knex
 * - 'saas': SaaS connector (submodule)
 */
export type BackendType = 'local' | 'saas';

/**
 * Health check result
 */
export interface HealthCheckResult {
  ok: boolean;
  latency: number;
  message?: string;
}

/**
 * ToolBackend interface
 *
 * All backend implementations must implement this interface.
 * This enables transparent switching between local DB and plugin-based backends.
 */
export interface ToolBackend {
  /**
   * Execute a tool action
   * @param tool - Tool name (e.g., 'decision', 'constraint')
   * @param action - Action name (e.g., 'get', 'set', 'list')
   * @param params - Action parameters
   * @returns Action result
   */
  execute<TResponse = unknown>(
    tool: string,
    action: string,
    params: Record<string, unknown>
  ): Promise<TResponse>;

  /**
   * Perform health check
   * @returns Health check result with latency
   */
  healthCheck(): Promise<HealthCheckResult>;

  /**
   * Disconnect and cleanup resources
   */
  disconnect(): Promise<void>;

  /**
   * Backend type identifier
   */
  readonly backendType: BackendType;

  /**
   * Optional: Plugin name (for plugin backends)
   */
  readonly pluginName?: string;

  /**
   * Optional: Set agent name for audit headers (SaaS only)
   * @param name - MCP client name (e.g., "claude-code")
   */
  setAgentName?(name: string): void;
}

