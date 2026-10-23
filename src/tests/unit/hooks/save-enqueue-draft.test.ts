/**
 * Plan-less save enqueue helpers + processSaveHook coexistence
 *
 * @since v5.4.x
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  isImplementationFile,
  buildDraftDecisionKey,
  toProjectRelativePath,
  enqueueDraftFromWrite,
  processSaveHook,
} from '../../../cli/hooks/save.js';
import { readQueue, clearQueue } from '../../../utils/hook-queue.js';
import {
  saveCurrentPlan,
  loadCurrentPlan,
  clearCurrentPlan,
  type CurrentPlanInfo,
} from '../../../config/global-config.js';

function makePlan(overrides?: Partial<CurrentPlanInfo>): CurrentPlanInfo {
  return {
    plan_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    plan_file: 'test-plan.md',
    plan_updated_at: new Date().toISOString(),
    recorded: false,
    ...overrides,
  };
}

describe('save enqueue-draft helpers', () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = join(
      tmpdir(),
      `sqlew-save-draft-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(join(projectPath, 'src'), { recursive: true });
  });

  afterEach(() => {
    clearCurrentPlan(projectPath);
    if (existsSync(projectPath)) {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it('isImplementationFile gates docs, sqlew, lockfiles, md', () => {
    assert.equal(isImplementationFile('src/foo.ts'), true);
    assert.equal(isImplementationFile('src/foo.md'), false);
    assert.equal(isImplementationFile('docs/guide.ts'), false);
    assert.equal(isImplementationFile('.sqlew/queue/pending.json'), false);
    assert.equal(isImplementationFile('package-lock.json'), false);
    assert.equal(isImplementationFile('node_modules/x/index.js'), false);
    assert.equal(isImplementationFile('config.json'), false);
    assert.equal(isImplementationFile('src/config.json'), true);
    assert.equal(isImplementationFile(undefined), false);
  });

  it('buildDraftDecisionKey uses client prefix', () => {
    assert.equal(
      buildDraftDecisionKey('src/a.ts', 'cursor'),
      'cursor/auto/src/a.ts',
    );
    assert.equal(buildDraftDecisionKey('src/a.ts'), 'auto/src/a.ts');
    assert.equal(
      buildDraftDecisionKey('src/a.ts', 'Claude'),
      'claude/auto/src/a.ts',
    );
  });

  it('toProjectRelativePath strips project root', () => {
    const abs = join(projectPath, 'src', 'foo.ts');
    assert.equal(toProjectRelativePath(projectPath, abs), 'src/foo.ts');
    assert.equal(toProjectRelativePath(projectPath, 'src/bar.ts'), 'src/bar.ts');
  });

  it('enqueueDraftFromWrite writes pending.json without DB', () => {
    const filePath = join(projectPath, 'src', 'widget.ts');
    const { key, relPath } = enqueueDraftFromWrite(projectPath, filePath, {
      client: 'cursor',
      summary: 'Added widget',
    });

    assert.equal(relPath, 'src/widget.ts');
    assert.equal(key, 'cursor/auto/src/widget.ts');

    const queuePath = join(projectPath, '.sqlew', 'queue', 'pending.json');
    assert.ok(existsSync(queuePath));
    const raw = readFileSync(queuePath, 'utf-8');
    assert.ok(raw.includes('cursor/auto/src/widget.ts'));
    assert.ok(raw.includes('"status": "draft"') || raw.includes('"status":"draft"'));
    assert.ok(raw.includes('Added widget'));

    const queue = readQueue(projectPath);
    assert.equal(queue.items.length, 1);
    assert.equal(queue.items[0].type, 'decision');
    assert.equal((queue.items[0] as { action: string }).action, 'create');
  });

  it('enqueueDraftFromWrite dedupes by key', () => {
    const filePath = join(projectPath, 'src', 'once.ts');
    enqueueDraftFromWrite(projectPath, filePath, { client: 'cursor' });
    enqueueDraftFromWrite(projectPath, filePath, { client: 'cursor' });
    assert.equal(readQueue(projectPath).items.length, 1);
    clearQueue(projectPath);
    assert.equal(readQueue(projectPath).items.length, 0);
  });
});

describe('processSaveHook — draft enqueue vs plan promote', () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = join(
      tmpdir(),
      `sqlew-save-process-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(join(projectPath, 'src'), { recursive: true });
  });

  afterEach(() => {
    clearCurrentPlan(projectPath);
    if (existsSync(projectPath)) {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it('plan-less: enqueues draft only', () => {
    const filePath = join(projectPath, 'src', 'a.ts');
    const result = processSaveHook({
      projectPath,
      toolName: 'Write',
      filePath,
      client: 'cursor',
    });

    assert.equal(result.skipped, false);
    assert.equal(result.draft?.key, 'cursor/auto/src/a.ts');
    assert.equal(result.planPromoted, undefined);

    const queue = readQueue(projectPath);
    assert.equal(queue.items.length, 1);
    assert.equal((queue.items[0] as { action: string }).action, 'create');
  });

  it('tracked plan not yet promoted: enqueues draft AND promotes once', () => {
    saveCurrentPlan(projectPath, makePlan({ recorded: false }));
    const filePath = join(projectPath, 'src', 'b.ts');

    const result = processSaveHook({
      projectPath,
      toolName: 'Edit',
      filePath,
      client: 'cursor',
    });

    assert.equal(result.skipped, false);
    assert.equal(result.draft?.key, 'cursor/auto/src/b.ts');
    assert.equal(result.planPromoted?.planFile, 'test-plan.md');
    // Promote must NOT set recorded (that flag is for extraction dedup)
    assert.equal(loadCurrentPlan(projectPath)?.recorded, false);
    assert.equal(loadCurrentPlan(projectPath)?.implementation_started, true);

    const queue = readQueue(projectPath);
    // draft create + decision update + constraint activate
    assert.ok(queue.items.length >= 2);
    const types = queue.items.map((i) => `${i.type}:${(i as { action: string }).action}`);
    assert.ok(types.some((t) => t === 'decision:create'));
    assert.ok(types.some((t) => t === 'decision:update'));
  });

  it('recorded=true (extraction done) still enqueues draft; promote still runs if not started', () => {
    // recorded means SubagentStop already extracted — must not block Write→enqueue
    saveCurrentPlan(
      projectPath,
      makePlan({ recorded: true, implementation_started: false }),
    );
    const filePath = join(projectPath, 'src', 'c.ts');

    const result = processSaveHook({
      projectPath,
      toolName: 'Write',
      filePath,
      client: 'cursor',
    });

    assert.equal(result.skipped, false);
    assert.equal(result.draft?.key, 'cursor/auto/src/c.ts');
    assert.ok(result.planPromoted);
    assert.equal(loadCurrentPlan(projectPath)?.recorded, true);
    assert.equal(loadCurrentPlan(projectPath)?.implementation_started, true);

    const queue = readQueue(projectPath);
    assert.ok(queue.items.some((i) => i.type === 'decision' && i.action === 'create'));
    assert.ok(
      queue.items.some(
        (i) =>
          i.type === 'decision' &&
          i.action === 'create' &&
          i.data.key === 'cursor/auto/src/c.ts',
      ),
    );
  });

  it('implementation_started: draft only; does not re-promote or touch recorded', () => {
    saveCurrentPlan(
      projectPath,
      makePlan({ recorded: true, implementation_started: true }),
    );
    const filePath = join(projectPath, 'src', 'c2.ts');

    const result = processSaveHook({
      projectPath,
      toolName: 'Write',
      filePath,
      client: 'cursor',
    });

    assert.equal(result.skipped, false);
    assert.equal(result.draft?.key, 'cursor/auto/src/c2.ts');
    assert.equal(result.planPromoted, undefined);
    assert.equal(loadCurrentPlan(projectPath)?.recorded, true);
    assert.equal(loadCurrentPlan(projectPath)?.implementation_started, true);

    const queue = readQueue(projectPath);
    assert.equal(queue.items.length, 1);
    assert.equal(queue.items[0].action, 'create');
  });

  it('second edit after promote: draft only (implementation_started gate)', () => {
    saveCurrentPlan(projectPath, makePlan({ recorded: false }));
    const first = join(projectPath, 'src', 'd1.ts');
    const second = join(projectPath, 'src', 'd2.ts');

    const r1 = processSaveHook({
      projectPath,
      toolName: 'Write',
      filePath: first,
      client: 'cursor',
    });
    assert.ok(r1.planPromoted);
    assert.equal(loadCurrentPlan(projectPath)?.recorded, false);

    clearQueue(projectPath);

    const r2 = processSaveHook({
      projectPath,
      toolName: 'Write',
      filePath: second,
      client: 'cursor',
    });
    assert.equal(r2.planPromoted, undefined);
    assert.equal(r2.draft?.key, 'cursor/auto/src/d2.ts');
    assert.equal(readQueue(projectPath).items.length, 1);
  });

  it('skips non-implementation and non-Edit/Write tools', () => {
    saveCurrentPlan(projectPath, makePlan({ recorded: true }));
    assert.equal(
      processSaveHook({
        projectPath,
        toolName: 'Bash',
        filePath: 'src/x.ts',
      }).skipped,
      true,
    );
    assert.equal(
      processSaveHook({
        projectPath,
        toolName: 'Write',
        filePath: 'README.md',
      }).skipped,
      true,
    );
    assert.equal(readQueue(projectPath).items.length, 0);
  });
});
