/**
 * Native RDBMS Database Initialization
 *
 * Fresh database setup and teardown via Knex migrations
 * for MySQL, MariaDB, and PostgreSQL integration tests.
 */

import knex, { Knex } from 'knex';
import assert from 'node:assert';
import { join } from 'node:path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { getTestConfig, type DatabaseType } from '../../database/testing-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Get migration directory paths
 *
 * Migrations must be compiled before tests run (npx tsc).
 * Resolves paths based on dist/ directory structure.
 */
function getMigrationDirs(): string[] {
  // From dist/tests/docker/native/ -> dist/database/migrations/
  const projectRoot = join(__dirname, '../../../..'); // dist/tests/docker/native -> project root

  // Updated for Universal Knex Wrapper migrations (v3.9.0)
  // All migrations now in single flat directory
  return [
    join(projectRoot, 'dist/database/migrations/v4'),
  ];
}

/**
 * Initialize fresh database with all Knex migrations
 *
 * @example
 * ```typescript
 * const db = await initDatabase('postgresql');
 * // ... run tests ...
 * await teardownDatabase(db);
 * ```
 */
export async function initDatabase(dbType: DatabaseType): Promise<Knex> {
  const config = getTestConfig(dbType);

  const migrationDirs = getMigrationDirs();
  const fullConfig: Knex.Config = {
    ...config,
    migrations: {
      directory: migrationDirs,
      extension: 'js',
      tableName: 'knex_migrations',
      loadExtensions: ['.js'],
    },
  };

  const db = knex(fullConfig);

  try {
    await db.raw('SELECT 1');

    const [batchNo, migrations] = await db.migrate.latest();

    if (migrations.length === 0) {
      console.log(`    ℹ️  Database already migrated (batch ${batchNo})`);
    } else {
      console.log(`    ✅ Ran ${migrations.length} migrations (batch ${batchNo})`);
    }

    await verifyMigrations(db);

    return db;
  } catch (error: any) {
    await db.destroy().catch(() => {});
    throw new Error(`Failed to initialize ${dbType} database: ${error.message}`);
  }
}

/**
 * Verify that migrations completed successfully
 */
export async function verifyMigrations(db: Knex): Promise<void> {
  const hasMigrationTable = await db.schema.hasTable('knex_migrations');
  assert.ok(hasMigrationTable, 'knex_migrations table should exist');

  const migrations = await db('knex_migrations').select('name');
  assert.ok(migrations.length > 0, 'At least one migration should have run');

  // Note: v4_tasks removed in v5.0 (deprecated)
  const keyTables = ['m_context_keys', 't_decisions', 't_constraints'];
  for (const table of keyTables) {
    const exists = await db.schema.hasTable(table);
    assert.ok(exists, `Table ${table} should exist after migrations`);
  }
}

/**
 * Clean up database and disconnect
 *
 * Safe because tests use Docker containers with isolated databases.
 */
export async function teardownDatabase(db: Knex): Promise<void> {
  try {
    const client = db.client.config.client;
    const dbType = getDbTypeFromClient(client);

    await dropAllTables(db, dbType);

    await db.destroy();
  } catch (error) {
    // Best effort cleanup - ignore errors
    await db.destroy().catch(() => {});
  }
}

/** Drop all tables using database-specific SQL dialects */
async function dropAllTables(db: Knex, dbType: DatabaseType): Promise<void> {
  if (dbType === 'mysql' || dbType === 'mariadb') {
    await db.raw('SET FOREIGN_KEY_CHECKS=0');

    const tables = await db.raw(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_TYPE = 'BASE TABLE'
    `);

    for (const row of tables[0]) {
      await db.raw(`DROP TABLE IF EXISTS \`${row.TABLE_NAME}\``);
    }

    await db.raw('SET FOREIGN_KEY_CHECKS=1');
  } else if (dbType === 'postgresql') {
    const tables = await db.raw(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
    `);

    for (const row of tables.rows) {
      await db.raw(`DROP TABLE IF EXISTS "${row.tablename}" CASCADE`);
    }
  }
}

/**
 * Get DatabaseType from Knex client string
 *
 * @param client - Knex client string (e.g., 'mysql2', 'pg', 'better-sqlite3')
 * @returns DatabaseType
 */
function getDbTypeFromClient(client: string): DatabaseType {
  switch (client) {
    case 'mysql2':
      return 'mysql'; // Cannot distinguish MySQL from MariaDB via client string
    case 'pg':
      return 'postgresql';
    case 'better-sqlite3':
    case 'sqlite3':
      return 'sqlite';
    default:
      throw new Error(`Unknown client type: ${client}`);
  }
}
