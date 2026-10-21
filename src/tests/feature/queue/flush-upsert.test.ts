/**
 * Write=enqueue / Stop=flush upsert — processQueue upserts by key
 *
 * @since v5.4.x
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initializeDatabase, closeDatabase, getAdapter } from '../../../database.js';
import { ProjectContext } from '../../../utils/project-context.js';
import { LocalBackend } from '../../../backend/local-backend.js';
import { resetBackend } from '../../../backend/backend-factory.js';
import {
  enqueueDecisionCreate,
  processQueue,
  readQueue,
  hasQueueItems,
} from '../../../utils/hook-queue.js';
import { processQueueItem } from '../../../utils/queue-processor.js';
import { flushPendingQueue } from '../../../cli/hooks/flush-queue.js';
import { enqueueDraftFromWrite } from '../../../cli/hooks/save.js';
import { getDecision } from '../../../tools/context/index.js';

const TEST_DB = '.tmp-test/queue-flush-upsert.db';

describe('queue flush upsert-by-key', () => {
  let projectPath: string;
  let backend: LocalBackend;

  before(async () => {
    mkdirSync('.tmp-test', { recursive: true });
    await initializeDatabase({
      databaseType: 'sqlite',
      connection: { filename: TEST_DB },
    });
    backend = new LocalBackend();
  });

  after(async () => {
    await resetBackend().catch(() => {});
    await closeDatabase();
  });

  beforeEach(async () => {
    projectPath = join(
      tmpdir(),
      `sqlew-flush-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(join(projectPath, 'src'), { recursive: true });

    ProjectContext.reset();
    const knex = getAdapter().getKnex();
    await ProjectContext.getInstance().ensureProject(
      knex,
      `flush-${Date.now()}`,
      'config',
      { projectRootPath: projectPath },
    );
  });

  afterEach(() => {
    if (existsSync(projectPath)) {
      rmSync(projectPath, { recursive: true, force: true });
    }
    ProjectContext.reset();
  });

  it('processQueue create upserts: insert then update same key', async () => {
    const key = 'cursor/auto/src/upsert-me.ts';

    enqueueDecisionCreate(projectPath, {
      key,
      value: 'first draft',
      status: 'draft',
      layer: 'cross-cutting',
      tags: ['auto-draft'],
    });

    let n = await processQueue(
      projectPath,
      (item) => processQueueItem(backend, item, 'test-1'),
      'test-1',
    );
    assert.equal(n, 1);
    assert.equal(hasQueueItems(projectPath), false);

    const first = await getDecision({ key });
    assert.equal(first.found, true);
    assert.equal(String(first.decision!.value), 'first draft');
    assert.equal(first.decision!.status, 'draft');

    enqueueDecisionCreate(projectPath, {
      key,
      value: 'updated draft value',
      status: 'draft',
      layer: 'cross-cutting',
      tags: ['auto-draft'],
    });

    n = await processQueue(
      projectPath,
      (item) => processQueueItem(backend, item, 'test-2'),
      'test-2',
    );
    assert.equal(n, 1);

    const second = await getDecision({ key });
    assert.equal(second.found, true);
    assert.equal(String(second.decision!.value), 'updated draft value');
    assert.equal(second.decision!.status, 'draft');
  });

  it('enqueueDraftFromWrite + flushPendingQueue with injected backend', async () => {
    const file = join(projectPath, 'src', 'flush-me.ts');
    const { key } = enqueueDraftFromWrite(projectPath, file, {
      client: 'cursor',
      summary: 'flush path',
    });
    assert.ok(readQueue(projectPath).items.length >= 1);

    const result = await flushPendingQueue({
      projectPath,
      backend,
      shutdown: false,
    });
    assert.equal(result.processed, 1);
    assert.equal(hasQueueItems(projectPath), false);

    const d = await getDecision({ key });
    assert.equal(d.found, true);
    assert.equal(d.decision!.status, 'draft');
    assert.ok(String(d.decision!.value).includes('flush path'));
  });
});
