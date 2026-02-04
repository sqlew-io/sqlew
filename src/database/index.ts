/**
 * Database module - Re-exports all database operations
 *
 * This is the main entry point for database operations.
 * Import from this file instead of individual modules.
 */

import { Knex } from 'knex';

// Types
export type { DatabaseAdapter } from './types.js';

// Initialization
export {
  initializeDatabase,
  getAdapterInstance,
  setAdapterInstance,
} from './initialization/init.js';

export { closeDatabase } from './initialization/cleanup.js';

// Schema version detection (v4.0)
export {
  detectSchemaVersion,
  getSchemaVersion,
  isSchemaVersionDetected,
  clearSchemaVersionCache,
  isV5Schema,
  isV4Schema,
  isV3Schema,
  getTableName,
  TableNames,
} from './initialization/schema-version.js';
export type { SchemaVersion, SchemaVersionInfo } from './initialization/schema-version.js';

// Adapter factory
export { getAdapter, getDatabase } from './config/adapter-factory.js';

// Configuration operations (v4.0: in-memory store, no database dependency)
export {
  getConfigValue,
  setConfigValue,
  getConfigBool,
  getConfigInt,
  getAllConfig,
  clearConfig,
} from './config/config-ops.js';

// Query operations
export {
  getLayerId,
  getCategoryId,
  getDecisionWithContext,
  listDecisionContexts,
} from './operations/queries.js';

// Insert operations
export {
  getOrCreateAgent,
  getOrCreateContextKey,
  getOrCreateFile,
  getOrCreateTag,
  getOrCreateScope,
  getOrCreateCategoryId,
  addDecisionContext,
} from './operations/inserts.js';

// Update operations
export { updateAgentActivity } from './operations/updates.js';

// Delete operations (placeholder)
export { _placeholder } from './operations/deletes.js';

/**
 * Execute a function within a database transaction
 */
export async function transaction<T>(
  callback: (trx: Knex.Transaction) => Promise<T>
): Promise<T> {
  const { getAdapter } = await import('./config/adapter-factory.js');
  const adapter = getAdapter();
  const knex = adapter.getKnex();
  return await knex.transaction(callback);
}
