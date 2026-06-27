/**
 * Hermes Hook Normalization Unit Tests
 *
 * @since v5.3.0
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  normalizeHookInput,
  isPlanMode,
  isPlanFile,
  getProjectPath,
} from '../../../cli/hooks/stdin-parser.js';

describe('hermes-hook-normalization', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.CODEX_SESSION_ID;
    delete process.env.CODEX_CWD;
    delete process.env.CODEX_HOME;
    delete process.env.GROK_HOOK_EVENT;
    delete process.env.GROK_WORKSPACE_ROOT;
    delete process.env.HERMES_SESSION_ID;
    delete process.env.HERMES_HOME;
    delete process.env._HERMES_GATEWAY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('normalizeHookInput', () => {
    it('should map Hermes pre_tool_call + terminal to PreToolUse + Bash', () => {
      const result = normalizeHookInput({
        hook_event_name: 'pre_tool_call',
        tool_name: 'terminal',
        tool_input: { command: 'gh pr create' },
        session_id: 'sess-h1',
        cwd: 'C:/project',
        extra: { task_id: 't1' },
      });
      assert.strictEqual(result.client, 'hermes');
      assert.strictEqual(result.hook_event_name, 'PreToolUse');
      assert.strictEqual(result.tool_name, 'Bash');
      assert.strictEqual(result.cwd, 'C:/project');
      assert.strictEqual(result.session_id, 'sess-h1');
    });

    it('should map Hermes post_tool_call + write_file to PostToolUse + Write', () => {
      const result = normalizeHookInput({
        hook_event_name: 'post_tool_call',
        tool_name: 'write_file',
        tool_input: { path: 'src/foo.ts' },
        cwd: 'C:/project',
      });
      assert.strictEqual(result.client, 'hermes');
      assert.strictEqual(result.hook_event_name, 'PostToolUse');
      assert.strictEqual(result.tool_name, 'Write');
      assert.strictEqual(result.tool_input?.file_path, 'src/foo.ts');
    });

    it('should map Hermes patch to Edit and todo to TodoWrite', () => {
      assert.strictEqual(
        normalizeHookInput({ hook_event_name: 'post_tool_call', tool_name: 'patch', cwd: 'C:/p' }).tool_name,
        'Edit',
      );
      assert.strictEqual(
        normalizeHookInput({ hook_event_name: 'post_tool_call', tool_name: 'todo', cwd: 'C:/p' }).tool_name,
        'TodoWrite',
      );
    });

    it('should map pre_llm_call to UserPromptSubmit', () => {
      const result = normalizeHookInput({
        hook_event_name: 'pre_llm_call',
        cwd: 'C:/project',
        session_id: 'sess-h2',
        extra: { user_message: 'do the thing' },
      });
      assert.strictEqual(result.client, 'hermes');
      assert.strictEqual(result.hook_event_name, 'UserPromptSubmit');
    });

    it('should detect Hermes via env when stdin lacks tool fields', () => {
      process.env.HERMES_SESSION_ID = 'sess-env';
      const result = normalizeHookInput({ hook_event_name: 'on_session_start', cwd: 'C:/p' });
      assert.strictEqual(result.client, 'hermes');
      assert.strictEqual(result.hook_event_name, 'SessionStart');
    });

    it('should not misclassify a Claude payload as Hermes', () => {
      const result = normalizeHookInput({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
      });
      assert.notStrictEqual(result.client, 'hermes');
      assert.strictEqual(result.tool_name, 'Bash');
    });
  });

  describe('isPlanMode (Hermes)', () => {
    it('should return false for Hermes (no native plan permission mode)', () => {
      const result = normalizeHookInput({
        hook_event_name: 'pre_llm_call',
        cwd: 'C:/project',
        extra: { user_message: 'plan something' },
      });
      assert.strictEqual(isPlanMode(result), false);
    });
  });

  describe('hermes plan-file + project path', () => {
    it('should recognize .hermes/plans/*.md as a plan file', () => {
      assert.strictEqual(
        isPlanFile({ tool_input: { file_path: 'C:/proj/.hermes/plans/2026-06-27_x.md' } }),
        true,
      );
    });

    it('should still recognize .claude/plans/*.md (no regression)', () => {
      assert.strictEqual(
        isPlanFile({ tool_input: { file_path: '.claude/plans/foo.md' } }),
        true,
      );
    });

    it('should resolve project path from Hermes cwd', () => {
      assert.strictEqual(getProjectPath({ client: 'hermes', cwd: 'C:/proj' }), 'C:/proj');
    });
  });
});