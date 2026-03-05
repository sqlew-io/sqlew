/**
 * Integration Tests for Decision Batch Validation
 * Tests that batch validation prevents database errors by catching issues before transaction
 */

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert';
import { setDecisionBatch } from '../../../tools/context/index.js';
import { DatabaseAdapter } from '../../../adapters/index.js';
import { initializeDatabase, closeDatabase } from '../../../database.js';
import { ProjectContext } from '../../../utils/project-context.js';
import { unlink } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';

const TEST_DB_PATH = '.tmp-test/decision-batch-validation.db';

describe('Batch Validation Integration - Decision Batch Set', () => {
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

  it('should reject batch with missing required field (key)', async () => {
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

  it('should reject batch with missing required field (value)', async () => {
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
        assert.ok(error.message.includes('active') || error.message.includes('deprecated') || error.message.includes('draft'));
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
          error.message.includes('Valid:')
        );
        return true;
      }
    );
  });

  it('should reject batch with invalid tags type (should be array)', async () => {
    const decisions = [
      { key: 'invalid-tags', value: 'test', tags: 'should-be-array' as any },
    ];

    await assert.rejects(
      async () => await setDecisionBatch({ decisions }, adapter),
      (error: Error) => {
        assert.ok(error.message.includes('Batch validation failed'));
        assert.ok(error.message.includes('tags'));
        assert.ok(error.message.includes('array'));
        return true;
      }
    );
  });

  it('should reject batch with invalid scopes type (should be array)', async () => {
    const decisions = [
      { key: 'invalid-scopes', value: 'test', scopes: 'should-be-array' as any },
    ];

    await assert.rejects(
      async () => await setDecisionBatch({ decisions }, adapter),
      (error: Error) => {
        assert.ok(error.message.includes('Batch validation failed'));
        assert.ok(error.message.includes('scopes'));
        assert.ok(error.message.includes('array'));
        return true;
      }
    );
  });

  it('should report ALL validation errors at once (not just first error)', async () => {
    const decisions = [
      { key: 'decision-1', value: 'test', layer: 'invalid-layer' }, // Invalid layer
      { value: 'test' } as any, // Missing key
      { key: 'decision-3', value: 'test', status: 'invalid-status' as any }, // Invalid status
    ];

    await assert.rejects(
      async () => await setDecisionBatch({ decisions }, adapter),
      (error: Error) => {
        // Should report errors for all 3 items
        assert.ok(error.message.includes('decision-1') || error.message.includes('Item 0')); // Decision 1 - invalid layer
        assert.ok(error.message.includes('Item 1')); // Decision 2 - missing key
        assert.ok(error.message.includes('decision-3') || error.message.includes('Item 2')); // Decision 3 - invalid status
        assert.ok(error.message.includes('3 validation error'));
        return true;
      }
    );
  });

  it('should report multiple errors in a single item', async () => {
    const decisions = [
      {
        tags: 'not-array',
        status: 'invalid' as any,
        scopes: 'not-array'
      } as any, // Missing key, value, invalid tags, status, scopes
    ];

    await assert.rejects(
      async () => await setDecisionBatch({ decisions }, adapter),
      (error: Error) => {
        // Should report multiple errors (at least key, value, and status are validated)
        assert.ok(error.message.includes('key') || error.message.includes('required'));
        assert.ok(error.message.includes('value') || error.message.includes('required'));
        assert.ok(error.message.includes('status') || error.message.includes('invalid'));
        // Tags and scopes validation may be included
        const errorCount = error.message.match(/validation error/g);
        assert.ok(errorCount && errorCount.length > 0, 'Should have validation errors');
        return true;
      }
    );
  });

  it('should accept valid batch with required fields only', async () => {
    const decisions = [
      { key: 'simple-1', value: 'value-1' },
      { key: 'simple-2', value: 123 },
    ];

    const result = await setDecisionBatch({ decisions }, adapter);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.inserted, 2);
    assert.strictEqual(result.failed, 0);
  });

  it('should accept valid batch with all optional fields', async () => {
    const decisions = [
      {
        key: 'full-decision-1',
        value: 'value-1',
        agent: 'test-agent',
        layer: 'business',
        version: '1.0.0',
        status: 'active' as const,
        tags: ['tag1', 'tag2'],
        scopes: ['scope1']
      },
      {
        key: 'full-decision-2',
        value: 'value-2',
        agent: 'test-agent',
        layer: 'infrastructure',
        status: 'draft' as const,
        tags: ['tag3'],
        scopes: ['scope2', 'scope3']
      },
    ];

    const result = await setDecisionBatch({ decisions }, adapter);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.inserted, 2);
    assert.strictEqual(result.failed, 0);
  });

  it('should accept valid batch with documentation layer', async () => {
    const decisions = [
      {
        key: 'doc-decision',
        value: 'markdown',
        layer: 'documentation',
        tags: ['format'],
      },
    ];

    const result = await setDecisionBatch({ decisions }, adapter);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.inserted, 1);
    assert.strictEqual(result.failed, 0);
  });

  it('should provide actionable fix instructions in error message', async () => {
    const decisions = [
      { key: 'test', value: 'test', status: 'draf' as any }, // Typo in status
    ];

    await assert.rejects(
      async () => await setDecisionBatch({ decisions }, adapter),
      (error: Error) => {
        // Should include fix instruction
        assert.ok(error.message.includes('💡 Fix:'));
        assert.ok(error.message.includes('draft') || error.message.includes('closest match'));
        return true;
      }
    );
  });

  it('should show valid options for enum fields in error message', async () => {
    const decisions = [
      { key: 'test', value: 'test', layer: 'invalid-layer' },
    ];

    await assert.rejects(
      async () => await setDecisionBatch({ decisions }, adapter),
      (error: Error) => {
        // Should list valid layer options
        assert.ok(error.message.includes('Valid:'));
        assert.ok(error.message.includes('presentation'));
        assert.ok(error.message.includes('business'));
        assert.ok(error.message.includes('data'));
        assert.ok(error.message.includes('infrastructure'));
        assert.ok(error.message.includes('cross-cutting'));
        assert.ok(error.message.includes('documentation'));
        return true;
      }
    );
  });

  it('should validate in non-atomic mode as well', async () => {
    const decisions = [
      { key: 'valid', value: 'test' },
      { value: 'missing-key' } as any, // Invalid
    ];

    await assert.rejects(
      async () => await setDecisionBatch({ decisions, atomic: false }, adapter),
      (error: Error) => {
        assert.ok(error.message.includes('Batch validation failed'));
        assert.ok(error.message.includes('key'));
        return true;
      }
    );
  });

  it('should suggest closest match for typos in layer', async () => {
    const decisions = [
      { key: 'test', value: 'test', layer: 'busines' }, // Typo: missing 's'
    ];

    await assert.rejects(
      async () => await setDecisionBatch({ decisions }, adapter),
      (error: Error) => {
        assert.ok(error.message.includes('busines'));
        assert.ok(error.message.includes('business') || error.message.includes('closest match'));
        return true;
      }
    );
  });

  it('should suggest closest match for typos in status', async () => {
    const decisions = [
      { key: 'test', value: 'test', status: 'activ' as any }, // Typo: missing 'e'
    ];

    await assert.rejects(
      async () => await setDecisionBatch({ decisions }, adapter),
      (error: Error) => {
        assert.ok(error.message.includes('activ'));
        assert.ok(error.message.includes('active') || error.message.includes('closest match'));
        return true;
      }
    );
  });
});
