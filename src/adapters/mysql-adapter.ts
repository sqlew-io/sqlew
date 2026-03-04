// src/adapters/mysql-adapter.ts
import type { Knex } from 'knex';
import { BaseAdapter } from './base-adapter.js';
import type { DatabaseConfig } from '../config/types.js';

/** MySQL adapter with authentication support. */
export class MySQLAdapter extends BaseAdapter {
  readonly supportsReturning = false;
  readonly supportsJSON = true;
  readonly supportsUpsert = true;
  readonly supportsCTE = true;
  readonly supportsWindowFunctions = true;
  readonly supportsSavepoints = true;
  readonly databaseName = 'mysql' as const;

  constructor(config: DatabaseConfig) {
    super(config);
  }

  getDialect(): string {
    return 'mysql2';
  }

  /** Initializes MySQL-specific session settings (UTF8MB4, UTC, TRADITIONAL). */
  async initialize(): Promise<void> {
    const knex = this.getKnex();

    // Validate database exists
    const dbName = this.config.connection?.database;
    if (!dbName) {
      throw new Error('MySQL adapter requires database name in configuration');
    }

    try {
      // Query to check if we can access the database
      const result = await knex.raw('SELECT DATABASE() as db');
      const currentDb = result[0]?.[0]?.db;

      if (!currentDb || currentDb !== dbName) {
        throw new Error(
          `Database '${dbName}' does not exist or cannot be accessed. ` +
          `Please create it manually: CREATE DATABASE ${dbName} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
        );
      }
    } catch (error: any) {
      if (error.code === 'ER_BAD_DB_ERROR') {
        throw new Error(
          `Database '${dbName}' does not exist. ` +
          `Please create it manually before connecting. Required privileges: SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES`
        );
      }
      throw error;
    }

    // Configure character set and collation for full Unicode support
    await knex.raw("SET NAMES 'utf8mb4' COLLATE 'utf8mb4_unicode_ci'");

    // Set timezone to UTC for consistent timestamp handling
    await knex.raw("SET time_zone = '+00:00'");

    // Set SQL mode for strict compliance and safety
    await knex.raw("SET sql_mode = 'TRADITIONAL'");
  }

  /** Inserts a row and returns the inserted record via LAST_INSERT_ID(). */
  async insertReturning<T extends Record<string, any>>(
    table: string,
    data: Partial<T>
  ): Promise<T> {
    const knex = this.getKnex();

    // Insert and get the auto-increment ID
    const [insertId] = await knex(table).insert(data);

    // Retrieve the inserted row using LAST_INSERT_ID()
    const result = await knex(table).where({ id: insertId }).first();

    if (!result) {
      throw new Error(`Failed to retrieve inserted row from ${table}`);
    }

    return result as T;
  }

  /** Upserts a row using ON DUPLICATE KEY UPDATE. */
  async upsert<T extends Record<string, any>>(
    table: string,
    data: Partial<T>,
    conflictColumns: string[],
    updateColumns?: string[]
  ): Promise<number> {
    const knex = this.getKnex();

    // Determine which columns to update on conflict
    const columnsToUpdate = updateColumns || Object.keys(data).filter(
      key => !conflictColumns.includes(key)
    );

    // Build update data for ON DUPLICATE KEY UPDATE clause
    const updateData = columnsToUpdate.reduce((acc, col) => {
      acc[col] = data[col as keyof T];
      return acc;
    }, {} as Record<string, any>);

    // Use Knex's onConflict() which generates ON DUPLICATE KEY UPDATE for MySQL
    const result = await knex(table)
      .insert(data)
      .onConflict(conflictColumns)
      .merge(updateData);

    return result.length;
  }

  /** Extracts a value from a JSON column using JSON_EXTRACT(). */
  jsonExtract(column: string, path: string): Knex.Raw {
    const knex = this.getKnex();
    // Ensure path starts with $ for MySQL JSON path syntax
    const jsonPath = path.startsWith('$') ? path : `$.${path}`;
    return knex.raw('JSON_EXTRACT(??, ?)', [column, jsonPath]);
  }

  /** Builds a JSON object using JSON_OBJECT(). */
  jsonBuildObject(fields: Record<string, any>): Knex.Raw {
    const knex = this.getKnex();
    const keys = Object.keys(fields);
    const values = Object.values(fields);

    // Build arguments array: [key1, value1, key2, value2, ...]
    const args: any[] = [];
    keys.forEach((key, i) => {
      args.push(key);
      args.push(values[i]);
    });

    // Create placeholders for JSON_OBJECT(?, ?, ?, ?, ...)
    const placeholders = args.map(() => '?').join(', ');
    return knex.raw(`JSON_OBJECT(${placeholders})`, args);
  }

  /** Returns current Unix timestamp using UNIX_TIMESTAMP(). */
  currentTimestamp(): Knex.Raw {
    return this.getKnex().raw('UNIX_TIMESTAMP()');
  }

  /** Converts Unix epoch to datetime using FROM_UNIXTIME(). */
  fromUnixEpoch(epochColumn: string): Knex.Raw {
    return this.getKnex().raw('FROM_UNIXTIME(??)', [epochColumn]);
  }

  /** Converts datetime to Unix epoch using UNIX_TIMESTAMP(). */
  toUnixEpoch(timestampColumn: string): Knex.Raw {
    return this.getKnex().raw('UNIX_TIMESTAMP(??)', [timestampColumn]);
  }

  /** Concatenates string values using CONCAT(). */
  concat(...values: Array<string | Knex.Raw>): Knex.Raw {
    const knex = this.getKnex();
    const placeholders = values.map(() => '?').join(', ');
    return knex.raw(`CONCAT(${placeholders})`, values);
  }

  /** Aggregates strings with separator using GROUP_CONCAT(). */
  stringAgg(column: string, separator: string = ','): Knex.Raw {
    return this.getKnex().raw('GROUP_CONCAT(?? SEPARATOR ?)', [column, separator]);
  }

  /** Executes a callback within a MySQL transaction. */
  async transaction<T>(
    callback: (trx: Knex.Transaction) => Promise<T>,
    options?: { isolationLevel?: 'serializable' | 'read committed' | 'repeatable read' }
  ): Promise<T> {
    return super.transaction(callback, options);
  }

  /** Creates a savepoint within a transaction. */
  async savepoint<T>(
    trx: Knex.Transaction,
    callback: (sp: Knex.Transaction) => Promise<T>
  ): Promise<T> {
    return trx.savepoint(callback);
  }

  /** Checks if a table exists via INFORMATION_SCHEMA. */
  async tableExists(tableName: string): Promise<boolean> {
    const knex = this.getKnex();
    const database = this.config.connection!.database;

    const result = await knex.raw(
      `SELECT TABLE_NAME
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = ?`,
      [database, tableName]
    );

    return result[0].length > 0;
  }

  /** Adds an auto-increment primary key column (UNSIGNED INT). */
  autoIncrementColumn(table: Knex.CreateTableBuilder, columnName: string = 'id'): void {
    // Use increments() which creates UNSIGNED INT AUTO_INCREMENT PRIMARY KEY
    table.increments(columnName).unsigned();
  }
}
