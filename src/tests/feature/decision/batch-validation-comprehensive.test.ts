/**
 * Decision Batch Validation Test Suite
 * Tests batch validation for decision set_batch operation
 *
 * Note: Task and file batch validation tests removed in v5.0 (deprecated tools)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { setDecisionBatch } from '../../../tools/context/index.js';
import { DatabaseAdapter } from '../../../adapters/index.js';
import { initializeDatabase, closeDatabase } from '../../../database.js';
import { ProjectContext } from '../../../utils/project-context.js';
import { unlink } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';

const TEST_DB_PATH = '.tmp-test/batch-validation-decision.db';

describe('Decision Batch Validation Test Suite', () => {
  let adapter: DatabaseAdapter;

  before(async () => {
    mkdirSync('.tmp-test', { recursive: true });
    adapter = await initializeDatabase({
      databaseType: 'sqlite',
      connection: {
        filename: TEST_DB_PATH,
      },
    });

    // Initialize project context
    const knex = adapter.getKnex();
    const projectContext = ProjectContext.getInstance();
    await projectContext.ensureProject(knex, 'test-project', 'config');
  });

  after(async () => {
    // Cleanup
    await closeDatabase();
    try {
      await unlink(TEST_DB_PATH);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Decision Batch Validation - set_batch', () => {
    it('should reject batch with missing key', async () => {
      const decisions = [
        { key: 'valid-key', value: 'value-1' },
        { value: 'value-2' } as any, // Missing key
      ];

      await assert.rejects(
        async () => await setDecisionBatch({ decisions }, adapter),
        (error: Error) => {
          assert.ok(error.message.includes('Batch validation failed'));
          assert.ok(error.message.includes('key'));
          assert.ok(error.message.includes('required') || error.message.includes('missing'));
          assert.ok(error.message.includes('Item 1'));
          return true;
        }
      );
    });

    it('should reject batch with missing decision/value', async () => {
      const decisions = [
        { key: 'missing-value' } as any, // Missing value
      ];

      await assert.rejects(
        async () => await setDecisionBatch({ decisions }, adapter),
        (error: Error) => {
          assert.ok(error.message.includes('Batch validation failed'));
          assert.ok(error.message.includes('value'));
          assert.ok(error.message.includes('required') || error.message.includes('missing'));
          return true;
        }
      );
    });

    it('should reject batch with invalid layer', async () => {
      const decisions = [
        { key: 'invalid-layer', value: 'test', layer: 'invalid_layer' },
      ];

      await assert.rejects(
        async () => await setDecisionBatch({ decisions }, adapter),
        (error: Error) => {
          assert.ok(error.message.includes('Batch validation failed'));
          assert.ok(error.message.includes('layer'));
          assert.ok(error.message.includes('invalid_layer'));
          assert.ok(
            error.message.includes('presentation') ||
            error.message.includes('business') ||
            error.message.includes('data')
          );
          return true;
        }
      );
    });

    it('should reject batch with invalid status', async () => {
      const decisions = [
        { key: 'invalid-status', value: 'test', status: 'invalid_status' as any },
      ];

      await assert.rejects(
        async () => await setDecisionBatch({ decisions }, adapter),
        (error: Error) => {
          assert.ok(error.message.includes('Batch validation failed'));
          assert.ok(error.message.includes('status'));
          assert.ok(error.message.includes('invalid_status'));
          assert.ok(
            error.message.includes('active') ||
            error.message.includes('deprecated') ||
            error.message.includes('draft')
          );
          return true;
        }
      );
    });

    it('should reject batch with invalid tags type (string instead of array)', async () => {
      const decisions = [
        { key: 'invalid-tags', value: 'test', tags: 'not-an-array' as any },
      ];

      await assert.rejects(
        async () => await setDecisionBatch({ decisions }, adapter),
        (error: Error) => {
          assert.ok(error.message.includes('Batch validation failed'));
          assert.ok(error.message.includes('tags'));
          assert.ok(error.message.includes('array') || error.message.includes('type'));
          return true;
        }
      );
    });

    it('should reject batch with multiple errors at once', async () => {
      const decisions = [
        { key: 'valid-key', value: 'valid-value' },
        { value: 'missing-key' } as any, // Missing key
        { key: 'invalid-status', value: 'test', status: 'bad_status' as any }, // Invalid status
        { key: 'invalid-tags', value: 'test', tags: 'not-array' as any }, // Invalid tags type
      ];

      await assert.rejects(
        async () => await setDecisionBatch({ decisions }, adapter),
        (error: Error) => {
          assert.ok(error.message.includes('Batch validation failed'));
          // Should mention multiple items
          assert.ok(error.message.includes('Item 1') || error.message.includes('Item 2'));
          // Should have multiple error types
          const errorCount = (error.message.match(/❌/g) || []).length;
          assert.ok(errorCount >= 2, `Expected at least 2 errors, got ${errorCount}`);
          return true;
        }
      );
    });

    it('should accept valid batch with all required fields', async () => {
      const decisions = [
        { key: 'decision-1', value: 'value-1' },
        { key: 'decision-2', value: 'value-2', layer: 'business' },
        { key: 'decision-3', value: 'value-3', tags: ['tag1', 'tag2'], status: 'active' as const },
      ];

      const result = await setDecisionBatch({ decisions }, adapter);
      assert.ok(result.success);
      assert.strictEqual(result.inserted, 3);
      assert.strictEqual(result.failed, 0);
    });
  });

  describe('Error Message Format Verification', () => {
    it('should include field name in error message', async () => {
      const decisions = [
        { key: 'test-key' } as any, // Missing value field
      ];

      await assert.rejects(
        async () => await setDecisionBatch({ decisions }, adapter),
        (error: Error) => {
          assert.ok(error.message.includes('value'));
          return true;
        }
      );
    });

    it('should show current invalid value in error message', async () => {
      const decisions = [
        { key: 'test', value: 'value', status: 'bad_status' as any },
      ];

      await assert.rejects(
        async () => await setDecisionBatch({ decisions }, adapter),
        (error: Error) => {
          // Should show the invalid value that was provided
          assert.ok(error.message.includes('bad_status'));
          return true;
        }
      );
    });
  });
});
