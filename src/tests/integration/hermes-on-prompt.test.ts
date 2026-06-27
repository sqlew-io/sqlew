/**
 * Hermes on-prompt integration tests
 *
 * @since v5.3.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'path';

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
  it('emits {context} JSON for a Hermes pre_llm_call', () => {
    assert.ok(existsSync(distEntry), 'dist/index.js missing — run npm run build first');
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
});