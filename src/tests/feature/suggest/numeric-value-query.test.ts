/**
 * Suggest numeric/text COALESCE precedence on SQLite.
 *
 * SQLite accepts mixed COALESCE types and must keep returning numeric
 * decisions as numbers. The PostgreSQL type error is covered by the
 * native suggest-tool tests; this file only locks the SQLite contract.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { initializeDatabase, closeDatabase } from '../../../database.js';
import { ProjectContext } from '../../../utils/project-context.js';
import { setDecision } from '../../../tools/context/index.js';
import { handleSuggestAction } from '../../../tools/suggest/index.js';

describe('Suggest numeric/text value precedence (SQLite)', () => {
  before(async () => {
    const adapter = await initializeDatabase({
      databaseType: 'sqlite',
      connection: { filename: ':memory:' },
    });

    const knex = adapter.getKnex();
    await ProjectContext.getInstance().ensureProject(knex, 'test-suggest-cast', 'config', {
      projectRootPath: process.cwd(),
    });

    await setDecision({
      key: 'suggest-cast/text',
      value: 'keep-text',
      tags: ['suggest-cast'],
      status: 'active',
    });
    await setDecision({
      key: 'suggest-cast/numeric',
      value: 42.5,
      tags: ['suggest-cast'],
      status: 'active',
    });
  });

  after(async () => {
    await closeDatabase();
  });

  it('by_tags keeps text and prefers the numeric value', async () => {
    const result = await handleSuggestAction({
      action: 'by_tags',
      tags: ['suggest-cast'],
      min_score: 1,
      limit: 10,
    });

    const text = result.suggestions.find((s: { key: string }) => s.key === 'suggest-cast/text');
    const numeric = result.suggestions.find((s: { key: string }) => s.key === 'suggest-cast/numeric');
    assert.ok(text, 'text decision should appear');
    assert.strictEqual(text.value, 'keep-text');
    assert.ok(numeric, 'numeric decision should appear');
    assert.notStrictEqual(numeric.value, '');
    assert.strictEqual(Number(numeric.value), 42.5);
  });

  it('by_key returns the numeric decision as 42.5', async () => {
    const result = await handleSuggestAction({
      action: 'by_key',
      key: 'suggest-cast/numeric',
      min_score: 1,
      limit: 10,
    });

    const numeric = result.suggestions.find((s: { key: string }) => s.key === 'suggest-cast/numeric');
    assert.ok(numeric, 'by_key should include suggest-cast/numeric');
    assert.strictEqual(Number(numeric.value), 42.5);
  });

  it('by_context does not throw when the query key is absent', async () => {
    const result = await handleSuggestAction({
      action: 'by_context',
      key: 'suggest-cast/other',
      tags: ['suggest-cast'],
      min_score: 1,
      limit: 10,
    });

    assert.ok(Array.isArray(result.suggestions));
  });
});
