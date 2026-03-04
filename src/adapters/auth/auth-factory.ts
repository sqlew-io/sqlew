import { BaseAuthProvider } from './base-auth-provider.js';
import { DirectAuthProvider } from './direct-auth-provider.js';
import type { DatabaseConfig } from '../../config/types.js';

/** Create an authentication provider based on database configuration. */
export function createAuthProvider(config: DatabaseConfig): BaseAuthProvider | null {
  // Validate database type
  if (!config.type) {
    throw new Error('Database type is required in configuration');
  }

  const validTypes = ['sqlite', 'mysql', 'postgres'];
  if (!validTypes.includes(config.type)) {
    throw new Error(`Invalid database type: ${config.type}. Must be one of: ${validTypes.join(', ')}`);
  }

  // SQLite doesn't need authentication (file-based)
  if (config.type === 'sqlite') {
    return null;
  }

  // MySQL/PostgreSQL use direct authentication
  return new DirectAuthProvider(config);
}

/** Check if database type requires authentication. */
export function requiresAuthentication(config: DatabaseConfig): boolean {
  return config.type !== 'sqlite';
}
