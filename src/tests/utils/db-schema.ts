/**
 * Database Schema Inspection & Comparison Module
 *
 * Provides utilities for connecting to databases, inspecting schema structure,
 * comparing schemas across databases, and managing foreign key constraints.
 */

import knex, { Knex } from 'knex';
import assert from 'node:assert';
import type { DbConfig, DatabaseType } from './db-config.js';
/**
 * Create and verify database connection
 */
export async function connectDb(config: DbConfig): Promise<Knex> {
  const db = knex(config.knexConfig);

  try {
    await db.raw('SELECT 1');
    return db;
  } catch (error: any) {
    throw new Error(`Failed to connect to ${config.type}: ${error.message}`);
  }
}

/**
 * Close database connection safely
 */
export async function disconnectDb(db: Knex): Promise<void> {
  try {
    await db.destroy();
  } catch (error) {
    // Ignore disconnect errors
  }
}

/**
 * Drop all tables and views from database
 */
export async function dropAllTables(db: Knex, type: DatabaseType): Promise<void> {
  if (type === 'sqlite') {
    // SQLite: Get all tables and views, then drop them
    const objects = await db.raw(`
      SELECT name, type FROM sqlite_master
      WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
    `);

    await db.raw('PRAGMA foreign_keys = OFF');
    for (const row of objects) {
      if (row.type === 'view') {
        await db.raw(`DROP VIEW IF EXISTS "${row.name}"`);
      } else {
        await db.raw(`DROP TABLE IF EXISTS "${row.name}"`);
      }
    }
    await db.raw('PRAGMA foreign_keys = ON');

  } else if (type === 'mysql' || type === 'mariadb') {
    // MySQL/MariaDB: Drop all views first, then tables
    await db.raw('SET FOREIGN_KEY_CHECKS=0');

    // Drop views
    const views = await db.raw(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = 'mcp_test' AND TABLE_TYPE = 'VIEW'
    `);

    for (const row of views[0]) {
      await db.raw(`DROP VIEW IF EXISTS ??`, [row.TABLE_NAME]);
    }

    // Drop tables
    const tables = await db.raw(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = 'mcp_test' AND TABLE_TYPE = 'BASE TABLE'
    `);

    for (const row of tables[0]) {
      await db.raw(`DROP TABLE IF EXISTS ??`, [row.TABLE_NAME]);
    }
    await db.raw('SET FOREIGN_KEY_CHECKS=1');

  } else if (type === 'postgresql') {
    // PostgreSQL: Drop and recreate schema (drops both tables and views)
    await db.raw('DROP SCHEMA IF EXISTS public CASCADE');
    await db.raw('CREATE SCHEMA public');
  }
}
export interface TableInfo {
  name: string;
  columnCount: number;
  rowCount: number;
}

/**
 * Get list of tables in database
 */
export async function getTables(db: Knex, type: DatabaseType): Promise<string[]> {
  if (type === 'sqlite') {
    const result = await db.raw(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'knex_migrations'
      ORDER BY name
    `);
    return result.map((r: any) => r.name);

  } else if (type === 'mysql' || type === 'mariadb') {
    const result = await db.raw(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = 'mcp_test'
        AND TABLE_TYPE = 'BASE TABLE'
        AND TABLE_NAME != 'knex_migrations'
      ORDER BY TABLE_NAME
    `);
    return result[0].map((r: any) => r.TABLE_NAME);

  } else if (type === 'postgresql') {
    const result = await db.raw(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public' AND tablename != 'knex_migrations'
      ORDER BY tablename
    `);
    return result.rows.map((r: any) => r.tablename);
  }

  return [];
}

/**
 * Get table information (columns, rows)
 */
export async function getTableInfo(db: Knex, tableName: string): Promise<TableInfo> {
  const columnInfo = await db(tableName).columnInfo();
  const rowCount = await db(tableName).count('* as count').first();

  return {
    name: tableName,
    columnCount: Object.keys(columnInfo).length,
    rowCount: Number(rowCount?.count || 0),
  };
}

/**
 * Assert table counts match between two databases
 */
export async function assertTableCountsMatch(
  sourceDb: Knex,
  sourceType: DatabaseType,
  targetDb: Knex,
  targetType: DatabaseType,
  message?: string
): Promise<void> {
  const sourceTables = await getTables(sourceDb, sourceType);
  const targetTables = await getTables(targetDb, targetType);

  assert.strictEqual(
    targetTables.length,
    sourceTables.length,
    message || `Table count mismatch: ${sourceType} has ${sourceTables.length}, ${targetType} has ${targetTables.length}`
  );
}

/**
 * Assert row counts match for a specific table
 */
export async function assertRowCountsMatch(
  sourceDb: Knex,
  targetDb: Knex,
  tableName: string,
  message?: string
): Promise<void> {
  const sourceCount = await sourceDb(tableName).count('* as count').first();
  const targetCount = await targetDb(tableName).count('* as count').first();

  assert.strictEqual(
    Number(targetCount?.count || 0),
    Number(sourceCount?.count || 0),
    message || `Row count mismatch in ${tableName}`
  );
}
export interface FKConstraintInfo {
  tableName: string;
  columnName: string;
  referencedTable: string;
  referencedColumn: string;
  onDelete?: string;
  onUpdate?: string;
}

/**
 * Get foreign key constraints from database
 */
export async function getFKConstraints(db: Knex, type: DatabaseType, tableName: string): Promise<FKConstraintInfo[]> {
  const constraints: FKConstraintInfo[] = [];

  if (type === 'sqlite') {
    const result = await db.raw(`PRAGMA foreign_key_list(${tableName})`);
    for (const fk of result) {
      constraints.push({
        tableName,
        columnName: fk.from,
        referencedTable: fk.table,
        referencedColumn: fk.to,
        onDelete: fk.on_delete,
        onUpdate: fk.on_update,
      });
    }

  } else if (type === 'mysql' || type === 'mariadb') {
    const result = await db.raw(`
      SELECT
        COLUMN_NAME,
        REFERENCED_TABLE_NAME,
        REFERENCED_COLUMN_NAME
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = 'mcp_test'
        AND TABLE_NAME = ?
        AND REFERENCED_TABLE_NAME IS NOT NULL
    `, [tableName]);

    for (const fk of result[0]) {
      constraints.push({
        tableName,
        columnName: fk.COLUMN_NAME,
        referencedTable: fk.REFERENCED_TABLE_NAME,
        referencedColumn: fk.REFERENCED_COLUMN_NAME,
      });
    }

  } else if (type === 'postgresql') {
    const result = await db.raw(`
      SELECT
        kcu.column_name,
        ccu.table_name AS referenced_table,
        ccu.column_name AS referenced_column
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = ?
    `, [tableName]);

    for (const fk of result.rows) {
      constraints.push({
        tableName,
        columnName: fk.column_name,
        referencedTable: fk.referenced_table,
        referencedColumn: fk.referenced_column,
      });
    }
  }

  return constraints;
}

/**
 * Assert FK constraints exist for a table
 */
export async function assertFKConstraintsExist(
  db: Knex,
  type: DatabaseType,
  tableName: string,
  expectedCount: number,
  message?: string
): Promise<void> {
  const constraints = await getFKConstraints(db, type, tableName);

  assert.ok(
    constraints.length >= expectedCount,
    message || `Expected at least ${expectedCount} FK constraints on ${tableName}, found ${constraints.length}`
  );
}
