import { SaaSBackend } from './backend/saas-backend.js';
import { resolveProject } from './client/http-client.js';
import type { CloudConfig, ToolBackend } from './client/types.js';

// Re-export resolveProject for use by mcp-sqlew
export { resolveProject };

/**
 * Create a SaaS backend instance
 */
export function createBackend(config: CloudConfig): ToolBackend {
  return new SaaSBackend(config);
}

/**
 * Plugin version (SemVer)
 */
export const version = '1.0.0';

/**
 * Minimum compatible mcp-sqlew version
 */
export const minVersion = '4.4.0';

// Export types for TypeScript users
export type {
  CloudConfig,
  ConnectionIdentity,
  Environment,
  ToolBackend,
  HealthCheckResult,
} from './client/types.js';
export { ApiError } from './errors/api-error.js';
