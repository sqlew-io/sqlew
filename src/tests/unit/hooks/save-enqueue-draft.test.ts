/**
 * Plan-less save enqueue helpers
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
} from '../../../cli/hooks/save.js';
import { readQueue, clearQueue } from '../../../utils/hook-queue.js';

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
