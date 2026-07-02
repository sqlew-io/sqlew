/**
 * Session snapshot feature tests
 *
 * @since v5.4.0
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getAdapter, initializeDatabase, closeDatabase } from '../../../database.js';
import { ProjectContext } from '../../../utils/project-context.js';
import { setDecision } from '../../../tools/context/index.js';
import { setDecisionBatch } from '../../../tools/context/actions/batch-set.js';
import { addConstraint, deactivateConstraint } from '../../../tools/constraints/index.js';
import {
  getSnapshotPath,
  readSessionSnapshot,
  refreshSnapshotNow,
  flushSnapshotRefresh,
  SESSION_SNAPSHOT_VERSION,
  MAX_SNAPSHOT_DECISIONS,
} from '../../../utils/session-snapshot.js';

const TEST_DB_PATH = '.tmp-test/session-snapshot.db';
let testProjectRoot: string;
let testProjectName: string;

describe('session-snapshot', () => {
  before(async () => {
    mkdirSync('.tmp-test', { recursive: true });
    testProjectRoot = join(tmpdir(), `sqlew-snapshot-${Date.now()}`);
    testProjectName = `test-session-snapshot-${Date.now()}`;
    mkdirSync(join(testProjectRoot, '.sqlew'), { recursive: true });

    const adapter = await initializeDatabase({
      databaseType: 'sqlite',
      connection: { filename: TEST_DB_PATH },
    });

    const knex = adapter.getKnex();
    ProjectContext.reset();
    const projectContext = ProjectContext.getInstance();
    await projectContext.ensureProject(knex, testProjectName, 'config', {
      projectRootPath: testProjectRoot,
    });
  });

  after(async () => {
    await closeDatabase();
    if (existsSync(testProjectRoot)) {
      rmSync(testProjectRoot, { recursive: true, force: true });
    }
  });

  it('should write snapshot after decision set', async () => {
    await setDecision({
      key: 'snapshot/test-decision',
      value: 'Use snapshot architecture',
      layer: 'infrastructure',
      tags: ['hooks', 'snapshot'],
    });
    await flushSnapshotRefresh();

    const snapshot = readSessionSnapshot(testProjectRoot);
    assert.ok(snapshot, 'snapshot file should exist');
    assert.strictEqual(snapshot!.version, SESSION_SNAPSHOT_VERSION);
    assert.ok(
      snapshot!.decisions.some(d => d.key === 'snapshot/test-decision'),
      'decision should appear in snapshot',
    );
  });

  it('should write snapshot after constraint add', async () => {
    await addConstraint({
      category: 'architecture',
      constraint_text: 'snapshot-test-constraint-rule',
      priority: 'high',
      reason: 'Test reason for snapshot',
    });
    await flushSnapshotRefresh();

    const snapshot = readSessionSnapshot(testProjectRoot);
    assert.ok(snapshot);
    assert.ok(
      snapshot!.constraints.some(c => c.rule === 'snapshot-test-constraint-rule'),
      'constraint should appear in snapshot',
    );
  });

  it('should remove constraint from snapshot after deactivate', async () => {
    const addResult = await addConstraint({
      category: 'security',
      constraint_text: 'snapshot-deactivate-test',
      priority: 'medium',
    });
    await flushSnapshotRefresh();

    await deactivateConstraint({ id: addResult.constraint_id });
    await flushSnapshotRefresh();

    const snapshot = readSessionSnapshot(testProjectRoot);
    assert.ok(snapshot);
    assert.ok(
      !snapshot!.constraints.some(c => c.rule === 'snapshot-deactivate-test'),
      'deactivated constraint should not appear in snapshot',
    );
  });

  it('should debounce batch_set into a single snapshot write', async () => {
    const batch = Array.from({ length: 3 }, (_, i) => ({
      key: `snapshot/batch-${i}`,
      value: `batch value ${i}`,
      layer: 'business',
    }));

    await setDecisionBatch({ decisions: batch });
    await flushSnapshotRefresh();

    const snapshot = readSessionSnapshot(testProjectRoot);
    assert.ok(snapshot);
    const batchKeys = batch.map(b => b.key);
    const found = snapshot!.decisions.filter(d => batchKeys.includes(d.key));
    assert.strictEqual(found.length, 3);
  });

  it('should cap decisions at MAX_SNAPSHOT_DECISIONS', async () => {
    const extra = Array.from({ length: MAX_SNAPSHOT_DECISIONS + 2 }, (_, i) => ({
      key: `snapshot/cap-${i}`,
      value: `cap test ${i}`,
      layer: 'business',
    }));
    await setDecisionBatch({ decisions: extra });
    await refreshSnapshotNow();

    const snapshot = readSessionSnapshot(testProjectRoot);
    assert.ok(snapshot);
    assert.ok(snapshot!.decisions.length <= MAX_SNAPSHOT_DECISIONS);
  });

  it('should write atomically to session-context.json', async () => {
    await refreshSnapshotNow();
    const snapshotPath = getSnapshotPath(testProjectRoot);
    assert.ok(existsSync(snapshotPath));
    const snapshot = readSessionSnapshot(testProjectRoot);
    assert.ok(snapshot?.generated_at);
    assert.ok(Array.isArray(snapshot!.decisions));
    assert.ok(Array.isArray(snapshot!.constraints));
  });
});