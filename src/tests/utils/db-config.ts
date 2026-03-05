/**
 * Database Configuration Module
 *
 * Provides database connection configuration for test suites.
 * Supports SQLite, MySQL/MariaDB, and PostgreSQL with Docker.
 */

import { Knex } from 'knex';
import { join } from 'node:path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { getTestConfig, getDockerConfig, type DatabaseType as ConfigDatabaseType } from '../database/testing-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export type DatabaseType = ConfigDatabaseType;

export interface DbConfig {
  type: DatabaseType;
  knexConfig: Knex.Config;
  containerName?: string;
}
// Migration directories - resolve based on whether we're in dist/ or src/
// When running tests, we're in dist/tests/utils/, so ../../config/knex/ is wrong
// We need to go to the project root first
const projectRoot = join(__dirname, '../../../'); // dist/tests/utils/ -> project root

// v4 migration path (replaces v3 config/knex/bootstrap, upgrades, enhancements)
export const migrationDirs = [
  join(projectRoot, 'dist/database/migrations/v4'),
];
/**
 * Get database configuration by type
 * Now uses centralized testing-config.ts for consistent credentials
 */
export function getDbConfig(type: DatabaseType, customPath?: string): DbConfig {
  const knexConfig = getTestConfig(type);

  if (type === 'sqlite' && customPath) {
    knexConfig.connection = { filename: customPath };
  }

  if (!knexConfig.migrations) {
    knexConfig.migrations = {
      directory: migrationDirs,
      extension: 'js',
      tableName: 'knex_migrations',
      loadExtensions: ['.js'],
    };
  }

  let containerName: string | undefined;
  if (type !== 'sqlite') {
    const dockerConfig = getDockerConfig(type);
    containerName = dockerConfig.name;
  }

  return {
    type,
    knexConfig,
    containerName,
  };
}
