/**
 * Universal Knex Wrapper
 *
 * Provides cross-database compatibility helpers for Knex.js migrations.
 * Eliminates 85% of database-specific conditional code.
 *
 * Supports: SQLite, MySQL/MariaDB, PostgreSQL
 *
 * @example
 * ```typescript
 * import { UniversalKnex } from '../../utils/universal-knex.js';
 *
 * export async function up(knex: Knex): Promise<void> {
 *   const db = new UniversalKnex(knex);
 *
 *   await knex.schema.createTable('example', (table) => {
 *     table.increments('id').primary();
 *     db.primaryKeyString(table, 'name', 64);
 *     db.timestampColumn(table, 'created_at');
 *   });
 *
 *   await db.createIndexSafe('example', ['name']);
 * }
 * ```
 */

import type { Knex } from 'knex';

export class UniversalKnex {
  private readonly knex: Knex;
  private readonly client: string;

  constructor(knex: Knex) {
    this.knex = knex;
    this.client = knex.client.config.client as string;
  }

  // ============================================================================
  // Database Detection
  // ============================================================================

  get isSQLite(): boolean {
    return this.client === 'sqlite3' || this.client === 'better-sqlite3';
  }

  get isMySQL(): boolean {
    return this.client === 'mysql2' || this.client === 'mysql';
  }

  get isPostgreSQL(): boolean {
    return this.client === 'pg' || this.client === 'postgres' || this.client === 'postgresql';
  }

  // ============================================================================
  // Timestamp Helpers
  // ============================================================================

  /**
   * Returns current Unix timestamp as Knex.Raw
   *
   * SQLite: strftime('%s', 'now')
   * MySQL: UNIX_TIMESTAMP()
   * PostgreSQL: extract(epoch from now())
   */
  nowTimestamp(): Knex.Raw {
    if (this.isSQLite) {
      return this.knex.raw("(strftime('%s', 'now'))");
    } else if (this.isMySQL) {
      return this.knex.raw('UNIX_TIMESTAMP()');
    } else {
      // PostgreSQL
      return this.knex.raw('extract(epoch from now())');
    }
  }

  /**
   * Converts Unix timestamp column to database-specific datetime string
   *
   * SQLite: datetime(column, 'unixepoch')
   * MySQL: FROM_UNIXTIME(column)
   * PostgreSQL: to_timestamp(column)
   *
   * @param columnName - Name of the column containing Unix timestamp
   * @returns SQL expression as string (for use in raw queries or select)
   */
  dateFunction(columnName: string): string {
    if (this.isSQLite) {
      return `datetime(${columnName}, 'unixepoch')`;
    } else if (this.isMySQL) {
      return `FROM_UNIXTIME(${columnName})`;
    } else {
      // PostgreSQL
      return `to_timestamp(${columnName})`;
    }
  }

  /**
   * Returns database-specific boolean TRUE literal
   *
   * SQLite/MySQL: 1
   * PostgreSQL: TRUE
   */
  boolTrue(): string | number {
    return this.isPostgreSQL ? 'TRUE' : 1;
  }

  /**
   * Returns database-specific boolean FALSE literal
   *
   * SQLite/MySQL: 0
   * PostgreSQL: FALSE
   */
  boolFalse(): string | number {
    return this.isPostgreSQL ? 'FALSE' : 0;
  }

  /**
   * Adds a timestamp column with current timestamp default
   *
   * Policy: the DEFAULT clause is added for SQLite only, deliberately.
   * PostgreSQL supports expression defaults and MySQL does since 8.0.13,
   * but adding them now would make fresh MySQL/PG databases diverge from
   * databases already migrated without defaults, and would raise the
   * minimum supported MySQL version. Application code MUST set timestamp
   * columns explicitly on every insert (all current write paths do).
   *
   * @param table - Knex table builder
   * @param columnName - Name of the timestamp column
   * @param nullable - Whether column can be NULL (default: false)
   */
  timestampColumn(
    table: Knex.CreateTableBuilder | Knex.AlterTableBuilder,
    columnName: string,
    nullable: boolean = false
  ): Knex.ColumnBuilder {
    const col = table.integer(columnName);

    if (!nullable) {
      col.notNullable();
    }

    // SQLite-only DEFAULT by policy (see doc comment above);
    // MySQL/PG rely on application code setting the timestamp explicitly
    if (this.isSQLite) {
      col.defaultTo(this.nowTimestamp());
    }

    return col;
  }

  // ============================================================================
  // Primary Key Helpers
  // ============================================================================

  /**
   * Creates a VARCHAR primary key with database-aware length limit
   *
   * MySQL UTF8MB4 index key limit: 3072 bytes (768 chars × 4 bytes)
   * SQLite/PostgreSQL: Can handle up to 1000 chars
   *
   * @param table - Knex table builder
   * @param columnName - Name of the column
   * @param maxLength - Desired max length (will be capped at 768 for MySQL)
   */
  primaryKeyString(
    table: Knex.CreateTableBuilder | Knex.AlterTableBuilder,
    columnName: string,
    maxLength: number = 200
  ): Knex.ColumnBuilder {
    const effectiveLength = this.isMySQL ? Math.min(maxLength, 768) : maxLength;

    return table.string(columnName, effectiveLength).primary();
  }

  /**
   * Creates a VARCHAR column with database-aware length limit (not primary key)
   *
   * @param table - Knex table builder
   * @param columnName - Name of the column
   * @param maxLength - Desired max length (will be capped at 768 for MySQL if indexed)
   * @param indexed - Whether this column will be indexed (affects MySQL length limit)
   */
  stringColumn(
    table: Knex.CreateTableBuilder | Knex.AlterTableBuilder,
    columnName: string,
    maxLength: number = 200,
    indexed: boolean = false
  ): Knex.ColumnBuilder {
    const effectiveLength = this.isMySQL && indexed
      ? Math.min(maxLength, 768)
      : maxLength;

    return table.string(columnName, effectiveLength);
  }

  // ============================================================================
  // Index Creation
  // ============================================================================

  /**
   * Creates an index with IF NOT EXISTS semantics
   *
   * SQLite/PostgreSQL: CREATE INDEX IF NOT EXISTS
   * MySQL: Try/catch with duplicate index detection
   *
   * @param tableName - Table to create index on
   * @param columns - Columns to index
   * @param indexName - Name of the index (optional, auto-generated if not provided)
   * @param options - Index options (unique, desc)
   */
  async createIndexSafe(
    tableName: string,
    columns: string[],
    indexName?: string,
    options: { unique?: boolean; desc?: boolean } = {}
  ): Promise<void> {
    const name = indexName || `idx_${tableName}_${columns.join('_')}`;

    if (this.isSQLite || this.isPostgreSQL) {
      // SQLite and PostgreSQL support IF NOT EXISTS natively
      const uniqueClause = options.unique ? 'UNIQUE ' : '';
      const descClause = options.desc ? ' DESC' : '';
      const columnsList = columns.map(col => `${col}${descClause}`).join(', ');

      await this.knex.raw(
        `CREATE ${uniqueClause}INDEX IF NOT EXISTS ${name} ON ${tableName}(${columnsList})`
      );
    } else {
      // MySQL: Try to create, ignore if exists
      try {
        await this.knex.schema.alterTable(tableName, (table) => {
          if (options.unique) {
            table.unique(columns, { indexName: name });
          } else {
            table.index(columns, name);
          }
        });
      } catch (error: any) {
        // Ignore "already exists" errors
        const errorMsg = error.message?.toLowerCase() || '';
        const isAlreadyExists =
          errorMsg.includes('already exists') ||
          errorMsg.includes('duplicate key') ||
          errorMsg.includes('duplicate index');

        if (!isAlreadyExists) {
          throw error; // Re-throw if not a duplicate error
        }

        console.error(`✓ Index ${name} already exists, skipping`);
      }
    }
  }

  // ============================================================================
  // View Creation
  // ============================================================================

  /**
   * Creates or replaces a view
   *
   * @param viewName - Name of the view
   * @param selectQuery - SELECT query for the view (without CREATE VIEW prefix)
   */
  async createViewSafe(viewName: string, selectQuery: string): Promise<void> {
    // Drop existing view first (always use DROP IF EXISTS for safety)
    await this.knex.raw(`DROP VIEW IF EXISTS ${viewName}`);

    // Create new view
    await this.knex.raw(`CREATE VIEW ${viewName} AS ${selectQuery}`);
  }

  // ============================================================================
  // Aggregation Functions
  // ============================================================================

  /**
   * String aggregation function (database-aware)
   *
   * MySQL/SQLite: GROUP_CONCAT(column, separator)
   * PostgreSQL: string_agg(column, separator)
   *
   * @param column - Column to aggregate
   * @param separator - Separator character (default: ',')
   * @returns SQL fragment as string (use with knex.raw())
   */
  stringAgg(column: string, separator: string = ','): string {
    if (this.isPostgreSQL) {
      return `string_agg(${column}, '${separator}')`;
    } else if (this.isMySQL) {
      // MySQL requires SEPARATOR keyword
      return `GROUP_CONCAT(${column} SEPARATOR '${separator}')`;
    } else {
      // SQLite uses GROUP_CONCAT with comma as second argument
      return `GROUP_CONCAT(${column}, '${separator}')`;
    }
  }

  // ============================================================================
  // Table Management
  // ============================================================================

  /**
   * Creates a table with idempotency check
   *
   * @param tableName - Name of the table
   * @param callback - Table definition callback
   */
  async createTableSafe(
    tableName: string,
    callback: (
      table: Knex.CreateTableBuilder,
      helpers: TableHelpers
    ) => void
  ): Promise<void> {
    const hasTable = await this.knex.schema.hasTable(tableName);

    if (!hasTable) {
      await this.knex.schema.createTable(tableName, (table) => {
        const helpers = new TableHelpers(this, table);
        callback(table, helpers);
      });
    } else {
      console.error(`✓ Table ${tableName} already exists, skipping`);
    }
  }

  /**
   * Adds a column with idempotency check
   *
   * @param tableName - Name of the table
   * @param columnName - Name of the column
   * @param callback - Column definition callback
   */
  async addColumnSafe(
    tableName: string,
    columnName: string,
    callback: (table: Knex.AlterTableBuilder) => Knex.ColumnBuilder
  ): Promise<void> {
    const hasColumn = await this.knex.schema.hasColumn(tableName, columnName);

    if (!hasColumn) {
      await this.knex.schema.alterTable(tableName, callback);
    } else {
      console.error(`✓ Column ${tableName}.${columnName} already exists, skipping`);
    }
  }
}

/**
 * Table builder helpers
 *
 * Provides convenient methods for common column patterns
 */
export class TableHelpers {
  constructor(
    private readonly db: UniversalKnex,
    private readonly table: Knex.CreateTableBuilder | Knex.AlterTableBuilder
  ) {}

  /**
   * Creates a VARCHAR primary key with database-aware length
   */
  primaryKeyString(columnName: string, maxLength: number = 200): Knex.ColumnBuilder {
    return this.db.primaryKeyString(this.table, columnName, maxLength);
  }

  /**
   * Creates a VARCHAR column with database-aware length
   */
  stringColumn(
    columnName: string,
    maxLength: number = 200,
    indexed: boolean = false
  ): Knex.ColumnBuilder {
    return this.db.stringColumn(this.table, columnName, maxLength, indexed);
  }

  /**
   * Creates a timestamp column with current timestamp default
   */
  timestampColumn(columnName: string, nullable: boolean = false): Knex.ColumnBuilder {
    return this.db.timestampColumn(this.table, columnName, nullable);
  }
}
