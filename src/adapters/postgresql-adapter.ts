// src/adapters/postgresql-adapter.ts
import type { Knex } from 'knex';
import { BaseAdapter } from './base-adapter.js';
import type { DatabaseConfig } from '../config/types.js';

/** PostgreSQL adapter with authentication support. */
export class PostgreSQLAdapter extends BaseAdapter {
  readonly supportsReturning = true;
  readonly supportsJSON = true;
  readonly supportsUpsert = true;
  readonly supportsCTE = true;
  readonly supportsWindowFunctions = true;
  readonly supportsSavepoints = true;
  readonly databaseName = 'postgresql' as const;

  constructor(config: DatabaseConfig) {
    super(config);
  }

  getDialect(): string {
    return 'pg';
  }

  /** Initializes PostgreSQL-specific session settings (UTC, timeout, UTF8). */
  async initialize(): Promise<void> {
    const knex = this.getKnex();

    // Validate database exists
    const dbName = this.config.connection?.database;
    if (!dbName) {
      throw new Error('PostgreSQL adapter requires database name in configuration');
    }

    try {
      // Check if we can access the database
      const result = await knex.raw('SELECT current_database() as db');
      const currentDb = result.rows?.[0]?.db;

      if (!currentDb || currentDb !== dbName) {
        throw new Error(
          `Database '${dbName}' does not exist or cannot be accessed. ` +
          `Please create it manually: CREATE DATABASE ${dbName} ENCODING 'UTF8';`
        );
      }
    } catch (error: any) {
      if (error.code === '3D000') {
        // INVALID CATALOG NAME
        throw new Error(
          `Database '${dbName}' does not exist. ` +
          `Please create it manually before connecting.`
        );
      }
      throw error;
    }

    // Set timezone to UTC for consistent timestamp handling
    await knex.raw("SET timezone = 'UTC'");

    // Set statement timeout to prevent long-running queries
    await knex.raw('SET statement_timeout = 30000'); // 30 seconds

    // Ensure UTF8 encoding
    await knex.raw("SET client_encoding = 'UTF8'");
  }

  /** Inserts a row and returns the inserted record using RETURNING clause. */
  async insertReturning<T extends Record<string, any>>(
    table: string,
    data: Partial<T>
  ): Promise<T> {
    const knex = this.getKnex();

    // Use RETURNING * to get the complete inserted row
    const [result] = await knex(table).insert(data).returning('*');

    if (!result) {
      throw new Error(`Failed to insert row into ${table}`);
    }

    return result as T;
  }

  /** Upserts a row using ON CONFLICT ... DO UPDATE. */
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

    // Build update data for DO UPDATE SET clause
    const updateData = columnsToUpdate.reduce((acc, col) => {
      acc[col] = data[col as keyof T];
      return acc;
    }, {} as Record<string, any>);

    // Use Knex's onConflict() which generates ON CONFLICT ... DO UPDATE for PostgreSQL
    const result = await knex(table)
      .insert(data)
      .onConflict(conflictColumns)
      .merge(updateData);

    return result.length;
  }

  /** Extracts a value from a JSONB column using jsonb_extract_path_text(). */
  jsonExtract(column: string, path: string): Knex.Raw {
    const knex = this.getKnex();
    // Split path by '.' and use as separate arguments
    const pathParts = path.replace(/^\$\.?/, '').split('.');
    const placeholders = ['??', ...pathParts.map(() => '?')].join(', ');
    return knex.raw(`jsonb_extract_path_text(${placeholders})`, [column, ...pathParts]);
  }

  /** Builds a JSON object using jsonb_build_object(). */
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

    // Create placeholders for jsonb_build_object(?, ?, ?, ?, ...)
    const placeholders = args.map(() => '?').join(', ');
    return knex.raw(`jsonb_build_object(${placeholders})`, args);
  }

  /** Returns current Unix timestamp using EXTRACT(EPOCH FROM NOW()). */
  currentTimestamp(): Knex.Raw {
    return this.getKnex().raw('EXTRACT(EPOCH FROM NOW())::INTEGER');
  }

  /** Converts Unix epoch to timestamp using TO_TIMESTAMP(). */
  fromUnixEpoch(epochColumn: string): Knex.Raw {
    return this.getKnex().raw('TO_TIMESTAMP(??)', [epochColumn]);
  }

  /** Converts timestamp to Unix epoch using EXTRACT(EPOCH FROM ...). */
  toUnixEpoch(timestampColumn: string): Knex.Raw {
    return this.getKnex().raw('EXTRACT(EPOCH FROM ??)::INTEGER', [timestampColumn]);
  }

  /** Concatenates string values using || operator. */
  concat(...values: Array<string | Knex.Raw>): Knex.Raw {
    const knex = this.getKnex();
    const placeholders = values.map(() => '?').join(' || ');
    return knex.raw(`(${placeholders})`, values);
  }

  /** Aggregates strings with separator using string_agg(). */
  stringAgg(column: string, separator: string = ','): Knex.Raw {
    return this.getKnex().raw('string_agg(??, ?)', [column, separator]);
  }

  /** Executes a callback within a PostgreSQL transaction. */
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

  /** Checks if a table exists via information_schema. */
  async tableExists(tableName: string): Promise<boolean> {
    const knex = this.getKnex();
    const database = this.config.connection!.database;

    const result = await knex.raw(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_catalog = ?
         AND table_name = ?`,
      [database, tableName]
    );

    return result.rows.length > 0;
  }

  /** Adds a serial auto-increment primary key column. */
  autoIncrementColumn(table: Knex.CreateTableBuilder, columnName: string = 'id'): void {
    // Use increments() which creates SERIAL PRIMARY KEY for PostgreSQL
    table.increments(columnName);
  }
}
