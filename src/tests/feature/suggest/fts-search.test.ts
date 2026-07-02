/**
 * FTS5 hybrid search feature tests
 *
 * Verifies:
 * - FTS tables are created on fresh SQLite databases
 * - constraint add / decision set keep the FTS index in sync
 * - constraint-by-text finds candidates through the FTS path
 * - special characters in the query never produce MATCH syntax errors
 * - dropping the FTS tables falls back to the full-scan path (must run last)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getAdapter, initializeDatabase, closeDatabase } from '../../../database.js';
import { ProjectContext } from '../../../utils/project-context.js';
import { addConstraint } from '../../../tools/constraints/index.js';
import { setDecision, hardDeleteDecision } from '../../../tools/context/index.js';
import { constraintByText } from '../../../tools/suggest/actions/constraint-by-text.js';
import {
  isFtsAvailable,
  resetFtsAvailabilityCache,
  buildFtsMatchQuery,
  DECISIONS_FTS_TABLE,
  CONSTRAINTS_FTS_TABLE,
} from '../../../utils/fts.js';

describe('FTS5 hybrid search', () => {
  before(async () => {
    const adapter = await initializeDatabase({
      databaseType: 'sqlite',
      connection: { filename: ':memory:' }
    });

    const knex = adapter.getKnex();
    await ProjectContext.getInstance().ensureProject(knex, 'test-fts-search', 'config', {
      projectRootPath: process.cwd(),
    });
  });

  after(async () => {
    await closeDatabase();
  });

  it('creates FTS tables on fresh SQLite databases', async () => {
    const knex = getAdapter().getKnex();
    assert.strictEqual(await isFtsAvailable(knex), true);
  });

  it('builds safe MATCH queries from arbitrary text', () => {
    // Quoted terms, no syntax operators leaking through
    const q = buildFtsMatchQuery('use "quotes" AND (operators) OR NOT');
    assert.ok(q);
    assert.ok(q!.split(' OR ').every((t) => t.startsWith('"') && t.endsWith('"')));

    // Too short for trigram -> null (callers fall back)
    assert.strictEqual(buildFtsMatchQuery('ab'), null);

    // Long CJK run is chunked into overlapping windows
    const cjk = buildFtsMatchQuery('マイグレーションファイルの編集は禁止');
    assert.ok(cjk);
    assert.ok(cjk!.split(' OR ').length > 1);
  });

  it('syncs constraint add into the FTS index and finds it via by_text', async () => {
    const knex = getAdapter().getKnex();

    const addResult = await addConstraint({
      category: 'architecture',
      constraint_text: 'Never store plaintext passwords in the database layer',
      priority: 'high',
    });

    const ftsRow = await knex(CONSTRAINTS_FTS_TABLE)
      .where('constraint_id', addResult.constraint_id)
      .first();
    assert.ok(ftsRow, 'constraint should be indexed in FTS on add');

    const result = await constraintByText({
      text: 'store plaintext passwords database',
      min_score: 1,
    });
    const found = result.suggestions.find((s) => s.id === addResult.constraint_id);
    assert.ok(found, 'constraint should be found through the FTS path');
  });

  it('finds CJK constraints with partially different query text', async () => {
    const addResult = await addConstraint({
      category: 'code-style',
      constraint_text: 'プッシュ済みのマイグレーションファイルを編集してはならない',
      priority: 'critical',
    });

    const result = await constraintByText({
      text: 'マイグレーションファイルの編集を禁止する',
      min_score: 1,
    });
    const found = result.suggestions.find((s) => s.id === addResult.constraint_id);
    assert.ok(found, 'CJK constraint should match on shared substrings');
  });

  it('never throws on special characters in the query', async () => {
    for (const text of ['foo* bar-', 'a"b"c NEAR/2 d', '(x OR y) NOT z', '"""', 'カラム^2 + *']) {
      const result = await constraintByText({ text, min_score: 1 });
      assert.ok(Array.isArray(result.suggestions));
    }
  });

  it('syncs decision set and hard_delete into the FTS index', async () => {
    const knex = getAdapter().getKnex();

    await setDecision({
      key: 'fts/decision-sync',
      value: 'initial searchable decision text',
      tags: ['fts-test'],
    });

    let rows = await knex(DECISIONS_FTS_TABLE).where('key_name', 'fts/decision-sync');
    assert.strictEqual(rows.length, 1, 'decision should be indexed on set');
    assert.strictEqual(rows[0].value, 'initial searchable decision text');

    // Update replaces (no duplicate rows)
    await setDecision({
      key: 'fts/decision-sync',
      value: 'updated searchable decision text',
    });
    rows = await knex(DECISIONS_FTS_TABLE).where('key_name', 'fts/decision-sync');
    assert.strictEqual(rows.length, 1, 'update should replace the FTS row');
    assert.strictEqual(rows[0].value, 'updated searchable decision text');

    await hardDeleteDecision({ key: 'fts/decision-sync' });
    rows = await knex(DECISIONS_FTS_TABLE).where('key_name', 'fts/decision-sync');
    assert.strictEqual(rows.length, 0, 'hard_delete should remove the FTS row');
  });

  // Must run last: removes the FTS tables for the fallback check
  it('falls back to the full scan when FTS tables are missing', async () => {
    const knex = getAdapter().getKnex();

    await knex.raw(`DROP TABLE IF EXISTS ${CONSTRAINTS_FTS_TABLE}`);
    await knex.raw(`DROP TABLE IF EXISTS ${DECISIONS_FTS_TABLE}`);
    resetFtsAvailabilityCache(knex);

    assert.strictEqual(await isFtsAvailable(knex), false);

    const result = await constraintByText({
      text: 'store plaintext passwords database',
      min_score: 1,
    });
    const found = result.suggestions.find(
      (s) => s.constraint_text === 'Never store plaintext passwords in the database layer'
    );
    assert.ok(found, 'full-scan fallback should still find the constraint');

    // Writes must not fail either while FTS is missing
    const addResult = await addConstraint({
      category: 'security',
      constraint_text: 'fallback write path stays functional without FTS',
      priority: 'low',
    });
    assert.ok(Number(addResult.constraint_id) > 0);
  });
});
