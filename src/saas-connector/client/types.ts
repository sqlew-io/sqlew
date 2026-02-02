/**
 * Detected environment types for connection identification
 * @since v5.0.0
 */
export type Environment =
  | 'windows'
  | 'macos'
  | 'linux'
  | 'wsl'
  | 'docker'
  | 'unknown';

/**
 * Connection identity for SaaS backend.
 * Provides unique identification for each connection.
 *
 * @since v5.0.0
 */
export interface ConnectionIdentity {
  /** SHA256 hash for internal identification (Base64URL, 43 chars) */
  connectionHash: string;
  /** Detected environment for display (windows, macos, linux, wsl, docker) */
  environment: Environment;
  /** Last two path segments for display (e.g., 'RustroverProjects/my-app') */
  pathSuffix: string;
  /** Full path (stored locally, not sent to server) */
  fullPath: string;
}

// Configuration passed from mcp-sqlew
export interface CloudConfig {
  apiKey: string;
  /** Project name from .sqlew/config.toml [project].name */
  projectName?: string;
  /** Resolved project UUID (cached in ~/.sqlew.env) */
  projectId?: string;
  /** Connection identity for SaaS mode (v5.0.0+) */
  connectionIdentity?: ConnectionIdentity;
  /** MCP client name for audit (e.g., "claude-code", "cursor") */
  agentName?: string;
}

// Project resolve response
export interface ProjectResolveResponse {
  project_id: string;
}

// Health check result
export interface HealthCheckResult {
  ok: boolean;
  latency: number;
  message?: string;
}

// Backend type
export type BackendType = 'local' | 'saas';

// ToolBackend interface (compatible with mcp-sqlew)
export interface ToolBackend {
  execute<TResponse = unknown>(
    tool: string,
    action: string,
    params: Record<string, unknown>
  ): Promise<TResponse>;
  healthCheck(): Promise<HealthCheckResult>;
  disconnect(): Promise<void>;
  readonly backendType: BackendType;
  readonly pluginName?: string;
}

// Plugin module interface
export interface PluginModule {
  createBackend(config: CloudConfig): ToolBackend;
  version: string;
  minVersion?: string;
}

// API response format
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}
