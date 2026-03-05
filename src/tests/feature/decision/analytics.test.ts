/**
 * Decision Analytics Action Tests
 *
 * Tests the decision.analytics action for numeric decision aggregation.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { handleAnalytics } from '../../../tools/context/index.js';
import { setDecision } from '../../../tools/context/index.js';
import { getAdapter, initializeDatabase, closeDatabase } from '../../../database.js';
import { ProjectContext } from '../../../utils/project-context.js';
import { mkdirSync } from 'node:fs';

const TEST_DB_PATH = '.tmp-test/decision-analytics.db';

describe('Decision Analytics Action', () => {
  before(async () => {
    mkdirSync('.tmp-test', { recursive: true });
    const adapter = await initializeDatabase({
      databaseType: 'sqlite',
      connection: { filename: TEST_DB_PATH }
    });

    // Set up project context (required after v3.7.0)
    const knex = adapter.getKnex();
    const projectContext = ProjectContext.getInstance();
    await projectContext.ensureProject(knex, 'test-decision-analytics', 'config', {
      projectRootPath: process.cwd(),
    });
  });

  after(async () => {
    await closeDatabase();
  });

  it('should aggregate numeric decisions (avg)', async () => {
    // Insert test data
    await setDecision({ key: 'test/metric/api-latency/endpoint1', value: 100, layer: 'infrastructure' });
    await setDecision({ key: 'test/metric/api-latency/endpoint2', value: 200, layer: 'infrastructure' });
    await setDecision({ key: 'test/metric/api-latency/endpoint3', value: 150, layer: 'infrastructure' });

    // Execute analytics
    const result = await handleAnalytics({
      action: 'analytics',
      key_pattern: 'test/metric/api-latency/%',
      aggregation: 'avg',
      layer: 'infrastructure'
    });

    // Verify result
    assert.strictEqual(result.pattern, 'test/metric/api-latency/%');
    assert.strictEqual(result.aggregation, 'avg');
    assert.strictEqual(result.layer, 'infrastructure');
    assert.strictEqual(result.result.count, 3);
    assert.strictEqual(result.result.min, 100);
    assert.strictEqual(result.result.max, 200);
    assert.strictEqual(result.result.avg, 150);
    assert.strictEqual(result.result.sum, 450);
  });

  it('should aggregate numeric decisions (sum)', async () => {
    // Execute analytics with sum
    const result = await handleAnalytics({
      action: 'analytics',
      key_pattern: 'test/metric/api-latency/%',
      aggregation: 'sum'
    });

    // Verify result
    assert.strictEqual(result.aggregation, 'sum');
    assert.strictEqual(result.result.count, 3);
    assert.strictEqual(result.result.sum, 450);
  });

  it('should aggregate numeric decisions (max)', async () => {
    // Execute analytics with max
    const result = await handleAnalytics({
      action: 'analytics',
      key_pattern: 'test/metric/api-latency/%',
      aggregation: 'max'
    });

    // Verify result
    assert.strictEqual(result.aggregation, 'max');
    assert.strictEqual(result.result.max, 200);
  });

  it('should aggregate numeric decisions (min)', async () => {
    // Execute analytics with min
    const result = await handleAnalytics({
      action: 'analytics',
      key_pattern: 'test/metric/api-latency/%',
      aggregation: 'min'
    });

    // Verify result
    assert.strictEqual(result.aggregation, 'min');
    assert.strictEqual(result.result.min, 100);
  });

  it('should aggregate numeric decisions (count)', async () => {
    // Execute analytics with count
    const result = await handleAnalytics({
      action: 'analytics',
      key_pattern: 'test/metric/api-latency/%',
      aggregation: 'count'
    });

    // Verify result
    assert.strictEqual(result.aggregation, 'count');
    assert.strictEqual(result.result.count, 3);
  });

  it('should calculate percentiles', async () => {
    // Execute analytics with percentiles
    const result = await handleAnalytics({
      action: 'analytics',
      key_pattern: 'test/metric/api-latency/%',
      aggregation: 'avg',
      percentiles: [50, 90, 95, 99]
    });

    // Verify percentiles exist
    assert.ok(result.percentiles);
    assert.ok(result.percentiles![50]);
    assert.ok(result.percentiles![90]);
    assert.ok(result.percentiles![95]);
    assert.ok(result.percentiles![99]);
  });

  it('should throw error for missing key_pattern', async () => {
    await assert.rejects(
      async () => {
        await handleAnalytics({
          action: 'analytics',
          key_pattern: '',
          aggregation: 'avg'
        });
      },
      /Missing required parameter: key_pattern/
    );
  });

  it('should throw error for missing aggregation', async () => {
    await assert.rejects(
      async () => {
        await handleAnalytics({
          action: 'analytics',
          key_pattern: 'test/metric/%',
          aggregation: '' as any
        });
      },
      /Missing required parameter: aggregation/
    );
  });

  it('should throw error for invalid aggregation', async () => {
    await assert.rejects(
      async () => {
        await handleAnalytics({
          action: 'analytics',
          key_pattern: 'test/metric/%',
          aggregation: 'invalid' as any
        });
      },
      /Invalid aggregation: invalid/
    );
  });
});
