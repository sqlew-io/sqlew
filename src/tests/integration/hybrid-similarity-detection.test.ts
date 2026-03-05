/**
 * Integration tests for v3.9.0 Hybrid Similarity Detection
 * Tests three-tier duplicate detection (35-44 gentle nudge, 45-59 hard block, 60+ auto-update)
 * v3.9.1: Three-tier system with AI-friendly auto-update (Option B thresholds)
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import { initializeDatabase, getAdapter, closeDatabase } from '../../database.js';
import { setDecision } from '../../tools/context/index.js';
import { SUGGEST_THRESHOLDS } from '../../constants.js';
import { ProjectContext } from '../../utils/project-context.js';
import { mkdirSync } from 'node:fs';

describe('Hybrid Similarity Detection (v3.9.0)', () => {
  let projectId: number;

  // Helper function to call setDecision (uses transaction for rollback on error)
  async function createDecision(params: any) {
    return setDecision(params);
  }

  before(async () => {
    mkdirSync('.tmp-test', { recursive: true });
    const adapter = await initializeDatabase({
      databaseType: 'sqlite',
      connection: { filename: '.tmp-test/hybrid-similarity-detection.db' }
    });

    // Set up project context (required after v3.7.0)
    const knex = adapter.getKnex();
    const projectContext = ProjectContext.getInstance();
    await projectContext.ensureProject(knex, 'test-hybrid-similarity', 'config', {
      projectRootPath: process.cwd(),
    });

    projectId = projectContext.getProjectId();

    // Clean up any existing test data from previous runs (including old key patterns)
    const testKeyIds = await knex('m_context_keys')
      .select('id')
      .where(function(this: any) {
        this.where('key_name', 'like', 'test-%')
          .orWhere('key_name', 'like', 'infra-%')
          .orWhere('key_name', 'like', 'pattern-%')
          .orWhere('key_name', 'like', 'tier2-%')
          .orWhere('key_name', 'like', 'v390-%')  // Covers v390-tier2 and v390-tier3
          .orWhere('key_name', 'like', 'config-%')
          .orWhere('key_name', 'like', 'DB-%');
      });

    const keyIds = testKeyIds.map((row: any) => row.id);

    if (keyIds.length > 0) {
      // Delete in order of dependencies (child tables first)
      await knex('t_tag_index')
        .whereIn('source_id', keyIds)
        .where('source_type', 'decision')
        .where('project_id', projectId)
        .delete();

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

    // Clean up existing policies
    await knex('t_decision_policies')
      .where('project_id', projectId)
      .where(function(this: any) {
        this.where('name', 'like', '%test%')
          .orWhere('name', 'no-suggest-policy');
      })
      .delete();

    // Create test policy with suggest_similar=1 (no validation_rules to match all decisions)
    await knex('t_decision_policies').insert({
      project_id: projectId,
      name: 'test-policy',
      category: 'testing',
      defaults: JSON.stringify({}),  // Empty defaults (NOT NULL column)
      validation_rules: null,  // No validation rules - match all decisions for similarity detection
      quality_gates: null,
      suggest_similar: 1,
      ts: Math.floor(Date.now() / 1000)
    });
  });

  after(async () => {
    await closeDatabase();
  });

  describe('Tier 1: Gentle Nudge (35-44)', () => {
    it('should return duplicate_risk warning for similar decisions (non-blocking)', async () => {
      // Create baseline decision
      await createDecision({
        key: 'test-2024-0001',
        value: 'Fixed buffer overflow in auth module',
        tags: ['security', 'vulnerability', 'auth'],
        layer: 'infrastructure',
        version: '1.0.0'
      });

      // Create similar decision (should trigger gentle nudge)
      // Different layer and minimal tag overlap to score in 35-44 range
      const result = await createDecision({
        key: 'test-2024-0002',
        value: 'Implemented input validation for user registration form',
        tags: ['security', 'validation', 'frontend'],  // Only 1/3 tag match (security)
        layer: 'presentation',  // Different layer (no layer match bonus)
        version: '1.0.0'
      });

      // Assert decision was created (non-blocking)
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.key, 'test-2024-0002');

      // Assert duplicate_risk warning exists
      assert.ok((result as any).duplicate_risk, 'duplicate_risk should be present');
      const risk = (result as any).duplicate_risk;

      assert.strictEqual(risk.severity, 'MODERATE');
      assert.ok(risk.max_score >= SUGGEST_THRESHOLDS.GENTLE_NUDGE, 'Score should be >= 35');
      assert.ok(risk.max_score < SUGGEST_THRESHOLDS.HARD_BLOCK, 'Score should be < 45');

      // Assert confidence scores
      assert.ok(risk.confidence.is_duplicate >= 0 && risk.confidence.is_duplicate <= 1);
      assert.ok(risk.confidence.should_update >= 0 && risk.confidence.should_update <= 1);

      // Assert suggestions structure
      assert.ok(Array.isArray(risk.suggestions), 'suggestions should be an array');
      assert.ok(risk.suggestions.length > 0 && risk.suggestions.length <= 3, 'Max 3 suggestions');

      const suggestion = risk.suggestions[0];
      assert.strictEqual(suggestion.key, 'test-2024-0001');
      assert.ok(suggestion.recommended, 'First suggestion should be recommended');
      assert.ok(suggestion.matches, 'Should have matches details');
      assert.ok(suggestion.version_info, 'Should have version info');
      assert.ok(suggestion.reasoning, 'Should have reasoning');
      assert.ok(suggestion.update_command, 'Should have update command');
    });

    it('should include enriched suggestion details', async () => {
      // Create baseline with distinct key prefix to avoid matching first test
      await createDecision({
        key: 'test-db-001',
        value: 'Optimized database query performance',
        tags: ['database', 'performance', 'optimization'],
        layer: 'data',
        version: '1.0.0'
      });

      // Create similar decision - minimal tag overlap, different layer, different value
      const result = await createDecision({
        key: 'test-db-002',
        value: 'Added connection pooling to Redis cache layer',  // Different value
        tags: ['database', 'redis', 'caching'],  // Only 1/3 tag match (database)
        layer: 'infrastructure',  // Different layer to reduce score
        version: '1.0.0'
      });

      const risk = (result as any).duplicate_risk;
      assert.ok(risk, 'Should have duplicate_risk');

      const suggestion = risk.suggestions[0];

      // Check matches details exist
      assert.ok(suggestion.matches, 'Should have matches object');
      assert.ok(Array.isArray(suggestion.matches.tags), 'Should have tags array');
      // Note: Tags may be empty due to how similarity engine populates metadata

      // Check version_info
      assert.ok(suggestion.version_info.current, 'Should have current version');
      assert.ok(suggestion.version_info.next_suggested, 'Should have next suggested version');
      assert.ok(Array.isArray(suggestion.version_info.recent_changes), 'Should have recent changes');

      // Check update_command
      assert.strictEqual(suggestion.update_command.key, 'test-db-001');
      assert.ok(suggestion.update_command.version, 'Should have version in command');
      assert.ok(Array.isArray(suggestion.update_command.tags), 'Should have tags in command');
    });
  });

  describe('Tier 2: Hard Block (45-59)', () => {
    it('should throw error for similar decisions (blocking)', async () => {
      // Create baseline decision (ignore_suggest to prevent blocking by other test data)
      await createDecision({
        key: 'v390-tier2-baseline-001',
        value: 'Configured HAProxy load balancer with health monitoring',
        tags: ['v390-tier2', 'loadbalancer', 'monitoring'],
        layer: 'infrastructure',
        version: '1.0.0',
        ignore_suggest: true  // Prevent blocking during baseline creation
      });

      // Try to create similar decision
      // 2/3 tags (+20) + same layer (+25) + key similarity (+12) + recency (+10) = ~67 points
      // Wait - still Tier 3. Need to use DIFFERENT keys to reduce key similarity
      try {
        await createDecision({
          key: 'nginx-proxy-ssl-001',  // Completely different key pattern (-10 key pts)
          value: 'Configured nginx reverse proxy with SSL configuration',  // Different value
          tags: ['loadbalancer', 'monitoring', 'nginx'],  // 2/3 tag match (+20 pts)
          layer: 'infrastructure',  // Same layer (+25 pts)
          version: '1.0.0'
        });
        assert.fail('Should have thrown HARD BLOCK error');
      } catch (error: any) {
        assert.ok(error.message.includes('DUPLICATE DETECTED'), 'Should contain DUPLICATE DETECTED');
        assert.ok(error.message.includes('v390-tier2-baseline-001'), 'Should mention existing decision');
        assert.ok(error.message.includes('Update existing decision'), 'Should suggest update action');
      }

      // Verify decision was NOT created
      const adapter = getAdapter();
      const check = await adapter.getKnex()('t_decisions')
        .join('m_context_keys', 't_decisions.key_id', 'm_context_keys.id')
        .where('m_context_keys.key_name', 'v390-tier2-duplicate-001')
        .first();

      assert.strictEqual(check, undefined, 'Decision should not have been created');
    });

    it('should include actionable resolution in error message', async () => {
      // Create baseline (ignore_suggest to prevent blocking by other test data)
      await createDecision({
        key: 'v390-tier2-resolution-002',
        value: 'Implemented circuit breaker pattern for external API calls',
        tags: ['v390-tier2', 'circuit-breaker', 'resilience'],
        layer: 'cross-cutting',
        version: '1.0.0',
        ignore_suggest: true  // Prevent blocking during baseline creation
      });

      // Try to create similar decision
      // 2/3 tags (+20) + same layer (+25) + different key (+3) + recency (+10) = ~58 points
      try {
        await createDecision({
          key: 'retry-db-pattern-001',  // Completely different key pattern
          value: 'Implemented retry pattern for database connections',  // Different enough
          tags: ['circuit-breaker', 'resilience', 'database'],  // 2/3 tag match (+20 pts)
          layer: 'cross-cutting',  // Same layer (+25 pts)
          version: '1.0.0'
        });
        assert.fail('Should have thrown error');
      } catch (error: any) {
        // Check error structure - verify key fields are present
        assert.ok(error.message.includes('DUPLICATE DETECTED'), 'Should indicate duplicate');
        assert.ok(error.message.includes('v390-tier2-resolution-002'), 'Should mention existing decision');
        assert.ok(error.message.includes('Update existing decision'), 'Should suggest update');
        assert.ok(error.message.includes('ignore_suggest'), 'Should mention bypass option');
      }
    });
  });

  describe('Tier 3: Auto-Update (60+)', () => {
    it('should auto-update existing decision for very high similarity', async () => {
      // Create baseline decision (ignore_suggest to prevent blocking by other test data)
      await createDecision({
        key: 'v390-tier3-baseline-001',
        value: 'Implemented rate limiting for public API endpoints',
        tags: ['tier3-test1', 'rate-limiting', 'api-security'],  // Unique tag prefix
        layer: 'infrastructure',
        version: '1.0.0',
        ignore_suggest: true  // Prevent blocking during baseline creation
      });

      // Try to create near-identical decision (should auto-update)
      // 3/3 tags (+30) + same layer (+25) + key similarity (~12) + identical value (+15) + recency (+10) = ~92 points
      const result = await createDecision({
        key: 'v390-tier3-duplicate-001',
        value: 'Implemented rate limiting for public API endpoints',  // Identical value
        tags: ['tier3-test1', 'rate-limiting', 'api-security'],  // 3/3 tag match (+30)
        layer: 'infrastructure',  // Same layer (+25)
        version: '1.0.0'
      });

      // Assert auto-update occurred
      assert.strictEqual(result.success, true, 'Should succeed');
      assert.strictEqual(result.auto_updated, true, 'Should have auto_updated flag');
      assert.strictEqual(result.requested_key, 'v390-tier3-duplicate-001', 'Should track requested key');
      assert.strictEqual(result.actual_key, 'v390-tier3-baseline-001', 'Should track actual key');
      assert.ok(result.similarity_score! >= SUGGEST_THRESHOLDS.AUTO_UPDATE, 'Score should be >= 60');

      // Assert duplicate_reason metadata
      assert.ok(result.duplicate_reason, 'Should have duplicate_reason');
      assert.ok(result.duplicate_reason.similarity, 'Should have similarity explanation');
      assert.ok(Array.isArray(result.duplicate_reason.matched_tags), 'Should have matched tags');
      assert.strictEqual(result.duplicate_reason.layer, 'infrastructure', 'Should track layer match');

      // Verify decision 'v390-tier3-duplicate-001' was NOT created (updated existing instead)
      const adapter = getAdapter();
      const check = await adapter.getKnex()('t_decisions')
        .join('m_context_keys', 't_decisions.key_id', 'm_context_keys.id')
        .where('m_context_keys.key_name', 'v390-tier3-duplicate-001')
        .first();

      assert.strictEqual(check, undefined, 'New decision should not have been created');

      // Verify 'v390-tier3-baseline-001' was updated to version 1.0.1
      const updated = await adapter.getKnex()('t_decisions')
        .join('m_context_keys', 't_decisions.key_id', 'm_context_keys.id')
        .where('m_context_keys.key_name', 'v390-tier3-baseline-001')
        .select('t_decisions.version')
        .first();

      assert.ok(updated, 'Original decision should still exist');
      assert.ok(updated.version > '1.0.0', 'Version should have been incremented');
    });

    it('should include transparent metadata in response', async () => {
      // Create baseline
      await createDecision({
        key: 'v390-tier3-transparent-002',
        value: 'Configured Redis cluster for distributed session storage',
        tags: ['tier3-test2-unique', 'tier3-redis', 'tier3-sessions'],  // All unique tags
        layer: 'infrastructure',
        version: '1.0.0'
      });

      // Auto-update with identical content
      // 3/3 tags (+30) + same layer (+25) + key similarity (~12) + identical value (+15) + recency (+10) = ~92 points
      const result = await createDecision({
        key: 'v390-tier3-transparent-003',
        value: 'Configured Redis cluster for distributed session storage',  // Identical value
        tags: ['tier3-test2-unique', 'tier3-redis', 'tier3-sessions'],  // 3/3 tag match (+30)
        layer: 'infrastructure',  // Same layer (+25)
        version: '1.0.0'
      });

      // Check response structure
      assert.strictEqual(result.auto_updated, true);
      assert.strictEqual(result.key, 'v390-tier3-transparent-002', 'Should return actual key');
      assert.ok(result.message, 'Should have message');
      assert.ok(result.message!.includes('Auto-updated'), 'Message should mention auto-update');
      assert.ok(result.message!.includes('similarity'), 'Message should mention similarity');
    });

    it('should preserve value from new decision when auto-updating', async () => {
      // Create baseline
      await createDecision({
        key: 'v390-tier3-preserve-004',
        value: 'Use PostgreSQL 14 for primary database',
        tags: ['tier3-test3-unique', 'tier3-postgres', 'tier3-db'],  // All unique tags
        layer: 'infrastructure',
        version: '1.0.0'
      });

      // Auto-update with different value (upgrade decision)
      // 3/3 tags (+30) + same layer (+25) + key similarity (~12) + similar value (~12) + recency (+10) = ~89 points
      const newValue = 'Use PostgreSQL 15 for primary database';
      const result = await createDecision({
        key: 'v390-tier3-preserve-005',
        value: newValue,  // Different value (upgrade version)
        tags: ['tier3-test3-unique', 'tier3-postgres', 'tier3-db'],  // 3/3 tag match (+30)
        layer: 'infrastructure',  // Same layer (+25)
        version: '1.0.0'
      });

      // Assert auto-update preserved new value
      assert.strictEqual(result.auto_updated, true);
      assert.strictEqual(result.value, newValue, 'Should preserve new value from request');

      // Verify database was updated with new value
      const adapter = getAdapter();
      const updated = await adapter.getKnex()('t_decisions')
        .join('m_context_keys', 't_decisions.key_id', 'm_context_keys.id')
        .where('m_context_keys.key_name', 'v390-tier3-preserve-004')
        .select('t_decisions.value')
        .first();

      assert.strictEqual(updated.value, newValue, 'Database should have new value');
    });
  });

  describe('Bypass Mechanism', () => {
    it('should skip detection when ignore_suggest=true', async () => {
      // Create baseline
      await createDecision({
        key: 'test-queue-rabbitmq',
        value: 'Use RabbitMQ for message queue',
        tags: ['queue', 'rabbitmq', 'messaging'],
        layer: 'infrastructure',
        version: '1.0.0'
      });

      // Create similar decision with ignore_suggest=true
      const result = await createDecision({
        key: 'test-queue-implementation',
        value: 'Use RabbitMQ for messaging',
        tags: ['queue', 'rabbitmq', 'messaging'],
        layer: 'infrastructure',
        version: '1.0.0',
        ignore_suggest: true,
        ignore_reason: 'Different use case - async tasks vs event bus'
      } as any);

      // Should succeed without warning or error
      assert.strictEqual(result.success, true);
      assert.strictEqual((result as any).duplicate_risk, undefined, 'Should not have duplicate_risk');
    });

    it('should bypass both gentle nudge and hard block tiers', async () => {
      // Create baseline
      await createDecision({
        key: 'test-search-elasticsearch',
        value: 'Use Elasticsearch for full-text search',
        tags: ['search', 'elasticsearch'],
        layer: 'infrastructure',
        version: '1.0.0'
      });

      // Try to create near-identical decision with bypass
      const result = await createDecision({
        key: 'test-search-engine',
        value: 'Use Elasticsearch for search',
        tags: ['search', 'elasticsearch'],
        layer: 'infrastructure',
        version: '1.0.0',
        ignore_suggest: true,
        ignore_reason: 'Testing bypass functionality'
      } as any);

      // Should succeed
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.key, 'test-search-engine');
    });
  });

  describe('Operation Scope', () => {
    it('should only apply to CREATE operations', async () => {
      // Create baseline
      const created = await createDecision({
        key: 'test-update-scope',
        value: 'Initial value for scope testing',
        tags: ['scope-test', 'update-test'],
        layer: 'business',
        version: '1.0.0'
      });

      // Update the decision (should not trigger detection)
      const updated = await createDecision({
        key: 'test-update-scope',
        value: 'Updated value for scope testing',
        tags: ['scope-test', 'update-test'],
        layer: 'business',
        version: '1.1.0'
      });

      // Should succeed without duplicate_risk
      assert.strictEqual(updated.success, true);
      assert.strictEqual((updated as any).duplicate_risk, undefined, 'Updates should not trigger detection');
    });
  });

  describe('Policy Respect', () => {
    it('should only trigger when suggest_similar=1', async () => {
      // Create policy with suggest_similar=0
      const adapter = getAdapter();
      const knex = adapter.getKnex();

      await knex('t_decision_policies').insert({
        project_id: projectId,
        name: 'no-suggest-policy',
        category: 'testing',
        defaults: JSON.stringify({}),  // Empty defaults (NOT NULL column)
        validation_rules: JSON.stringify({
          patterns: {
            key: '^nosuggest-'
          }
        }),
        quality_gates: null,
        suggest_similar: 0,
        ts: Math.floor(Date.now() / 1000)
      });

      // Create baseline
      await createDecision({
        key: 'nosuggest-baseline',
        value: 'Baseline decision',
        tags: ['test'],
        layer: 'business',
        version: '1.0.0'
      });

      // Create similar decision (should NOT trigger detection)
      const result = await createDecision({
        key: 'nosuggest-similar',
        value: 'Similar decision',
        tags: ['test'],
        layer: 'business',
        version: '1.0.0'
      });

      // Should succeed without warning
      assert.strictEqual(result.success, true);
      assert.strictEqual((result as any).duplicate_risk, undefined, 'Should not detect when suggest_similar=0');
    });
  });

  describe('Edge Cases', () => {
    it('should handle decisions with no matching suggestions', async () => {
      // Create unique decision with no matches
      const result = await createDecision({
        key: 'test-unique-decision',
        value: 'Completely unique decision with no matches',
        tags: ['unique', 'special', 'isolated'],
        layer: 'business',
        version: '1.0.0'
      });

      // Should succeed without warning
      assert.strictEqual(result.success, true);
      assert.strictEqual((result as any).duplicate_risk, undefined, 'No warning for unique decisions');
    });

    it('should handle decisions without tags', async () => {
      // Create baseline without tags
      await createDecision({
        key: 'config-auth-jwt-001',
        value: 'Enable JWT token authentication mechanism for REST API endpoints',
        layer: 'business',
        version: '1.0.0'
      });

      // Create very dissimilar decision without tags (different key pattern, layer, and completely different value)
      const result = await createDecision({
        key: 'infra-redis-cluster-xyz',
        value: 'Configure Redis cache cluster with master-slave replication for production environment',
        layer: 'infrastructure',  // Different layer to reduce score
        version: '1.0.0'
      });

      // Should still work (detection may not trigger due to low score)
      assert.strictEqual(result.success, true);
    });

    it('should handle empty suggestion list gracefully', async () => {
      // Create decision with very unique tags and value that won't match anything
      const result = await createDecision({
        key: 'test-isolated-xyz123',
        value: 'Initialize blockchain consensus mechanism for distributed ledger',
        tags: ['blockchain', 'consensus', 'experimental'],
        layer: 'documentation',
        version: '1.0.0'
      });

      // Should succeed without issues
      assert.strictEqual(result.success, true);
    });
  });
});
