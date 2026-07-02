/**
 * v5.4: Add FTS5 full-text search tables (SQLite only)
 *
 * Creates two plain (self-contained) FTS5 virtual tables used to narrow
 * text-similarity search candidates before the existing scorers re-rank
 * them:
 * - t_decisions_fts   (key_id, project_id UNINDEXED; key_name, value)
 * - t_constraints_fts (constraint_id, project_id UNINDEXED; constraint_text, reason)
 *
 * Design notes:
 * - SQLite only. MySQL/PostgreSQL run this migration as a no-op and keep
 *   the full-scan search path (see decision search/fts5-hybrid-sqlite-only).
 * - Plain FTS5 tables, not external-content: t_decisions has a composite
 *   PK, so rowid mapping would be fragile.
 * - No triggers (prohibited in this project); synchronization happens in
 *   application write paths (src/utils/fts.ts).
 * - trigram tokenizer so CJK text matches on substrings. Requires
 *   SQLite >= 3.34 (better-sqlite3 bundles a newer version). If the
 *   tokenizer is unavailable the migration logs and skips; the search
 *   code then falls back to the full scan.
 *
 * IDEMPOTENT: Can be run multiple times safely.
 */

import type { Knex } from 'knex';

interface FtsTableSpec {
  name: string;
  /** column list for CREATE VIRTUAL TABLE (UNINDEXED columns first) */
  columns: string;
  /** backfill statement run only when the table is first created */
  backfill: string;
}

const FTS_TABLES: FtsTableSpec[] = [
  {
    name: 't_decisions_fts',
    columns: 'key_id UNINDEXED, project_id UNINDEXED, key_name, value',
    backfill: `
      INSERT INTO t_decisions_fts (key_id, project_id, key_name, value)
      SELECT d.key_id, d.project_id, ck.key_name, d.value
      FROM t_decisions d
      JOIN m_context_keys ck ON d.key_id = ck.id
    `,
  },
  {
    name: 't_constraints_fts',
    columns: 'constraint_id UNINDEXED, project_id UNINDEXED, constraint_text, reason',
    backfill: `
      INSERT INTO t_constraints_fts (constraint_id, project_id, constraint_text, reason)
      SELECT id, project_id, constraint_text, COALESCE(reason, '')
      FROM t_constraints
    `,
  },
];

function isSQLite(knex: Knex): boolean {
  const client = (knex.client as { config?: { client?: string } })?.config?.client;
  return client === 'better-sqlite3' || client === 'sqlite3';
}

export async function up(knex: Knex): Promise<void> {
  if (!isSQLite(knex)) {
    console.error('⏭️  FTS5 search tables are SQLite-only; skipping on this backend');
    console.error('   (text searches keep using the full-scan path)');
    return;
  }

  console.error('🔄 v5.4: Creating FTS5 search tables...');

  for (const spec of FTS_TABLES) {
    const exists = await knex.schema.hasTable(spec.name);
    if (exists) {
      console.error(`  ⚠️  ${spec.name} already exists, skipping`);
      continue;
    }

    try {
      await knex.raw(
        `CREATE VIRTUAL TABLE ${spec.name} USING fts5(${spec.columns}, tokenize = 'trigram')`
      );
      await knex.raw(spec.backfill);
      console.error(`  ✓ Created and backfilled: ${spec.name}`);
    } catch (error: unknown) {
      // Old SQLite without the trigram tokenizer: skip rather than fail;
      // isFtsAvailable() will report false and searches fall back
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`  ⚠️  Could not create ${spec.name}: ${errorMsg}`);
      console.error('     Full-text search stays disabled; full-scan fallback remains active');
    }
  }

  console.error('✅ FTS5 search tables ready');
}

export async function down(knex: Knex): Promise<void> {
  if (!isSQLite(knex)) {
    return;
  }

  // FTS tables hold derived data only, so dropping them is safe;
  // re-running `up` recreates and backfills them from the source tables
  for (const spec of FTS_TABLES) {
    await knex.raw(`DROP TABLE IF EXISTS ${spec.name}`);
    console.error(`  ✓ Dropped: ${spec.name}`);
  }
}
