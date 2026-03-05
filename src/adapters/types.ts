// src/adapters/types.ts
import { Knex } from 'knex';

/** Database adapter interface for cross-RDBMS compatibility. */
export interface DatabaseAdapter {
  // Connection Management
  connect(config: Knex.Config): Promise<Knex>;
  disconnect(): Promise<void>;
  getKnex(): Knex;

  // Feature Detection
  readonly supportsReturning: boolean;
  readonly supportsJSON: boolean;
  readonly supportsUpsert: boolean;
  readonly supportsCTE: boolean;
  readonly supportsWindowFunctions: boolean;
  readonly supportsSavepoints: boolean;
  readonly databaseName: 'sqlite' | 'postgresql' | 'mysql';

  // Query Adaptations
  insertReturning<T extends Record<string, any>>(
    table: string,
    data: Partial<T>
  ): Promise<T>;

  upsert<T extends Record<string, any>>(
    table: string,
    data: Partial<T>,
    conflictColumns: string[],
    updateColumns?: string[]
  ): Promise<number>;

  jsonExtract(column: string, path: string): Knex.Raw;
  jsonBuildObject(fields: Record<string, any>): Knex.Raw;
  currentTimestamp(): Knex.Raw;
  fromUnixEpoch(epochColumn: string): Knex.Raw;
  toUnixEpoch(timestampColumn: string): Knex.Raw;
  concat(...values: Array<string | Knex.Raw>): Knex.Raw;
  stringAgg(column: string, separator?: string): Knex.Raw;

  // Transaction Helpers
  transaction<T>(
    callback: (trx: Knex.Transaction) => Promise<T>,
    options?: {
      isolationLevel?: 'serializable' | 'read committed' | 'repeatable read';
    }
  ): Promise<T>;

  savepoint<T>(
    trx: Knex.Transaction,
    callback: (sp: Knex.Transaction) => Promise<T>
  ): Promise<T>;

  // Schema Management
  tableExists(tableName: string): Promise<boolean>;
  autoIncrementColumn(table: Knex.CreateTableBuilder, columnName?: string): void;
}
