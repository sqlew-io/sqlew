/**
 * v5.4: Drop unused t_token_usage table
 *
 * The table was created to record per-tool token consumption, but the
 * feature never worked: the only writer (src/utils/token-logging.ts)
 * inserted v3-era column names that do not exist in the current schema,
 * and nothing ever called it. The table is therefore empty in every
 * database and is removed together with the dead logging code.
 *
 * Indexes (idx_token_usage_ts, idx_token_usage_tool) are dropped
 * automatically with the table.
 *
 * IDEMPOTENT: Can be run multiple times safely.
 * SQLite, MySQL, PostgreSQL compatible.
 */

import type { Knex } from 'knex';

const TABLES_TO_DROP = [
  't_token_usage',
];

export async function up(knex: Knex): Promise<void> {
  console.error('🔄 v5.4: Dropping unused t_token_usage table...');

  for (const tableName of TABLES_TO_DROP) {
    try {
      const exists = await knex.schema.hasTable(tableName);
      if (exists) {
        await knex.schema.dropTable(tableName);
        console.error(`  ✓ Dropped table: ${tableName}`);
      } else {
        console.error(`  ⚠️  Table ${tableName} does not exist, skipping`);
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message?.toLowerCase() : String(error).toLowerCase();
      // Ignore "does not exist" errors (different messages per DB)
      if (
        errorMsg.includes('does not exist') ||
        errorMsg.includes('unknown table') ||
        errorMsg.includes('no such table')
      ) {
        console.error(`  ⚠️  Table ${tableName} does not exist, skipping`);
      } else {
        throw error;
      }
    }
  }

  console.error('✅ t_token_usage dropped');
}

export async function down(knex: Knex): Promise<void> {
  console.error('⚠️  WARNING: t_token_usage will NOT be recreated');
  console.error('   The table was never written to (the logging code was broken');
  console.error('   and unused), so there is no data to restore.');
}
