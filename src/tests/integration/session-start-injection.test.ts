/**
 * SessionStart context injection integration tests
 *
 * @since v5.4.0
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  writeSessionSnapshot,
  SESSION_SNAPSHOT_VERSION,
} from '../../utils/session-snapshot.js';

const projectRoot = join(import.meta.dirname, '../../..');
const distEntry = join(projectRoot, 'dist/index.js');

function runHook(cmd: string, payload: object, env: Record<string, string> = {}): string {
  return execFileSync('node', [distEntry, cmd], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    cwd: projectRoot,
    env: { ...process.env, ...env },
  });
}

describe('on-session-start injection', () => {
  let testProjectPath: string;

  beforeEach(() => {
    assert.ok(existsSync(distEntry), 'dist/index.js missing — run npm run build first');
    testProjectPath = join(tmpdir(), `sqlew-ss-${Date.now()}`);
    mkdirSync(join(testProjectPath, '.sqlew'), { recursive: true });
    writeSessionSnapshot(testProjectPath, {
      version: SESSION_SNAPSHOT_VERSION,
      project_name: 'integration-test',
      generated_at: new Date().toISOString(),
      decisions: [{ key: 'hooks/test', value: 'injected decision', updated: '2026-07-02' }],
      constraints: [{ category: 'architecture', rule: 'no db in hooks', priority: 'high' }],
    });
  });

  afterEach(() => {
    if (existsSync(testProjectPath)) {
      rmSync(testProjectPath, { recursive: true, force: true });
    }
  });

  it('should inject context on Claude startup', () => {
    const out = runHook('on-session-start', {
      hook_event_name: 'SessionStart',
      source: 'startup',
      cwd: testProjectPath,
      session_id: 's-startup-1',
    });
    const parsed = JSON.parse(out.trim());
    assert.strictEqual(parsed.continue, true);
    assert.ok(typeof parsed.additionalContext === 'string');
    assert.ok(parsed.additionalContext.includes('injected decision'));
    assert.strictEqual(parsed.hookSpecificOutput?.hookEventName, 'SessionStart');
    assert.ok(parsed.hookSpecificOutput?.additionalContext?.includes('no db in hooks'));
  });

  it('should not inject on resume', () => {
    const out = runHook('on-session-start', {
      hook_event_name: 'SessionStart',
      source: 'resume',
      cwd: testProjectPath,
      session_id: 's-resume-1',
    });
    const parsed = JSON.parse(out.trim());
    assert.strictEqual(parsed.continue, true);
    assert.strictEqual(parsed.additionalContext, undefined);
    assert.strictEqual(parsed.hookSpecificOutput, undefined);
  });

  it('should continue without context when snapshot is missing', () => {
    const emptyPath = join(tmpdir(), `sqlew-empty-${Date.now()}`);
    mkdirSync(join(emptyPath, '.sqlew'), { recursive: true });

    const out = runHook('on-session-start', {
      hook_event_name: 'SessionStart',
      source: 'startup',
      cwd: emptyPath,
      session_id: 's-empty-1',
    });
    const parsed = JSON.parse(out.trim());
    assert.strictEqual(parsed.continue, true);
    assert.strictEqual(parsed.additionalContext, undefined);

    rmSync(emptyPath, { recursive: true, force: true });
  });

  it('should inject on clear source (coexists with plan rescue)', () => {
    const out = runHook('on-session-start', {
      hook_event_name: 'SessionStart',
      source: 'clear',
      cwd: testProjectPath,
      session_id: 's-clear-1',
    });
    const parsed = JSON.parse(out.trim());
    assert.strictEqual(parsed.continue, true);
    assert.ok(parsed.additionalContext?.includes('sqlew'));
  });
});