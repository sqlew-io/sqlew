/**
 * Hermes side-effect hook integration tests
 *
 * @since v5.3.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'path';
import { areAllTodosCompleted, normalizeHookInput } from '../../cli/hooks/stdin-parser.js';

const projectRoot = join(import.meta.dirname, '../../..');
const distEntry = join(projectRoot, 'dist/index.js');

describe('hermes side-effect hooks', () => {
  it('normalizes Hermes write_file for track-plan matching', () => {
    const input = normalizeHookInput({
      hook_event_name: 'pre_tool_call',
      tool_name: 'write_file',
      tool_input: { path: '.hermes/plans/2026-06-27_test.md' },
      cwd: projectRoot,
      extra: {},
    });
    assert.strictEqual(input.tool_name, 'Write');
    assert.strictEqual(input.tool_input?.file_path, '.hermes/plans/2026-06-27_test.md');
  });

  it('does not treat cancelled todos as all completed', () => {
    const input = normalizeHookInput({
      hook_event_name: 'post_tool_call',
      tool_name: 'todo',
      tool_input: {
        todos: [
          { content: 'a', status: 'completed' },
          { content: 'b', status: 'cancelled' },
        ],
      },
      cwd: projectRoot,
      extra: {},
    });
    assert.strictEqual(areAllTodosCompleted(input), false);
  });

  it('runs save hook with exit 0 for Hermes write_file payload', () => {
    assert.ok(existsSync(distEntry), 'dist/index.js missing — run npm run build first');
    const out = execFileSync('node', [distEntry, 'save'], {
      input: JSON.stringify({
        hook_event_name: 'post_tool_call',
        tool_name: 'write_file',
        tool_input: { path: 'README.md' },
        cwd: projectRoot,
      }),
      encoding: 'utf8',
      cwd: projectRoot,
      env: { ...process.env, HERMES_SESSION_ID: 's1' },
    });
    assert.ok(out.includes('continue') || out.trim() === '' || out.includes('hookSpecificOutput'));
  });
});