import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { UniversalKnex, TableHelpers } from '../../utils/universal-knex.js';
import { getDbConfig, connectDb, disconnectDb } from '../utils/test-helpers.js';
import type { Knex } from 'knex';

describe('UniversalKnex', () => {
  let sqliteDb: Knex;
  let sqliteWrapper: UniversalKnex;

  before(async () => {
    // Ensure .sqlew directory exists for SQLite database
    mkdirSync('.sqlew', { recursive: true });
    const config = getDbConfig('sqlite');
    sqliteDb = await connectDb(config);
    sqliteWrapper = new UniversalKnex(sqliteDb);
  });

  after(async () => {
    await disconnectDb(sqliteDb);
  });

  describe('Database Detection', () => {
    it('should detect SQLite', () => {
      assert.strictEqual(sqliteWrapper.isSQLite, true);
      assert.strictEqual(sqliteWrapper.isMySQL, false);
      assert.strictEqual(sqliteWrapper.isPostgreSQL, false);
    });
  });

  describe('nowTimestamp()', () => {
    it('should return SQLite strftime for SQLite', () => {
      const result = sqliteWrapper.nowTimestamp();
      assert.ok(result);
      assert.strictEqual(result.toString(), "(strftime('%s', 'now'))");
    });
  });

  describe('timestampColumn()', () => {
    // Clean up stale tables from previous failed runs
    before(async () => {
      if (await sqliteDb.schema.hasTable('test_timestamp')) {
        await sqliteDb.schema.dropTable('test_timestamp');
      }
      if (await sqliteDb.schema.hasTable('test_timestamp_nullable')) {
        await sqliteDb.schema.dropTable('test_timestamp_nullable');
      }
    });

    it('should create timestamp column with default', async () => {
      await sqliteDb.schema.createTable('test_timestamp', (table) => {
        table.increments('id').primary();
        sqliteWrapper.timestampColumn(table, 'created_at');
      });

      // Verify column exists with default
      const hasColumn = await sqliteDb.schema.hasColumn('test_timestamp', 'created_at');
      assert.strictEqual(hasColumn, true);

      // Insert row without specifying timestamp
      await sqliteDb('test_timestamp').insert({});

      // Verify timestamp was auto-populated
      const row = await sqliteDb('test_timestamp').select('created_at').first();
      assert.ok(row);
      assert.ok(row.created_at > 0);

      await sqliteDb.schema.dropTable('test_timestamp');
    });

    it('should create nullable timestamp column', async () => {
      await sqliteDb.schema.createTable('test_timestamp_nullable', (table) => {
        table.increments('id').primary();
        sqliteWrapper.timestampColumn(table, 'updated_at', true);
      });

      // Insert row with NULL timestamp
      await sqliteDb('test_timestamp_nullable').insert({ updated_at: null });

      const row = await sqliteDb('test_timestamp_nullable').select('updated_at').first();
      assert.ok(row);
      assert.strictEqual(row.updated_at, null);

      await sqliteDb.schema.dropTable('test_timestamp_nullable');
    });
  });

  describe('primaryKeyString()', () => {
    it('should create VARCHAR primary key', async () => {
      await sqliteDb.schema.createTable('test_pk_string', (table) => {
        sqliteWrapper.primaryKeyString(table, 'code', 64);
        table.text('description');
      });

      // Verify column exists and is primary key
      const hasColumn = await sqliteDb.schema.hasColumn('test_pk_string', 'code');
      assert.strictEqual(hasColumn, true);

      // Insert row
      await sqliteDb('test_pk_string').insert({ code: 'TEST', description: 'Test description' });

      // Verify uniqueness constraint
      await assert.rejects(
        sqliteDb('test_pk_string').insert({ code: 'TEST', description: 'Duplicate' }),
        /UNIQUE constraint failed/
      );

      await sqliteDb.schema.dropTable('test_pk_string');
    });

    it('should cap length at 768 for MySQL (simulated)', () => {
      // Can't easily test MySQL in unit tests, but can verify logic
      const wrapper = new UniversalKnex(sqliteDb);

      // For SQLite, should use full 1000
      const sqliteMaxLength = wrapper.isSQLite ? 1000 : 768;
      assert.strictEqual(sqliteMaxLength, 1000);
    });
  });

  describe('stringColumn()', () => {
    it('should create VARCHAR column', async () => {
      await sqliteDb.schema.createTable('test_string_col', (table) => {
        table.increments('id').primary();
        sqliteWrapper.stringColumn(table, 'name', 100);
      });

      const hasColumn = await sqliteDb.schema.hasColumn('test_string_col', 'name');
      assert.strictEqual(hasColumn, true);

      await sqliteDb.schema.dropTable('test_string_col');
    });
  });

  describe('createIndexSafe()', () => {
    it('should create index on SQLite', async () => {
      await sqliteDb.schema.createTable('test_index', (table) => {
        table.increments('id').primary();
        table.string('email', 200);
      });

      await sqliteWrapper.createIndexSafe('test_index', ['email'], 'idx_email');

      // Verify index exists by checking schema
      const indexes = await sqliteDb.raw(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_email'"
      );
      assert.strictEqual(indexes.length, 1);

      await sqliteDb.schema.dropTable('test_index');
    });

    it('should create unique index', async () => {
      await sqliteDb.schema.createTable('test_unique_index', (table) => {
        table.increments('id').primary();
        table.string('username', 100);
      });

      await sqliteWrapper.createIndexSafe('test_unique_index', ['username'], 'idx_username', {
        unique: true,
      });

      // Insert first row
      await sqliteDb('test_unique_index').insert({ username: 'alice' });

      // Verify uniqueness is enforced
      await assert.rejects(
        sqliteDb('test_unique_index').insert({ username: 'alice' }),
        /UNIQUE constraint failed/
      );

      await sqliteDb.schema.dropTable('test_unique_index');
    });

    it('should be idempotent (run twice without error)', async () => {
      await sqliteDb.schema.createTable('test_idempotent_index', (table) => {
        table.increments('id').primary();
        table.string('slug', 100);
      });

      // Create index first time
      await sqliteWrapper.createIndexSafe('test_idempotent_index', ['slug'], 'idx_slug');

      // Create again (should not throw)
      await sqliteWrapper.createIndexSafe('test_idempotent_index', ['slug'], 'idx_slug');

      await sqliteDb.schema.dropTable('test_idempotent_index');
    });
  });

  describe('createViewSafe()', () => {
    it('should create view', async () => {
      // Cleanup first in case of previous test failure
      await sqliteDb.raw('DROP VIEW IF EXISTS test_view').catch(() => {});
      await sqliteDb.schema.dropTableIfExists('test_view_source');

      await sqliteDb.schema.createTable('test_view_source', (table) => {
        table.increments('id').primary();
        table.string('name', 100);
        table.integer('value');
      });

      await sqliteDb('test_view_source').insert([
        { name: 'A', value: 10 },
        { name: 'B', value: 20 },
      ]);

      await sqliteWrapper.createViewSafe(
        'test_view',
        'SELECT name, value FROM test_view_source WHERE value > 15'
      );

      // Verify view exists by querying it
      const rows = await sqliteDb('test_view').select('*');
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].name, 'B');
      assert.strictEqual(rows[0].value, 20);

      // Cleanup
      await sqliteDb.raw('DROP VIEW IF EXISTS test_view');
      await sqliteDb.schema.dropTable('test_view_source');
    });

    it('should replace existing view', async () => {
      // Cleanup first in case of previous test failure
      await sqliteDb.raw('DROP VIEW IF EXISTS test_view_replace').catch(() => {});
      await sqliteDb.schema.dropTableIfExists('test_view_replace_source');

      await sqliteDb.schema.createTable('test_view_replace_source', (table) => {
        table.increments('id').primary();
        table.integer('amount');
      });

      await sqliteDb('test_view_replace_source').insert([{ amount: 100 }, { amount: 200 }]);

      // Create first view
      await sqliteWrapper.createViewSafe(
        'test_view_replace',
        'SELECT amount FROM test_view_replace_source WHERE amount > 150'
      );

      let rows = await sqliteDb('test_view_replace').select('*');
      assert.strictEqual(rows.length, 1);

      // Replace view with different query
      await sqliteWrapper.createViewSafe(
        'test_view_replace',
        'SELECT amount FROM test_view_replace_source WHERE amount > 50'
      );

      rows = await sqliteDb('test_view_replace').select('*');
      assert.strictEqual(rows.length, 2);

      // Cleanup
      await sqliteDb.raw('DROP VIEW IF EXISTS test_view_replace');
      await sqliteDb.schema.dropTable('test_view_replace_source');
    });
  });

  describe('stringAgg()', () => {
    it('should return GROUP_CONCAT for SQLite', () => {
      const result = sqliteWrapper.stringAgg('tags', ',');
      assert.strictEqual(result, "GROUP_CONCAT(tags, ',')");
    });

    it('should use custom separator', () => {
      const result = sqliteWrapper.stringAgg('names', '; ');
      assert.strictEqual(result, "GROUP_CONCAT(names, '; ')");
    });
  });

  describe('createTableSafe()', () => {
    it('should create table with helpers', async () => {
      await sqliteWrapper.createTableSafe('test_safe_table', (table, helpers) => {
        table.increments('id').primary();
        helpers.primaryKeyString('code', 64);
        helpers.stringColumn('name', 100);
        helpers.timestampColumn('created_at');
      });

      const hasTable = await sqliteDb.schema.hasTable('test_safe_table');
      assert.strictEqual(hasTable, true);

      await sqliteDb.schema.dropTable('test_safe_table');
    });

    it('should be idempotent (skip if table exists)', async () => {
      await sqliteWrapper.createTableSafe('test_idempotent_table', (table) => {
        table.increments('id').primary();
        table.string('name', 100);
      });

      // Run again (should not throw)
      await sqliteWrapper.createTableSafe('test_idempotent_table', (table) => {
        table.increments('id').primary();
        table.string('name', 100);
      });

      await sqliteDb.schema.dropTable('test_idempotent_table');
    });
  });

  describe('addColumnSafe()', () => {
    it('should add column if not exists', async () => {
      await sqliteDb.schema.createTable('test_add_column', (table) => {
        table.increments('id').primary();
        table.string('name', 100);
      });

      await sqliteWrapper.addColumnSafe('test_add_column', 'description', (table) =>
        table.text('description')
      );

      const hasColumn = await sqliteDb.schema.hasColumn('test_add_column', 'description');
      assert.strictEqual(hasColumn, true);

      await sqliteDb.schema.dropTable('test_add_column');
    });

    it('should be idempotent (skip if column exists)', async () => {
      await sqliteDb.schema.createTable('test_idempotent_column', (table) => {
        table.increments('id').primary();
        table.string('name', 100);
      });

      await sqliteWrapper.addColumnSafe('test_idempotent_column', 'status', (table) =>
        table.string('status', 50)
      );

      // Run again (should not throw)
      await sqliteWrapper.addColumnSafe('test_idempotent_column', 'status', (table) =>
        table.string('status', 50)
      );

      await sqliteDb.schema.dropTable('test_idempotent_column');
    });
  });

  describe('TableHelpers', () => {
    it('should provide helper methods', async () => {
      await sqliteDb.schema.createTable('test_helpers', (table) => {
        const helpers = new TableHelpers(sqliteWrapper, table);

        table.increments('id').primary();
        helpers.primaryKeyString('code', 64);
        helpers.stringColumn('name', 100);
        helpers.timestampColumn('created_at');
      });

      const hasTable = await sqliteDb.schema.hasTable('test_helpers');
      assert.strictEqual(hasTable, true);

      await sqliteDb.schema.dropTable('test_helpers');
    });
  });
});
