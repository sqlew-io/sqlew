/**
 * Hermes on-prompt integration tests
 *
 * @since v5.3.0
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
import {
  saveSessionContextMarker,
  saveCurrentPlan,
  getSessionContextMarkerPath,
} from '../../config/global-config.js';

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

describe('on-prompt (Hermes)', () => {
  let testProjectPath: string;

  beforeEach(() => {
    assert.ok(existsSync(distEntry), 'dist/index.js missing — run npm run build first');
    testProjectPath = join(tmpdir(), `sqlew-hermes-${Date.now()}`);
    mkdirSync(join(testProjectPath, '.sqlew'), { recursive: true });
    writeSessionSnapshot(testProjectPath, {
      version: SESSION_SNAPSHOT_VERSION,
      project_name: 'hermes-test',
      generated_at: new Date().toISOString(),
      decisions: [{ key: 'hermes/decision', value: 'memory block content', updated: '2026-07-02' }],
      constraints: [],
    });
  });

  afterEach(() => {
    if (existsSync(testProjectPath)) {
      rmSync(testProjectPath, { recursive: true, force: true });
    }
  });

  it('emits {context} JSON for a Hermes pre_llm_call', () => {
    const out = runHook(
      'on-prompt',
      {
        hook_event_name: 'pre_llm_call',
        cwd: projectRoot,
        session_id: 's1',
        extra: { user_message: 'plan a feature' },
      },
      { HERMES_SESSION_ID: 's1' },
    );
    const parsed = JSON.parse(out.trim());
    assert.ok(typeof parsed.context === 'string' && parsed.context.includes('sqlew'));
  });

  it('combines session context + FULL guidance on first pre_llm_call', () => {
    const out = runHook(
      'on-prompt',
      {
        hook_event_name: 'pre_llm_call',
        cwd: testProjectPath,
        session_id: 'hermes-first',
      },
      { HERMES_SESSION_ID: 'hermes-first' },
    );
    const parsed = JSON.parse(out.trim());
    assert.ok(parsed.context.includes('memory block content'));
    assert.ok(parsed.context.includes('Plan mode active'));
  });

  it('emits SHORT guidance only on second call with same session_id', () => {
    saveSessionContextMarker(testProjectPath, {
      session_id: 'hermes-repeat',
      injected_at: new Date().toISOString(),
      harness: 'hermes',
    });
    saveCurrentPlan(testProjectPath, {
      plan_id: 'plan-repeat',
      plan_file: 'hermes-plan.md',
      plan_updated_at: new Date().toISOString(),
      recorded: false,
      enforcement_shown_at: new Date().toISOString(),
    });

    const out = runHook(
      'on-prompt',
      {
        hook_event_name: 'pre_llm_call',
        cwd: testProjectPath,
        session_id: 'hermes-repeat',
      },
      { HERMES_SESSION_ID: 'hermes-repeat' },
    );
    const parsed = JSON.parse(out.trim());
    assert.ok(!parsed.context.includes('memory block content'));
    assert.ok(parsed.context.includes('Plan guidance active'));
  });

  it('deduplicates Codex session context via marker', () => {
    saveSessionContextMarker(testProjectPath, {
      session_id: 'codex-same',
      injected_at: new Date().toISOString(),
      harness: 'codex',
    });

    const out = runHook(
      'on-prompt',
      {
        hook_event_name: 'UserPromptSubmit',
        cwd: testProjectPath,
        session_id: 'codex-same',
        collaboration_mode: 'default',
      },
      { CODEX_SESSION_ID: 'codex-same' },
    );

    assert.strictEqual(out.trim(), '');
    assert.ok(existsSync(getSessionContextMarkerPath(testProjectPath)));
  });
});