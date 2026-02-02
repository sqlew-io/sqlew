import { HttpClient } from '../client/http-client.js';
import { AuthManager } from '../auth/auth-manager.js';
import { ApiError } from '../errors/api-error.js';
import { SUPPORTED_TOOLS, isLocalOnlyAction } from '../config/constants.js';
import type {
  CloudConfig,
  ToolBackend,
  HealthCheckResult,
} from '../client/types.js';

export class SaaSBackend implements ToolBackend {
  readonly backendType = 'saas' as const;
  readonly pluginName = 'saas-connector';

  private httpClient: HttpClient;

  constructor(config: CloudConfig) {
    const authManager = new AuthManager(config.apiKey);
    this.httpClient = new HttpClient(
      authManager,
      config.projectName,
      config.projectId,
      config.connectionIdentity
    );
  }

  async execute<T>(
    tool: string,
    action: string,
    params: Record<string, unknown>
  ): Promise<T> {
    // Check if this action should be handled locally (no DB access required)
    if (isLocalOnlyAction(tool, action)) {
      throw new ApiError(
        'LOCAL_ONLY_ACTION',
        `Action '${tool}.${action}' should be handled locally (no DB access required)`,
        200 // Not an error, just a signal to fallback
      );
    }

    // Validate supported tools
    if (!SUPPORTED_TOOLS.includes(tool as (typeof SUPPORTED_TOOLS)[number])) {
      throw new ApiError(
        'UNSUPPORTED_TOOL',
        `Tool '${tool}' is not supported in SaaS mode. Supported tools: ${SUPPORTED_TOOLS.join(', ')}`,
        400
      );
    }

    // Normalize params for SaaS API compatibility
    const normalizedParams = this.normalizeParams(tool, action, params);

    // Call SaaS API
    const endpoint = `/api/v1/${tool}/${action}`;
    return await this.httpClient.post<T>(endpoint, normalizedParams);
  }

  /**
   * Normalize params for SaaS API compatibility
   * Maps client param names to SaaS API expected names
   */
  private normalizeParams(
    tool: string,
    action: string,
    params: Record<string, unknown>
  ): Record<string, unknown> {
    const result = { ...params };

    // constraint.deactivate/activate: constraint_id → id
    if (tool === 'constraint' && (action === 'deactivate' || action === 'activate')) {
      if ('constraint_id' in result && !('id' in result)) {
        result.id = result.constraint_id;
        delete result.constraint_id;
      }
    }

    return result;
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      await this.httpClient.get<{ status: string }>('/health');
      return {
        ok: true,
        latency: Date.now() - start,
      };
    } catch (error) {
      return {
        ok: false,
        latency: Date.now() - start,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async disconnect(): Promise<void> {
    // HTTP client doesn't need explicit disconnect
  }

  /**
   * Set agent name for X-Agent header (called after MCP handshake)
   */
  setAgentName(name: string): void {
    this.httpClient.setAgentName(name);
  }
}
