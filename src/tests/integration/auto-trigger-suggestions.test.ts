/**
 * Auto-Trigger Suggestions Integration Test (Task 407)
 *
 * Tests the integration of policy-based suggestion triggering in decision.set
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { setDecision } from '../../tools/context/index.js';
import { getAdapter, initializeDatabase, closeDatabase } from '../../database.js';
import { getProjectContext, ProjectContext } from '../../utils/project-context.js';

describe('Auto-Trigger Suggestions (Task 407)', () => {
  before(async () => {
    const adapter = await initializeDatabase({
      databaseType: 'sqlite',
      connection: { filename: '.tmp-test/auto-trigger-suggestions.db' }
    });

    // Set up project context (required after v3.7.0)
    const knex = adapter.getKnex();
    const projectContext = ProjectContext.getInstance();
    await projectContext.ensureProject(knex, 'test-auto-trigger-suggestions', 'config', {
      projectRootPath: process.cwd(),
    });

    const projectId = projectContext.getProjectId();

    await knex('t_decision_policies')
      .where('name', 'security_vulnerability')
      .where('project_id', projectId)
      .delete();

    const cveKeyIds = await knex('m_context_keys')
      .select('id')
      .where('key_name', 'like', 'CVE-%')
      .orWhere('key_name', 'like', 'test/autotrigger/%');

    const keyIds = cveKeyIds.map((row: any) => row.id);

    if (keyIds.length > 0) {
      await knex('t_decision_tags')
        .whereIn('decision_key_id', keyIds)
        .where('project_id', projectId)
        .delete();

      await knex('t_decision_scopes')
        .whereIn('decision_key_id', keyIds)
        .where('project_id', projectId)
        .delete();

      await knex('t_decision_history')
        .whereIn('key_id', keyIds)
        .delete();

      await knex('t_decisions')
        .whereIn('key_id', keyIds)
        .where('project_id', projectId)
        .delete();

      await knex('t_decisions_numeric')
        .whereIn('key_id', keyIds)
        .where('project_id', projectId)
        .delete();

      await knex('m_context_keys')
        .whereIn('id', keyIds)
        .delete();
    }
  });

  after(async () => {
    const adapter = getAdapter();
    const knex = adapter.getKnex();
    const projectId = getProjectContext().getProjectId();

    const cveKeyIds = await knex('m_context_keys')
      .select('id')
      .where('key_name', 'like', 'CVE-%')
      .orWhere('key_name', 'like', 'test/autotrigger/%');

    const keyIds = cveKeyIds.map((row: any) => row.id);

    if (keyIds.length > 0) {
      await knex('t_decision_tags')
        .whereIn('decision_key_id', keyIds)
        .where('project_id', projectId)
        .delete();

      await knex('t_decision_scopes')
        .whereIn('decision_key_id', keyIds)
        .where('project_id', projectId)
        .delete();

      await knex('t_decision_history')
        .whereIn('key_id', keyIds)
        .delete();

      await knex('t_decisions')
        .whereIn('key_id', keyIds)
        .where('project_id', projectId)
        .delete();

      await knex('t_decisions_numeric')
        .whereIn('key_id', keyIds)
        .where('project_id', projectId)
        .delete();

      await knex('m_context_keys')
        .whereIn('id', keyIds)
        .delete();
    }

    await knex('t_decision_policies')
      .where('name', 'security_vulnerability')
      .where('project_id', projectId)
      .delete();

    await closeDatabase();
  });

  it('should auto-trigger suggestions when policy has suggest_similar=1', async () => {
    const adapter = getAdapter();
    const knex = adapter.getKnex();
    const projectId = getProjectContext().getProjectId();

    await knex('t_decision_policies')
      .where('name', 'security_vulnerability')
      .where('project_id', projectId)
      .delete();

    await knex('t_decision_policies').insert({
      name: 'security_vulnerability',
      project_id: projectId,
      defaults: JSON.stringify({ layer: 'cross-cutting', tags: ['security', 'vulnerability'] }),
      suggest_similar: 1,
      validation_rules: JSON.stringify({
        patterns: {
          key: '^CVE-'  // Match CVE-* keys
        }
      }),
      quality_gates: null,
      ts: Math.floor(Date.now() / 1000)
    });

    await setDecision({
      key: 'CVE-2024-0001',
      value: 'Fixed buffer overflow in auth module',
      tags: ['security', 'vulnerability', 'auth'],
      layer: 'infrastructure',
      scopes: ['MODULE:auth']
    });

    // Use different tags/key to avoid triggering duplicate detection
    await setDecision({
      key: 'DB-PERF-2024-001',
      value: 'Optimized database query performance for user search',
      tags: ['database', 'performance', 'optimization'],
      layer: 'data',
      scopes: ['MODULE:database']
    });

    // v3.9.0 Three-Tier System:
    // - Tier 1 (35-44): Gentle nudge (non-blocking warning)
    // - Tier 2 (45-59): Hard block (error thrown)
    // - Tier 3 (60+): Auto-update (transparent update)
    //
    // This test accepts ANY tier as evidence that auto-trigger works
    let result: any;
    let wasBlocked = false;

    try {
      result = await setDecision({
        key: 'CVE-2024-0003',
        value: 'Fixed XSS vulnerability in React component rendering',
        tags: ['security', 'vulnerability', 'frontend'],  // 2/3 overlap with CVE-0001
        layer: 'presentation',  // Different layer to keep score below 60
        scopes: ['MODULE:frontend']
      });
    } catch (error: any) {
      // Tier 2/3: Hard block - match either "DUPLICATE DETECTED" or "DUPLICATE_DETECTED"
      const isDuplicateError = error.message && (
        error.message.includes('DUPLICATE DETECTED') ||
        error.message.includes('DUPLICATE_DETECTED') ||
        error.message.includes('HIGH-SIMILARITY')
      );

      if (isDuplicateError) {
        wasBlocked = true;
        console.log('  ✓ Auto-trigger worked (Tier 2 hard block or higher)');
      } else {
        throw error; // Unexpected error
      }
    }

    if (wasBlocked) {
      assert.ok(true, 'Auto-trigger worked: detected similarity and blocked');
      return;
    }

    assert.ok(result, 'Result should exist if not blocked');
    assert.ok(result.policy_validation, 'Should have policy_validation field');
    assert.strictEqual(
      result.policy_validation?.matched_policy,
      'security_vulnerability',
      'Should match security_vulnerability policy'
    );

    const hasSuggestions = (result as any).duplicate_risk || result.suggestions;
    assert.ok(hasSuggestions, 'Auto-trigger should provide suggestions (Tier 1) or block (Tier 2+)');

    if ((result as any).duplicate_risk) {
      const suggestionsList = (result as any).duplicate_risk.suggestions;
      assert.ok(suggestionsList && suggestionsList.length > 0, 'Should have at least one suggestion');
      assert.ok(suggestionsList[0].key, 'Suggestion should have key');
      assert.ok(suggestionsList[0].reasoning, 'Suggestion should have reasoning');
    } else if (result.suggestions) {
      const suggestionsList = result.suggestions.suggestions;
      assert.ok(suggestionsList && suggestionsList.length > 0, 'Should have at least one suggestion');
      assert.ok(suggestionsList[0].key, 'Suggestion should have key');
    }
  });

  it('should NOT auto-trigger suggestions when policy has suggest_similar=0', async () => {
    const adapter = getAdapter();
    const knex = adapter.getKnex();
    const projectId = getProjectContext().getProjectId();

    await knex('t_decision_policies')
      .where('name', 'security_vulnerability')
      .where('project_id', projectId)
      .delete();

    // suggest_similar=0 disables auto-trigger
    await knex('t_decision_policies').insert({
      name: 'security_vulnerability',
      project_id: projectId,
      defaults: JSON.stringify({ layer: 'cross-cutting', tags: ['security', 'vulnerability'] }),
      suggest_similar: 0,  // Disabled
      validation_rules: null,
      quality_gates: null,
      ts: Math.floor(Date.now() / 1000)
    });

    const result = await setDecision({
      key: 'CVE-2024-0004',
      value: 'Fixed memory leak in cache module',
      tags: ['security', 'vulnerability', 'cache'],
      layer: 'infrastructure',
      scopes: ['MODULE:cache']
    });

    assert.ok(result.policy_validation, 'Should have policy_validation field');
    assert.strictEqual(
      result.policy_validation?.matched_policy,
      'security_vulnerability',
      'Should match security_vulnerability policy'
    );

    assert.strictEqual(
      result.suggestions,
      undefined,
      'Should NOT have suggestions field when suggest_similar=0'
    );
  });

  it('should NOT auto-trigger suggestions when decision does not match any policy', async () => {
    const result = await setDecision({
      key: 'test/autotrigger/no-policy-match',
      value: 'Some arbitrary decision',
      tags: ['test'],
      layer: 'business',
      scopes: ['GLOBAL']
    });

    assert.strictEqual(
      result.policy_validation,
      undefined,
      'Should NOT have policy_validation when no policy matches'
    );

    assert.strictEqual(
      result.suggestions,
      undefined,
      'Should NOT have suggestions when no policy matches'
    );
  });

  it('should handle suggestion errors gracefully', async () => {
    const adapter = getAdapter();
    const knex = adapter.getKnex();
    const projectId = getProjectContext().getProjectId();

    await knex('t_decision_policies')
      .where('name', 'security_vulnerability')
      .where('project_id', projectId)
      .delete();

    await knex('t_decision_policies').insert({
      name: 'security_vulnerability',
      project_id: projectId,
      defaults: JSON.stringify({ layer: 'cross-cutting', tags: ['security', 'vulnerability'] }),
      suggest_similar: 1,  // Enabled
      validation_rules: null,
      quality_gates: null,
      ts: Math.floor(Date.now() / 1000)
    });

    const result = await setDecision({
      key: 'CVE-2024-9999-unique',
      value: 'Patched critical vulnerability in authentication middleware',
      tags: [],  // Empty tags might cause low scores
      layer: 'presentation',  // Use different layer to avoid high similarity
      scopes: ['GLOBAL']
    });

    assert.ok(result.success, 'Decision.set should succeed even if suggestions fail');
    assert.ok(result.key, 'Should have key');
    assert.ok(result.version, 'Should have version');
    assert.ok(result.policy_validation, 'Should have policy_validation field');
  });
});
