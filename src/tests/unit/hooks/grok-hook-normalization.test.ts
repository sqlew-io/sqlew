/**
 * Grok Build Hook Normalization Unit Tests
 *
 * Tests normalizeHookInput() and computeGrokPlanPath() for Grok Build compatibility.
 *
 * @since v5.2.0
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { homedir } from 'os';
import { join } from 'path';
import {
  normalizeHookInput,
  computeGrokPlanPath,
  isPlanMode,
} from '../../../cli/hooks/stdin-parser.js';
import { determineProjectRoot } from '../../../utils/project-root.js';

describe('grok-hook-normalization', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.GROK_HOOK_EVENT;
    delete process.env.GROK_WORKSPACE_ROOT;
    delete process.env.GROK_SESSION_ID;
    delete process.env.CLAUDE_PROJECT_DIR;
    delete process.env.SQLEW_PROJECT_ROOT;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('normalizeHookInput', () => {
    it('should pass through Claude payloads unchanged', () => {
      const input = {
        hook_event_name: 'PostToolUse',
        tool_name: 'ExitPlanMode',
        cwd: 'C:/project',
        session_id: 'abc-123',
      };
      const result = normalizeHookInput(input);
      assert.strictEqual(result.hook_event_name, 'PostToolUse');
      assert.strictEqual(result.tool_name, 'ExitPlanMode');
      assert.strictEqual(result.client, undefined);
    });

    it('should normalize Grok camelCase payload to Claude shape', () => {
      const result = normalizeHookInput({
        hookEventName: 'post_tool_use',
        toolName: 'exit_plan_mode',
        sessionId: '019eb585-d6ec-7ae0-992a-d60340763a20',
        workspaceRoot: 'C:\\Users\\kitayama\\RustroverProjects\\mcp-sqlew',
      });
      assert.strictEqual(result.client, 'grok');
      assert.strictEqual(result.hook_event_name, 'PostToolUse');
      assert.strictEqual(result.tool_name, 'ExitPlanMode');
      assert.strictEqual(result.session_id, '019eb585-d6ec-7ae0-992a-d60340763a20');
      assert.strictEqual(result.cwd, 'C:\\Users\\kitayama\\RustroverProjects\\mcp-sqlew');
    });

    it('should map enter_plan_mode PreToolUse event', () => {
      const result = normalizeHookInput({
        hookEventName: 'pre_tool_use',
        toolName: 'enter_plan_mode',
        workspaceRoot: 'C:/project',
      });
      assert.strictEqual(result.hook_event_name, 'PreToolUse');
      assert.strictEqual(result.tool_name, 'EnterPlanMode');
    });

    it('should use env vars when stdin is empty', () => {
      process.env.GROK_HOOK_EVENT = 'post_tool_use';
      process.env.GROK_WORKSPACE_ROOT = 'C:/project';
      process.env.GROK_SESSION_ID = 'sess-1';

      const result = normalizeHookInput({});
      assert.strictEqual(result.client, 'grok');
      assert.strictEqual(result.hook_event_name, 'PostToolUse');
      assert.strictEqual(result.cwd, 'C:/project');
      assert.strictEqual(result.session_id, 'sess-1');
    });
  });

  describe('isPlanMode', () => {
    it('should detect Claude plan mode via permission_mode', () => {
      assert.strictEqual(
        isPlanMode({ hook_event_name: 'UserPromptSubmit', permission_mode: 'plan' }),
        true,
      );
    });

    it('should return false for Claude non-plan prompts', () => {
      assert.strictEqual(
        isPlanMode({ hook_event_name: 'UserPromptSubmit', permission_mode: 'default' }),
        false,
      );
    });

    it('should detect Grok plan mode after normalization (enter_plan_mode)', () => {
      // Regression: normalizeHookInput maps enter_plan_mode -> EnterPlanMode,
      // so isPlanMode must match the normalized PascalCase name.
      const normalized = normalizeHookInput({
        hookEventName: 'pre_tool_use',
        toolName: 'enter_plan_mode',
        workspaceRoot: 'C:/project',
      });
      assert.strictEqual(isPlanMode(normalized), true);
    });

    it('should detect Grok plan mode after normalization (exit_plan_mode)', () => {
      const normalized = normalizeHookInput({
        hookEventName: 'post_tool_use',
        toolName: 'exit_plan_mode',
        workspaceRoot: 'C:/project',
      });
      assert.strictEqual(isPlanMode(normalized), true);
    });

    it('should accept raw snake_case tool names defensively', () => {
      assert.strictEqual(isPlanMode({ tool_name: 'enter_plan_mode' }), true);
    });

    it('should return false for unrelated tools', () => {
      assert.strictEqual(isPlanMode({ tool_name: 'Bash' }), false);
    });
  });

  describe('computeGrokPlanPath', () => {
    it('should encode Windows workspace path for session directory', () => {
      const workspace = 'C:\\Users\\kitayama\\RustroverProjects\\mcp-sqlew';
      const sessionId = '019eb585-d6ec-7ae0-992a-d60340763a20';
      const planPath = computeGrokPlanPath(workspace, sessionId);

      const encoded = encodeURIComponent(workspace);
      assert.strictEqual(
        planPath,
        join(homedir(), '.grok', 'sessions', encoded, sessionId, 'plan.md'),
      );
    });

    it('should reject path traversal in sessionId', () => {
      assert.strictEqual(computeGrokPlanPath('C:/project', '../escape'), null);
      assert.strictEqual(computeGrokPlanPath('C:/project', ''), null);
    });
  });

  describe('determineProjectRoot', () => {
    it('should prefer GROK_WORKSPACE_ROOT over SQLEW_PROJECT_ROOT', () => {
      process.env.GROK_WORKSPACE_ROOT = 'C:/grok-workspace';
      process.env.SQLEW_PROJECT_ROOT = 'C:/other';
      assert.strictEqual(determineProjectRoot({}), 'C:/grok-workspace');
    });

    it('should prefer CLAUDE_PROJECT_DIR over GROK_WORKSPACE_ROOT', () => {
      process.env.CLAUDE_PROJECT_DIR = 'C:/claude-project';
      process.env.GROK_WORKSPACE_ROOT = 'C:/grok-workspace';
      assert.strictEqual(determineProjectRoot({}), 'C:/claude-project');
    });
  });
});