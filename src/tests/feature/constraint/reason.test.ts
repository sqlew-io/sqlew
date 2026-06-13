/**
 * Constraint Reason Field Feature Tests
 *
 * Verifies add → get round-trip for the optional reason field on constraints.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdirSync } from 'node:fs';
import { getAdapter, initializeDatabase, closeDatabase } from '../../../database.js';
import { ProjectContext } from '../../../utils/project-context.js';
import { addConstraint, getConstraints } from '../../../tools/constraints/index.js';

const TEST_DB_PATH = '.tmp-test/constraint-reason.db';

describe('Constraint Reason Field', () => {
  before(async () => {
    mkdirSync('.tmp-test', { recursive: true });
    const adapter = await initializeDatabase({
      databaseType: 'sqlite',
      connection: { filename: TEST_DB_PATH }
    });

    const knex = adapter.getKnex();
    const projectContext = ProjectContext.getInstance();
    await projectContext.ensureProject(knex, 'test-constraint-reason', 'config', {
      projectRootPath: process.cwd(),
    });
  });

  after(async () => {
    await closeDatabase();
  });

  it('should round-trip reason on add → get', async () => {
    const reason = 'Prevents unbounded memory growth in long-running sessions';
    const constraintText = 'reason-roundtrip-test-constraint';

    const addResult = await addConstraint({
      category: 'architecture',
      constraint_text: constraintText,
      priority: 'high',
      reason,
    });

    const getResult = await getConstraints({ category: 'architecture' });
    const constraint = getResult.constraints.find(
      (c) => c.id === addResult.constraint_id
    );

    assert.ok(constraint, 'Expected constraint to be found by id');
    assert.ok('reason' in constraint!);
    assert.strictEqual(constraint!.reason, reason);
  });

  it('should omit reason field when not provided on add → get', async () => {
    const constraintText = 'no-reason-test-constraint';

    const addResult = await addConstraint({
      category: 'security',
      constraint_text: constraintText,
      priority: 'medium',
    });

    const getResult = await getConstraints({ category: 'security' });
    const constraint = getResult.constraints.find(
      (c) => c.id === addResult.constraint_id
    );

    assert.ok(constraint, 'Expected constraint to be found by id');
    assert.ok(!('reason' in constraint!));
    assert.strictEqual(constraint!.reason, undefined);
  });

  it('should return success and constraint_id from add response', async () => {
    const addResult = await addConstraint({
      category: 'code-style',
      constraint_text: 'add-response-regression-test',
      priority: 'low',
      reason: 'Regression check for add response shape',
    });

    assert.strictEqual(addResult.success, true);
    assert.ok(addResult.constraint_id !== undefined && addResult.constraint_id !== null);
  });
});