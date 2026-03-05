/**
 * Decision Operations - Native RDBMS Integration Tests
 *
 * Tests decision schema correctness (FK, UNIQUE, CASCADE, tags, cross-DB)
 * via direct Knex operations on MySQL, MariaDB, and PostgreSQL.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { Knex } from 'knex';
import {
  runTestsOnAllDatabases,
  assertDecisionExists,
  assertDecisionHasTags,
  assertTagIndexPopulated,
  cleanupTestData,
  getLayerId,
  getTagId,
  getScopeId,
} from './test-harness.js';

runTestsOnAllDatabases('Decision Operations', (getDb, dbType) => {
  let projectId: number;

  it('should get project ID', async () => {
    const db = getDb();
    const project = await db('m_projects').first();
    assert.ok(project, 'Project should exist');
    projectId = project.id;
  });

  describe('Foreign key constraints', () => {
    it('should enforce FK constraint on key_id', async () => {
      const db = getDb();

      const insertPromise = db('t_decisions').insert({
        key_id: 999999, // Non-existent
        project_id: projectId,
        value: 'test',
        version: '1.0.0',
        ts: Math.floor(Date.now() / 1000),
        layer_id: 1,
      });

      await assert.rejects(
        insertPromise,
        (err: any) => {
          return (
            err.message.includes('foreign key') ||
            err.message.includes('FOREIGN KEY') ||
            err.message.includes('Cannot add or update a child row')
          );
        },
        'Should reject FK constraint violation'
      );
    });

    it('should enforce FK constraint on layer_id', async () => {
      const db = getDb();

      await db('m_context_keys').insert({ key_name: 'fk-test-layer' });
      const keyRecord = await db('m_context_keys')
        .where({ key_name: 'fk-test-layer' })
        .first();

      const insertPromise = db('t_decisions').insert({
        key_id: keyRecord.id,
        project_id: projectId,
        value: 'test',
        version: '1.0.0',
        ts: Math.floor(Date.now() / 1000),
        layer_id: 999999, // Non-existent
      });

      await assert.rejects(insertPromise, /foreign key|FOREIGN KEY|Cannot add or update a child row/i);

      await db('m_context_keys').where({ id: keyRecord.id }).del();
    });
  });

  describe('UNIQUE constraints', () => {
    it('should enforce PRIMARY KEY uniqueness on key_id', async () => {
      const db = getDb();

      await db('m_context_keys').insert({ key_name: 'unique-test-pk' });
      const keyRecord = await db('m_context_keys')
        .where({ key_name: 'unique-test-pk' })
        .first();

      const layerId = await getLayerId(db, 'business');

      await db('t_decisions').insert({
        key_id: keyRecord.id,
        project_id: projectId,
        value: 'first value',
        version: '1.0.0',
        ts: Math.floor(Date.now() / 1000),
        layer_id: layerId,
      });

      const duplicatePromise = db('t_decisions').insert({
        key_id: keyRecord.id,
        project_id: projectId,
        value: 'second value',
        version: '2.0.0',
        ts: Math.floor(Date.now() / 1000),
        layer_id: layerId,
      });

      await assert.rejects(
        duplicatePromise,
        /UNIQUE constraint|Duplicate entry|duplicate key value/i
      );

      await cleanupTestData(db);
    });

    // NOTE: v4 schema intentionally does NOT have UNIQUE constraint on decision_key_id in t_decision_context
    // This allows multiple context entries per decision (e.g., different stakeholder perspectives,
    // evolving rationale over time). Application layer handles context management.
    it('should allow multiple context entries per decision in v4 schema (no UNIQUE on decision_key_id)', async () => {
      const db = getDb();

      await db('m_context_keys').insert({ key_name: 'context-multi-test' });
      const keyRecord = await db('m_context_keys')
        .where({ key_name: 'context-multi-test' })
        .first();

      const layerId = await getLayerId(db, 'business');

      await db('t_decisions').insert({
        key_id: keyRecord.id,
        project_id: projectId,
        value: 'test value',
        version: '1.0.0',
        ts: Math.floor(Date.now() / 1000),
        layer_id: layerId,
      });

      await db('t_decision_context').insert({
        decision_key_id: keyRecord.id,
        project_id: projectId,
        rationale: 'First rationale',
        ts: Math.floor(Date.now() / 1000),
      });

      await db('t_decision_context').insert({
        decision_key_id: keyRecord.id,
        project_id: projectId,
        rationale: 'Second rationale',
        ts: Math.floor(Date.now() / 1000),
      });

      const contexts = await db('t_decision_context')
        .where({ decision_key_id: keyRecord.id, project_id: projectId })
        .select('id', 'rationale');

      assert.strictEqual(contexts.length, 2, 'Should allow multiple context entries per decision in v4');

      await cleanupTestData(db);
    });
  });

  // NOTE: v4 schema uses m_context_keys as the central reference point.
  // - t_decisions, t_decision_tags, t_decision_context all reference m_context_keys
  // - ON DELETE CASCADE is only applied to project_id (not key_id/decision_key_id)
  // - This prevents accidental data loss when cleaning up context keys

  describe('Foreign key behavior (v4 schema)', () => {
    it('should block context_keys deletion when decisions exist (no CASCADE on key_id)', async () => {
      const db = getDb();

      await db('m_context_keys').insert({ key_name: 'fk-block-test-key' });
      const keyRecord = await db('m_context_keys')
        .where({ key_name: 'fk-block-test-key' })
        .first();

      const layerId = await getLayerId(db, 'business');

      await db('t_decisions').insert({
        key_id: keyRecord.id,
        project_id: projectId,
        value: 'test value',
        version: '1.0.0',
        ts: Math.floor(Date.now() / 1000),
        layer_id: layerId,
      });

      const deletePromise = db('m_context_keys').where({ id: keyRecord.id }).del();

      await assert.rejects(
        deletePromise,
        /foreign key|FOREIGN KEY|Cannot delete or update a parent row|violates foreign key constraint/i,
        'Should block deletion when child records exist'
      );

      // Cleanup: Delete in correct order (child first)
      await db('t_decisions').where({ key_id: keyRecord.id }).del();
      await db('m_context_keys').where({ id: keyRecord.id }).del();
    });

    it('should allow decision deletion without affecting decision_tags (different FK reference)', async () => {
      const db = getDb();

      await db('m_context_keys').insert({ key_name: 'fk-tags-test' });
      const keyRecord = await db('m_context_keys')
        .where({ key_name: 'fk-tags-test' })
        .first();

      const layerId = await getLayerId(db, 'business');
      const tagId = await getTagId(db, 'test');

      await db('t_decisions').insert({
        key_id: keyRecord.id,
        project_id: projectId,
        value: 'test value',
        version: '1.0.0',
        ts: Math.floor(Date.now() / 1000),
        layer_id: layerId,
      });

      await db('t_decision_tags').insert({
        decision_key_id: keyRecord.id,
        project_id: projectId,
        tag_id: tagId,
      });

      let tags = await db('t_decision_tags').where({ decision_key_id: keyRecord.id });
      assert.ok(tags.length > 0, 'Tags should exist before deletion');

      // Delete decision - t_decision_tags references m_context_keys, not t_decisions
      // So deleting t_decisions doesn't affect t_decision_tags
      await db('t_decisions').where({ key_id: keyRecord.id }).del();

      // Tags still exist (they reference m_context_keys, not t_decisions)
      tags = await db('t_decision_tags').where({ decision_key_id: keyRecord.id });
      assert.ok(tags.length > 0, 'Tags should still exist after decision deletion (FK is to context_keys)');

      // Cleanup: Delete in correct order
      await db('t_decision_tags').where({ decision_key_id: keyRecord.id }).del();
      await db('m_context_keys').where({ id: keyRecord.id }).del();
    });

    it('should allow decision deletion without affecting decision_context (different FK reference)', async () => {
      const db = getDb();

      await db('m_context_keys').insert({ key_name: 'fk-context-test' });
      const keyRecord = await db('m_context_keys')
        .where({ key_name: 'fk-context-test' })
        .first();

      const layerId = await getLayerId(db, 'business');

      await db('t_decisions').insert({
        key_id: keyRecord.id,
        project_id: projectId,
        value: 'test value',
        version: '1.0.0',
        ts: Math.floor(Date.now() / 1000),
        layer_id: layerId,
      });

      await db('t_decision_context').insert({
        decision_key_id: keyRecord.id,
        project_id: projectId,
        rationale: 'Test rationale',
        ts: Math.floor(Date.now() / 1000),
      });

      let context = await db('t_decision_context').where({ decision_key_id: keyRecord.id }).first();
      assert.ok(context, 'Context should exist before deletion');

      // Delete decision - t_decision_context references m_context_keys, not t_decisions
      await db('t_decisions').where({ key_id: keyRecord.id }).del();

      // Context still exists (it references m_context_keys, not t_decisions)
      context = await db('t_decision_context').where({ decision_key_id: keyRecord.id }).first();
      assert.ok(context, 'Context should still exist after decision deletion (FK is to context_keys)');

      // Cleanup: Delete in correct order
      await db('t_decision_context').where({ decision_key_id: keyRecord.id }).del();
      await db('m_context_keys').where({ id: keyRecord.id }).del();
    });
  });

  describe('Decision table operations', () => {
    it('should insert decision with all required fields', async () => {
      const db = getDb();

      await db('m_context_keys').insert({ key_name: 'crud-test-key' });
      const keyRecord = await db('m_context_keys')
        .where({ key_name: 'crud-test-key' })
        .first();

      const layerId = await getLayerId(db, 'infrastructure');

      await db('t_decisions').insert({
        key_id: keyRecord.id,
        project_id: projectId,
        value: 'fastify',
        version: '1.0.0',
        ts: Math.floor(Date.now() / 1000),
        layer_id: layerId,
      });

      await assertDecisionExists(db, 'crud-test-key', 'fastify');

      await cleanupTestData(db);
    });

    it('should update existing decision value', async () => {
      const db = getDb();

      await db('m_context_keys').insert({ key_name: 'update-test-key' });
      const keyRecord = await db('m_context_keys')
        .where({ key_name: 'update-test-key' })
        .first();

      const layerId = await getLayerId(db, 'data');

      await db('t_decisions').insert({
        key_id: keyRecord.id,
        project_id: projectId,
        value: 'postgresql',
        version: '1.0.0',
        ts: Math.floor(Date.now() / 1000),
        layer_id: layerId,
      });

      await db('t_decisions')
        .where({ key_id: keyRecord.id })
        .update({
          value: 'postgresql-v16',
          version: '1.1.0',
          ts: Math.floor(Date.now() / 1000),
        });

      await assertDecisionExists(db, 'update-test-key', 'postgresql-v16');

      await cleanupTestData(db);
    });

    it('should store numeric decisions in t_decisions_numeric', async () => {
      const db = getDb();

      await db('m_context_keys').insert({ key_name: 'numeric-test-key' });
      const keyRecord = await db('m_context_keys')
        .where({ key_name: 'numeric-test-key' })
        .first();

      const layerId = await getLayerId(db, 'infrastructure');

      await db('t_decisions_numeric').insert({
        key_id: keyRecord.id,
        project_id: projectId,
        value: 100,
        version: '1.0.0',
        ts: Math.floor(Date.now() / 1000),
        layer_id: layerId,
      });

      const numericDecision = await db('t_decisions_numeric')
        .where({ key_id: keyRecord.id })
        .first();

      assert.ok(numericDecision, 'Numeric decision should exist');
      assert.strictEqual(numericDecision.value, 100, 'Numeric value should match');

      await cleanupTestData(db);
    });
  });

  describe('Decision context operations', () => {
    it('should insert decision context with rationale, alternatives, tradeoffs', async () => {
      const db = getDb();

      await db('m_context_keys').insert({ key_name: 'context-test-key' });
      const keyRecord = await db('m_context_keys')
        .where({ key_name: 'context-test-key' })
        .first();

      const layerId = await getLayerId(db, 'business');

      await db('t_decisions').insert({
        key_id: keyRecord.id,
        project_id: projectId,
        value: 'oauth2',
        version: '1.0.0',
        ts: Math.floor(Date.now() / 1000),
        layer_id: layerId,
      });

      await db('t_decision_context').insert({
        decision_key_id: keyRecord.id,
        project_id: projectId,
        rationale: 'OAuth2 provides better security and user experience',
        alternatives_considered: 'JWT, Session-based auth, Basic auth',
        tradeoffs: 'More complex implementation than basic auth',
        ts: Math.floor(Date.now() / 1000),
      });

      const context = await db('t_decision_context')
        .where({ decision_key_id: keyRecord.id })
        .first();

      assert.ok(context, 'Context should exist');
      assert.strictEqual(context.rationale, 'OAuth2 provides better security and user experience');
      assert.strictEqual(context.alternatives_considered, 'JWT, Session-based auth, Basic auth');
      assert.strictEqual(context.tradeoffs, 'More complex implementation than basic auth');

      await cleanupTestData(db);
    });

    it('should update existing decision context', async () => {
      const db = getDb();

      await db('m_context_keys').insert({ key_name: 'context-update-key' });
      const keyRecord = await db('m_context_keys')
        .where({ key_name: 'context-update-key' })
        .first();

      const layerId = await getLayerId(db, 'business');

      await db('t_decisions').insert({
        key_id: keyRecord.id,
        project_id: projectId,
        value: 'v1',
        version: '1.0.0',
        ts: Math.floor(Date.now() / 1000),
        layer_id: layerId,
      });

      await db('t_decision_context').insert({
        decision_key_id: keyRecord.id,
        project_id: projectId,
        rationale: 'Original rationale',
        ts: Math.floor(Date.now() / 1000),
      });

      await db('t_decision_context')
        .where({ decision_key_id: keyRecord.id })
        .update({
          rationale: 'Updated rationale',
          alternatives_considered: 'New alternatives',
        });

      const context = await db('t_decision_context')
        .where({ decision_key_id: keyRecord.id })
        .first();

      assert.strictEqual(context.rationale, 'Updated rationale');
      assert.strictEqual(context.alternatives_considered, 'New alternatives');

      await cleanupTestData(db);
    });
  });

  describe('Decision tagging', () => {
    it('should insert decision tags', async () => {
      const db = getDb();

      await db('m_context_keys').insert({ key_name: 'tag-test-key' });
      const keyRecord = await db('m_context_keys')
        .where({ key_name: 'tag-test-key' })
        .first();

      const layerId = await getLayerId(db, 'business');

      await db('t_decisions').insert({
        key_id: keyRecord.id,
        project_id: projectId,
        value: 'test value',
        version: '1.0.0',
        ts: Math.floor(Date.now() / 1000),
        layer_id: layerId,
      });

      const apiTagId = await getTagId(db, 'api');
      const perfTagId = await getTagId(db, 'performance');

      await db('t_decision_tags').insert([
        { decision_key_id: keyRecord.id, project_id: projectId, tag_id: apiTagId },
        { decision_key_id: keyRecord.id, project_id: projectId, tag_id: perfTagId },
      ]);

      await assertDecisionHasTags(db, 'tag-test-key', ['api', 'performance']);

      await cleanupTestData(db);
    });

    // Note: m_tag_index test removed - the table has a different schema
    // (tag_name, decision_count, constraint_count, task_count, total_count)
    // It's an aggregate count table populated by application logic, not individual mappings
  });

  describe('Decision scoping', () => {
    it('should insert decision scopes', async () => {
      const db = getDb();

      await db('m_context_keys').insert({ key_name: 'scope-test-key' });
      const keyRecord = await db('m_context_keys')
        .where({ key_name: 'scope-test-key' })
        .first();

      const layerId = await getLayerId(db, 'business');

      await db('t_decisions').insert({
        key_id: keyRecord.id,
        project_id: projectId,
        value: 'test value',
        version: '1.0.0',
        ts: Math.floor(Date.now() / 1000),
        layer_id: layerId,
      });

      const globalScopeId = await getScopeId(db, 'global');
      const moduleScopeId = await getScopeId(db, 'module');

      await db('t_decision_scopes').insert([
        { decision_key_id: keyRecord.id, project_id: projectId, scope_id: globalScopeId },
        { decision_key_id: keyRecord.id, project_id: projectId, scope_id: moduleScopeId },
      ]);

      const scopes = await db('t_decision_scopes')
        .join('m_scopes', 't_decision_scopes.scope_id', 'm_scopes.id')
        .where({ 't_decision_scopes.decision_key_id': keyRecord.id, 't_decision_scopes.project_id': projectId })
        .pluck('m_scopes.name');

      assert.strictEqual(scopes.length, 2, 'Should have 2 scopes');
      assert.ok(scopes.includes('global'), 'Should have global scope');
      assert.ok(scopes.includes('module'), 'Should have module scope');

      await cleanupTestData(db);
    });
  });

  describe(`Cross-database compatibility - ${dbType}`, () => {
    it('should handle long VARCHAR keys', async () => {
      const db = getDb();
      const longKey = 'test/' + 'a'.repeat(100);

      await db('m_context_keys').insert({ key_name: longKey });
      const keyRecord = await db('m_context_keys')
        .where({ key_name: longKey })
        .first();

      const layerId = await getLayerId(db, 'business');

      await db('t_decisions').insert({
        key_id: keyRecord.id,
        project_id: projectId,
        value: 'test',
        version: '1.0.0',
        ts: Math.floor(Date.now() / 1000),
        layer_id: layerId,
      });

      await assertDecisionExists(db, longKey, 'test');

      await cleanupTestData(db);
    });

    it('should handle special characters in values', async () => {
      const db = getDb();
      const specialValue = "Value with 'quotes', \"double quotes\", and \\backslashes";

      await db('m_context_keys').insert({ key_name: 'special-chars-key' });
      const keyRecord = await db('m_context_keys')
        .where({ key_name: 'special-chars-key' })
        .first();

      const layerId = await getLayerId(db, 'business');

      await db('t_decisions').insert({
        key_id: keyRecord.id,
        project_id: projectId,
        value: specialValue,
        version: '1.0.0',
        ts: Math.floor(Date.now() / 1000),
        layer_id: layerId,
      });

      await assertDecisionExists(db, 'special-chars-key', specialValue);

      await cleanupTestData(db);
    });

    it('should handle unicode characters', async () => {
      const db = getDb();
      const unicodeValue = '日本語 中文 한국어 🚀 emoji';

      await db('m_context_keys').insert({ key_name: 'unicode-key' });
      const keyRecord = await db('m_context_keys')
        .where({ key_name: 'unicode-key' })
        .first();

      const layerId = await getLayerId(db, 'business');

      await db('t_decisions').insert({
        key_id: keyRecord.id,
        project_id: projectId,
        value: unicodeValue,
        version: '1.0.0',
        ts: Math.floor(Date.now() / 1000),
        layer_id: layerId,
      });

      await assertDecisionExists(db, 'unicode-key', unicodeValue);

      await cleanupTestData(db);
    });
  });
});
