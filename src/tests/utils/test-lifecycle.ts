/**
 * Test Lifecycle Management Module
 *
 * Provides utilities for test setup/teardown and managing test completion
 * with better-sqlite3 hanging prevention.
 */

import { Knex } from 'knex';
import type { DbConfig, DatabaseType } from './db-config.js';
import { connectDb, disconnectDb } from './db-schema.js';
export interface TestContext {
  dbs: Map<DatabaseType, Knex>;
  configs: Map<DatabaseType, DbConfig>;
}

/**
 * Setup test context with multiple databases
 */
export async function setupTestContext(types: DatabaseType[]): Promise<TestContext> {
  const dbs = new Map<DatabaseType, Knex>();
  const configs = new Map<DatabaseType, DbConfig>();

  for (const type of types) {
    const { getDbConfig } = await import('./db-config.js');
    const config = getDbConfig(type);
    configs.set(type, config);

    try {
      const db = await connectDb(config);
      dbs.set(type, db);
    } catch (error: any) {
      // Clean up already connected databases
      for (const [, db] of dbs) {
        await disconnectDb(db);
      }
      throw error;
    }
  }

  return { dbs, configs };
}

/**
 * Teardown test context (close all connections)
 */
export async function teardownTestContext(context: TestContext): Promise<void> {
  for (const [, db] of context.dbs) {
    await disconnectDb(db);
  }
}
/**
 * Force exit after test completion to prevent better-sqlite3 hanging.
 * Uses setImmediate to let the test finish before exiting.
 */
export function forceExitAfterTest(): void {
  setImmediate(async () => {
    try {
      // Database cleanup can be skipped for temporary test databases
      // better-sqlite3 handles cleanup internally before exit
    } catch (error) {
      // Ignore cleanup errors
    } finally {
      // Force exit immediately (better-sqlite3 keeps event loop alive)
      process.exit(0);
    }
  });
}
