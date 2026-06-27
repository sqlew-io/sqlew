/**
 * Hermes pr-adr integration tests
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

describe('pr-adr (Hermes)', () => {
  it('blocks gh pr create without ADR markers under Hermes', () => {
    assert.ok(existsSync(distEntry), 'dist/index.js missing — run npm run build first');
    let out = '';
    try {
      out = execFileSync('node', [distEntry, 'pr-adr'], {
        input: JSON.stringify({
          hook_event_name: 'pre_tool_call',
          tool_name: 'terminal',
          tool_input: { command: 'gh pr create --title x --body "no markers"' },
          cwd: projectRoot,
        }),
        encoding: 'utf8',
        cwd: projectRoot,
        env: { ...process.env, HERMES_SESSION_ID: 's1' },
      });
    } catch (e: unknown) {
      const err = e as { stdout?: Buffer | string };
      out = (err.stdout || '').toString();
    }
    const parsed = JSON.parse(out.trim().split('\n').pop()!);
    assert.strictEqual(parsed.decision, 'block');
  });
});