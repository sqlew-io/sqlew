/**
 * Suggest by_tags - buildTagIndexQuery regression tests
 *
 * Covers two regressions in the tag-index-based suggestion query:
 * 1. Decisions without a layer were silently excluded (m_layers was
 *    inner-joined while buildDecisionQuery uses LEFT JOIN).
 * 2. key_id is shared across projects (m_context_keys has no project_id),
 *    so joins on key_id without a project_id condition leaked decisions
 *    from other projects into the results.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { getAdapter, initializeDatabase, closeDatabase } from '../../../database.js';
import { ProjectContext } from '../../../utils/project-context.js';
import { setDecision } from '../../../tools/context/index.js';
import { handleSuggestAction } from '../../../tools/suggest/index.js';

describe('Suggest by_tags - tag index query', () => {
  before(async () => {
    const adapter = await initializeDatabase({
      databaseType: 'sqlite',
      connection: { filename: ':memory:' }
    });

    const knex = adapter.getKnex();
    await ProjectContext.getInstance().ensureProject(knex, 'test-tag-index', 'config', {
      projectRootPath: process.cwd(),
    });
  });

  after(async () => {
    await closeDatabase();
  });

  it('includes decisions without a layer', async () => {
    await setDecision({
      key: 'tagidx/no-layer',
      value: 'decision without layer',
      tags: ['tagidx-alpha'],
      status: 'active',
    });

    const result = await handleSuggestAction({
      action: 'by_tags',
      tags: ['tagidx-alpha'],
      min_score: 1,
      limit: 10,
    });

    const found = result.suggestions.find((s: { key: string }) => s.key === 'tagidx/no-layer');
    assert.ok(found, 'layer-less decision should appear in by_tags suggestions');
  });

  it('does not leak decisions from other projects sharing the same key_id', async () => {
    const adapter = getAdapter();
    const knex = adapter.getKnex();
    const now = Math.floor(Date.now() / 1000);

    // Decision in the current project
    await setDecision({
      key: 'tagidx/shared-key',
      value: 'value-current-project',
      layer: 'data',
      tags: ['tagidx-shared'],
      status: 'active',
    });

    // Second project reusing the same key_id (m_context_keys is global,
    // t_decisions PK is (key_id, project_id))
    const keyRow = await knex('m_context_keys')
      .where('key_name', 'tagidx/shared-key')
      .first();
    assert.ok(keyRow, 'context key should exist');

    const [otherProjectId] = await knex('m_projects').insert({
      name: 'test-tag-index-other',
      detection_source: 'config',
      created_ts: now,
      last_active_ts: now,
    });

    // Give the other project's decision a layer so it is visible to the
    // query regardless of the m_layers join fix (isolates the leak check)
    const layerRow = await knex('m_layers').where('name', 'business').first();
    assert.ok(layerRow, 'business layer should exist');

    await knex('t_decisions').insert({
      key_id: keyRow.id,
      project_id: otherProjectId,
      value: 'value-other-project',
      layer_id: layerRow.id,
      status: 1,
      ts: now,
    });
    await knex('t_decisions_numeric').insert({
      key_id: keyRow.id,
      project_id: otherProjectId,
      value: 999,
      status: 1,
      ts: now,
    });
    const [otherTagId] = await knex('m_tags').insert({ name: 'tagidx-other-only' });
    await knex('t_decision_tags').insert({
      decision_key_id: keyRow.id,
      project_id: otherProjectId,
      tag_id: otherTagId,
    });

    const result = await handleSuggestAction({
      action: 'by_tags',
      tags: ['tagidx-shared'],
      min_score: 1,
      limit: 10,
    });

    const matches = result.suggestions.filter(
      (s: { key: string }) => s.key === 'tagidx/shared-key'
    );
    assert.strictEqual(matches.length, 1, 'shared key should appear exactly once');
    assert.strictEqual(matches[0].value, 'value-current-project');
  });
});
