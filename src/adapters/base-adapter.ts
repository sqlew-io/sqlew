import knexLib from 'knex';
import type { Knex } from 'knex';
import type { DatabaseAdapter } from './types.js';
import type { DatabaseConfig } from '../config/types.js';
import { createAuthProvider } from './auth/auth-factory.js';
import type { BaseAuthProvider, ConnectionParams } from './auth/base-auth-provider.js';

const { knex } = knexLib;

/** Abstract base class for database adapters with authentication integration. */
export abstract class BaseAdapter implements DatabaseAdapter {
  /** @protected */
  protected readonly config: DatabaseConfig;

  /** @protected */
  protected authProvider: BaseAuthProvider | null = null;

  /** @protected */
  protected knexInstance: Knex | null = null;

  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  /** Performs adapter-specific initialization after connection is established. @abstract */
  abstract initialize(): Promise<void>;

  /** Returns the Knex dialect identifier for this database. @abstract */
  abstract getDialect(): string;

  /** Whether this database supports RETURNING clause. @abstract */
  abstract readonly supportsReturning: boolean;

  /** Whether this database has native JSON support. @abstract */
  abstract readonly supportsJSON: boolean;

  /** Whether this database supports UPSERT operations. @abstract */
  abstract readonly supportsUpsert: boolean;

  /** Whether this database supports Common Table Expressions. @abstract */
  abstract readonly supportsCTE: boolean;

  /** Whether this database supports window functions. @abstract */
  abstract readonly supportsWindowFunctions: boolean;

  /** Whether this database supports savepoints within transactions. @abstract */
  abstract readonly supportsSavepoints: boolean;

  /** Database name identifier. @abstract */
  abstract readonly databaseName: 'sqlite' | 'postgresql' | 'mysql';

  /** Establishes database connection with authentication. */
  async connect(): Promise<Knex> {
    // Idempotent: return existing connection if already established
    if (this.knexInstance) {
      return this.knexInstance;
    }

    // Create authentication provider (null for SQLite)
    this.authProvider = createAuthProvider(this.config);

    // Authenticate and get connection parameters
    let connParams: ConnectionParams | null = null;

    if (this.authProvider !== null) {
      // Validate authentication configuration
      this.authProvider.validate();

      // Authenticate to get connection parameters
      connParams = await this.authProvider.authenticate();
    }

    // Build Knex configuration
    const knexConfig = this.buildKnexConfig(connParams);

    // Create Knex instance
    this.knexInstance = knex(knexConfig);

    // Perform adapter-specific initialization
    await this.initialize();

    return this.knexInstance;
  }

  /** Closes the database connection. */
  async disconnect(): Promise<void> {
    if (this.knexInstance) {
      await this.knexInstance.destroy();
      this.knexInstance = null;
    }
  }

  /** Releases authentication provider resources. */
  async cleanup(): Promise<void> {
    if (this.authProvider) {
      try {
        await this.authProvider.cleanup();
      } catch (error) {
        // Log cleanup errors but don't throw - connection is already closed
        console.error('Auth provider cleanup failed:', error);
      }
      this.authProvider = null;
    }
  }

  /** Returns the Knex.js instance for database operations. */
  getKnex(): Knex {
    if (!this.knexInstance) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.knexInstance;
  }

  /** Executes a callback within a database transaction. */
  async transaction<T>(
    callback: (trx: Knex.Transaction) => Promise<T>,
    options?: {
      isolationLevel?: 'serializable' | 'read committed' | 'repeatable read';
    }
  ): Promise<T> {
    const knex = this.getKnex();
    return await knex.transaction(callback, options);
  }

  /** Builds Knex configuration from connection parameters. @protected */
  protected buildKnexConfig(connParams: ConnectionParams | null): Knex.Config {
    if (!connParams) {
      // SQLite or other file-based databases
      return {
        client: this.getDialect(),
        connection: {
          filename: this.config.connection!.database,
        },
        useNullAsDefault: true,
      };
    }

    // Client-server databases with authentication
    const connectionConfig: any = {
      host: connParams.host,
      port: connParams.port,
      database: connParams.database,
      user: connParams.user,
    };

    // Add password if present
    if (connParams.password) {
      connectionConfig.password = connParams.password;
    }

    // Add SSL configuration if present
    if (connParams.ssl) {
      connectionConfig.ssl = connParams.ssl;
    }

    // Merge additional parameters
    if (connParams.additionalParams) {
      Object.assign(connectionConfig, connParams.additionalParams);
    }

    return {
      client: this.getDialect(),
      connection: connectionConfig,
      useNullAsDefault: this.getDialect() === 'sqlite3',
    };
  }

  /** Inserts a row and returns the inserted record. @abstract */
  abstract insertReturning<T extends Record<string, any>>(
    table: string,
    data: Partial<T>
  ): Promise<T>;

  /** Upserts a row (INSERT ... ON CONFLICT UPDATE). @abstract */
  abstract upsert<T extends Record<string, any>>(
    table: string,
    data: Partial<T>,
    conflictColumns: string[],
    updateColumns?: string[]
  ): Promise<number>;

  /** Extracts a value from a JSON column. @abstract */
  abstract jsonExtract(column: string, path: string): Knex.Raw;

  /** Builds a JSON object from field values. @abstract */
  abstract jsonBuildObject(fields: Record<string, any>): Knex.Raw;

  /** Returns current timestamp expression. @abstract */
  abstract currentTimestamp(): Knex.Raw;

  /** Converts Unix epoch to datetime. @abstract */
  abstract fromUnixEpoch(epochColumn: string): Knex.Raw;

  /** Converts datetime to Unix epoch. @abstract */
  abstract toUnixEpoch(timestampColumn: string): Knex.Raw;

  /** Concatenates string values. @abstract */
  abstract concat(...values: Array<string | Knex.Raw>): Knex.Raw;

  /** Aggregates strings with separator. @abstract */
  abstract stringAgg(column: string, separator?: string): Knex.Raw;

  /** Creates a savepoint within a transaction. @abstract */
  abstract savepoint<T>(
    trx: Knex.Transaction,
    callback: (sp: Knex.Transaction) => Promise<T>
  ): Promise<T>;

  /** Checks if a table exists in the database. @abstract */
  abstract tableExists(tableName: string): Promise<boolean>;

  /** Adds an auto-increment column to a table builder. @abstract */
  abstract autoIncrementColumn(
    table: Knex.CreateTableBuilder,
    columnName?: string
  ): void;
}
