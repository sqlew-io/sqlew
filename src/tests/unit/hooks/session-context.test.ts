/**
 * Session context hook helpers unit tests
 *
 * @since v5.4.0
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  formatContextBlock,
  loadSnapshot,
  shouldInjectOnPrompt,
} from '../../../cli/hooks/session-context.js';
import { saveSessionContextMarker } from '../../../config/global-config.js';
import {
  SESSION_SNAPSHOT_VERSION,
  writeSessionSnapshot,
  type SessionSnapshot,
} from '../../../utils/session-snapshot.js';

let testProjectPath: string;

function makeSnapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    version: SESSION_SNAPSHOT_VERSION,
    project_name: 'test',
    generated_at: new Date().toISOString(),
    decisions: [{ key: 'test/key', value: 'test value', updated: '2026-07-02' }],
    constraints: [{ category: 'architecture', rule: 'no views', priority: 'high' }],
    ...overrides,
  };
}

describe('session-context helpers', () => {
  beforeEach(() => {
    testProjectPath = join(tmpdir(), `sqlew-ctx-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(testProjectPath, '.sqlew'), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testProjectPath)) {
      rmSync(testProjectPath, { recursive: true, force: true });
    }
  });

  describe('formatContextBlock', () => {
    it('should return null for budget 0', () => {
      assert.strictEqual(formatContextBlock(makeSnapshot(), 0), null);
    });

    it('should return null when both lists are empty', () => {
      assert.strictEqual(
        formatContextBlock(makeSnapshot({ decisions: [], constraints: [] }), 500),
        null,
      );
    });

    it('should format constraints before decisions', () => {
      const block = formatContextBlock(makeSnapshot(), 500);
      assert.ok(block);
      const constraintPos = block!.indexOf('Active Constraints');
      const decisionPos = block!.indexOf('Recent Decisions');
      assert.ok(constraintPos < decisionPos);
    });

    it('should trim content exceeding budget', () => {
      const manyDecisions = Array.from({ length: 50 }, (_, i) => ({
        key: `key/${i}`,
        value: 'x'.repeat(100),
        updated: '2026-07-02',
      }));
      const block = formatContextBlock(makeSnapshot({ decisions: manyDecisions }), 50);
      assert.ok(block);
      assert.ok(block!.length < manyDecisions.length * 100);
    });
  });

  describe('loadSnapshot', () => {
    it('should return null when file is missing', async () => {
      assert.strictEqual(await loadSnapshot(testProjectPath), null);
    });

    it('should return null for version mismatch', async () => {
      writeSessionSnapshot(testProjectPath, {
        ...makeSnapshot(),
        version: 99 as typeof SESSION_SNAPSHOT_VERSION,
      });
      assert.strictEqual(await loadSnapshot(testProjectPath), null);
    });

    it('should return null for stale snapshot (>30 days)', async () => {
      const stale = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
      writeSessionSnapshot(testProjectPath, makeSnapshot({ generated_at: stale }));
      assert.strictEqual(await loadSnapshot(testProjectPath), null);
    });

    it('should return null for corrupt JSON', async () => {
      writeFileSync(
        join(testProjectPath, '.sqlew', 'session-context.json'),
        '{not valid json',
        'utf-8',
      );
      assert.strictEqual(await loadSnapshot(testProjectPath), null);
    });

    it('should load valid snapshot', async () => {
      writeSessionSnapshot(testProjectPath, makeSnapshot());
      const loaded = await loadSnapshot(testProjectPath);
      assert.ok(loaded);
      assert.strictEqual(loaded!.project_name, 'test');
    });
  });

  describe('shouldInjectOnPrompt', () => {
    it('should return false when session_id is missing', () => {
      assert.strictEqual(shouldInjectOnPrompt(testProjectPath, undefined), false);
    });

    it('should return true for new session_id', () => {
      saveSessionContextMarker(testProjectPath, {
        session_id: 'old-session',
        injected_at: new Date().toISOString(),
        harness: 'hermes',
      });
      assert.strictEqual(shouldInjectOnPrompt(testProjectPath, 'new-session'), true);
    });

    it('should return false for same session_id', () => {
      saveSessionContextMarker(testProjectPath, {
        session_id: 'same-session',
        injected_at: new Date().toISOString(),
        harness: 'codex',
      });
      assert.strictEqual(shouldInjectOnPrompt(testProjectPath, 'same-session'), false);
    });

    it('should dedup omp harness marker for same session_id', () => {
      saveSessionContextMarker(testProjectPath, {
        session_id: 'omp-session',
        injected_at: new Date().toISOString(),
        harness: 'omp',
      });
      assert.strictEqual(shouldInjectOnPrompt(testProjectPath, 'omp-session'), false);
      assert.strictEqual(shouldInjectOnPrompt(testProjectPath, 'other-omp'), true);
    });
  });
});