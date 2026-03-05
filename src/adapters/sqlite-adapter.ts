// src/adapters/sqlite-adapter.ts
import knexLib from 'knex';
import type { Knex } from 'knex';
import { BaseAdapter } from './base-adapter.js';
import type { DatabaseConfig } from '../config/types.js';

const { knex } = knexLib;

/** SQLite adapter (file-based, no authentication required). */
export class SQLiteAdapter extends BaseAdapter {
  readonly supportsReturning = false;
  readonly supportsJSON = false;
  readonly supportsUpsert = true;
  readonly supportsCTE = true;
  readonly supportsWindowFunctions = true;
  readonly supportsSavepoints = true;
  readonly databaseName = 'sqlite' as const;

  constructor(config: DatabaseConfig) {
    super(config);
  }

  getDialect(): string {
    return 'better-sqlite3';
  }

  /** Initializes SQLite-specific settings (PRAGMA configuration). */
  async initialize(): Promise<void> {
    const knex = this.getKnex();

    // Configure SQLite pragmas for optimal performance and safety
    await knex.raw('PRAGMA journal_mode = WAL');
    await knex.raw('PRAGMA foreign_keys = ON');
    await knex.raw('PRAGMA synchronous = NORMAL');
    await knex.raw('PRAGMA busy_timeout = 5000');
  }

  /** Establishes SQLite connection (bypasses auth flow). */
  async connect(config?: Knex.Config): Promise<Knex> {
    // Return existing connection if already established
    if (this.knexInstance) {
      return this.knexInstance;
    }

    // Build configuration
    const connectionConfig = config || {
      client: 'better-sqlite3',
      connection: {
        filename: this.config.connection!.database,
      },
      useNullAsDefault: true,
    };

    // Create Knex instance
    this.knexInstance = knex(connectionConfig);

    // Initialize SQLite settings
    await this.initialize();

    return this.knexInstance;
  }

  /** Closes SQLite connection with WAL checkpoint. */
  async disconnect(): Promise<void> {
    if (this.knexInstance) {
      try {
        // Checkpoint WAL to ensure all changes are written to main database
        await this.knexInstance.raw('PRAGMA wal_checkpoint(TRUNCATE)');
        // Optimize database before closing
        await this.knexInstance.raw('PRAGMA optimize');
      } catch (error) {
        // Ignore errors if WAL mode is not enabled or other pragma failures
      }

      // Force immediate destruction of all connections
      await this.knexInstance.destroy();
      this.knexInstance = null;
    }
  }

  async insertReturning<T extends Record<string, any>>(
    table: string,
    data: Partial<T>
  ): Promise<T> {
    const knex = this.getKnex();
    const [id] = await knex(table).insert(data);
    const result = await knex(table).where({ id }).first();
    if (!result) {
      throw new Error(`Failed to retrieve inserted row from ${table}`);
    }
    return result as T;
  }

  async upsert<T extends Record<string, any>>(
    table: string,
    data: Partial<T>,
    conflictColumns: string[],
    updateColumns?: string[]
  ): Promise<number> {
    const knex = this.getKnex();
    const columnsToUpdate = updateColumns || Object.keys(data).filter(
      key => !conflictColumns.includes(key)
    );

    const updateData = columnsToUpdate.reduce((acc, col) => {
      acc[col] = data[col as keyof T];
      return acc;
    }, {} as Record<string, any>);

    const result = await knex(table)
      .insert(data)
      .onConflict(conflictColumns)
      .merge(updateData);

    return result.length;
  }

  jsonExtract(column: string, path: string): Knex.Raw {
    const knex = this.getKnex();
    const jsonPath = path.startsWith('$') ? path : `$.${path}`;
    return knex.raw(`json_extract(??, ?)`, [column, jsonPath]);
  }

  jsonBuildObject(fields: Record<string, any>): Knex.Raw {
    const knex = this.getKnex();
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const args: any[] = [];
    keys.forEach((key, i) => {
      args.push(key);
      args.push(values[i]);
    });
    const placeholders = args.map(() => '?').join(', ');
    return knex.raw(`json_object(${placeholders})`, args);
  }

  currentTimestamp(): Knex.Raw {
    return this.getKnex().raw('unixepoch()');
  }

  fromUnixEpoch(epochColumn: string): Knex.Raw {
    return this.getKnex().raw(`datetime(??, 'unixepoch')`, [epochColumn]);
  }

  toUnixEpoch(timestampColumn: string): Knex.Raw {
    return this.getKnex().raw(`strftime('%s', ??)`, [timestampColumn]);
  }

  concat(...values: Array<string | Knex.Raw>): Knex.Raw {
    const knex = this.getKnex();
    const placeholders = values.map(() => '??').join(' || ');
    return knex.raw(placeholders, values);
  }

  stringAgg(column: string, separator: string = ','): Knex.Raw {
    return this.getKnex().raw(`GROUP_CONCAT(??, ?)`, [column, separator]);
  }

  async transaction<T>(
    callback: (trx: Knex.Transaction) => Promise<T>,
    options?: { isolationLevel?: 'serializable' | 'read committed' | 'repeatable read' }
  ): Promise<T> {
    return this.getKnex().transaction(callback);
  }

  async savepoint<T>(
    trx: Knex.Transaction,
    callback: (sp: Knex.Transaction) => Promise<T>
  ): Promise<T> {
    return trx.savepoint(callback);
  }

  async tableExists(tableName: string): Promise<boolean> {
    const result = await this.getKnex().raw(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      [tableName]
    );
    return result.length > 0;
  }

  autoIncrementColumn(table: Knex.CreateTableBuilder, columnName: string = 'id'): void {
    table.increments(columnName);
  }
}
