/**
 * Codex Hook Normalization Unit Tests
 *
 * @since v5.2.1
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { homedir } from 'os';
import { join } from 'path';
import {
  normalizeHookInput,
  isPlanMode,
} from '../../../cli/hooks/stdin-parser.js';
import {
  findCodexTranscriptPath,
  extractPlanMarkdownFromCodexTranscript,
} from '../../../cli/hooks/codex-transcript.js';
import { determineProjectRoot } from '../../../utils/project-root.js';

describe('codex-hook-normalization', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.CODEX_SESSION_ID;
    delete process.env.CODEX_CWD;
    delete process.env.CODEX_HOME;
    delete process.env.GROK_HOOK_EVENT;
    delete process.env.GROK_WORKSPACE_ROOT;
    delete process.env.CLAUDE_PROJECT_DIR;
    delete process.env.SQLEW_PROJECT_ROOT;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('normalizeHookInput', () => {
    it('should normalize Codex shell_command to Bash', () => {
      const result = normalizeHookInput({
        hook_event_name: 'PreToolUse',
        tool_name: 'shell_command',
        cwd: 'C:/project',
      });
      assert.strictEqual(result.client, 'codex');
      assert.strictEqual(result.tool_name, 'Bash');
      assert.strictEqual(result.cwd, 'C:/project');
    });

    it('should normalize Codex apply_patch to Edit', () => {
      const result = normalizeHookInput({
        hook_event_name: 'PostToolUse',
        tool_name: 'apply_patch',
        cwd: 'C:/project',
      });
      assert.strictEqual(result.client, 'codex');
      assert.strictEqual(result.tool_name, 'Edit');
    });

    it('should map collaboration_mode plan to permission_mode plan', () => {
      const result = normalizeHookInput({
        hook_event_name: 'UserPromptSubmit',
        collaboration_mode: { mode: 'plan' },
        cwd: 'C:/project',
        session_id: 'sess-codex-1',
      });
      assert.strictEqual(result.client, 'codex');
      assert.strictEqual(result.collaboration_mode, 'plan');
      assert.strictEqual(result.permission_mode, 'plan');
    });

    it('should use CODEX env vars when stdin is empty', () => {
      process.env.CODEX_SESSION_ID = 'sess-1';
      process.env.CODEX_CWD = 'C:/project';

      const result = normalizeHookInput({});
      assert.strictEqual(result.client, 'codex');
      assert.strictEqual(result.session_id, 'sess-1');
      assert.strictEqual(result.cwd, 'C:/project');
    });
  });

  describe('isPlanMode', () => {
    it('should detect Codex plan mode via collaboration_mode', () => {
      assert.strictEqual(
        isPlanMode({ client: 'codex', collaboration_mode: 'plan' }),
        true,
      );
    });

    it('should detect Codex after normalization', () => {
      const normalized = normalizeHookInput({
        hook_event_name: 'UserPromptSubmit',
        collaboration_mode_kind: 'plan',
        cwd: 'C:/project',
      });
      assert.strictEqual(isPlanMode(normalized), true);
    });
  });

  describe('findCodexTranscriptPath', () => {
    it('should reject invalid session ids', () => {
      assert.strictEqual(findCodexTranscriptPath('../escape'), null);
      assert.strictEqual(findCodexTranscriptPath(''), null);
    });

    it('should find an existing local rollout transcript when present', () => {
      const sessionId = '019e85cb-a131-7760-9a30-f164fcf83073';
      const expected = join(
        homedir(),
        '.codex',
        'sessions',
        '2026',
        '06',
        '02',
        `rollout-2026-06-02T09-46-15-${sessionId}.jsonl`,
      );
      const found = findCodexTranscriptPath(sessionId);
      if (found) {
        assert.strictEqual(found, expected);
      }
    });
  });

  describe('extractPlanMarkdownFromCodexTranscript', () => {
    it('should return null for missing files', () => {
      assert.strictEqual(
        extractPlanMarkdownFromCodexTranscript('C:/missing/transcript.jsonl'),
        null,
      );
    });
  });

  describe('determineProjectRoot', () => {
    it('should prefer CODEX_CWD over SQLEW_PROJECT_ROOT', () => {
      process.env.CODEX_CWD = 'C:/codex-workspace';
      process.env.SQLEW_PROJECT_ROOT = 'C:/other';
      assert.strictEqual(determineProjectRoot({}), 'C:/codex-workspace');
    });
  });
});