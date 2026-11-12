/**
 * Muse Code Hook Normalization Unit Tests
 *
 * Payloads are verbatim captures from Muse Code 1.4.15 interactive sessions
 * (2026-11-12; see .sqlew/tmp/muse-hook-samples/NOTES.md).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  normalizeHookInput,
  buildPostToolUseContextOutput,
  sendContinue,
  toMusePlainText,
} from '../../../cli/hooks/stdin-parser.js';
const MUSE_BASE = {
  session_id: '01a1ce6d-2d90-7ae0-a8da-d9df62d665ce',
  turn_id: '01a1ce6d-3707-7513-b62e-6fa8dc1252df',
  cwd: 'C:\\Users\\dev\\project',
  transcript_path: null,
  model: 'muse-wonder-full-1.0',
  permission_mode: 'default',
  model_provider: 'meta',
};

describe('muse-hook-normalization', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.MUSE_SESSION_ID;
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
    it('detects Muse via model_provider and maps write_file to Write with file_path', () => {
      const result = normalizeHookInput({
        ...MUSE_BASE,
        hook_event_name: 'PostToolUse',
        tool_name: 'write_file',
        tool_input: { path: 'src/foo.ts', content: 'x' },
        tool_use_id: 'call_1',
      });
      assert.strictEqual(result.client, 'muse');
      assert.strictEqual(result.tool_name, 'Write');
      assert.strictEqual(result.tool_input?.file_path, 'src/foo.ts');
      assert.strictEqual(result.cwd, 'C:\\Users\\dev\\project');
    });

    it('maps edit_file to Edit with old_string/new_string from find/replace', () => {
      const result = normalizeHookInput({
        ...MUSE_BASE,
        hook_event_name: 'PreToolUse',
        tool_name: 'edit_file',
        tool_input: { path: 'out.txt', find: 'captured', replace: 'edited' },
      });
      assert.strictEqual(result.client, 'muse');
      assert.strictEqual(result.tool_name, 'Edit');
      assert.strictEqual(result.tool_input?.file_path, 'out.txt');
      assert.strictEqual(result.tool_input?.old_string, 'captured');
      assert.strictEqual(result.tool_input?.new_string, 'edited');
    });

    it('maps research and shell tools to canonical names', () => {
      const cases: Array<[string, string]> = [
        ['read_file', 'Read'],
        ['search', 'Grep'],
        ['web_search', 'WebSearch'],
        ['web_fetch', 'WebFetch'],
        ['powershell', 'Bash'],
        ['shell', 'Bash'],
        ['subagent_spawn', 'Task'],
      ];
      for (const [raw, canonical] of cases) {
        const result = normalizeHookInput({
          ...MUSE_BASE,
          hook_event_name: 'PreToolUse',
          tool_name: raw,
          tool_input: {},
        });
        assert.strictEqual(result.client, 'muse', raw);
        assert.strictEqual(result.tool_name, canonical, raw);
      }
    });

    it('does not misclassify Muse write_file as Hermes', () => {
      // Hermes native tools also include write_file/read_file; Muse must win.
      const result = normalizeHookInput({
        ...MUSE_BASE,
        hook_event_name: 'PostToolUse',
        tool_name: 'read_file',
        tool_input: { path: 'probe.txt' },
      });
      assert.strictEqual(result.client, 'muse');
    });

    it('detects Muse via MUSE_SESSION_ID env when payload lacks model_provider', () => {
      process.env.MUSE_SESSION_ID = 'sess-muse-1';
      const result = normalizeHookInput({
        hook_event_name: 'SessionStart',
        source: 'startup',
        cwd: 'C:/project',
      });
      assert.strictEqual(result.client, 'muse');
      assert.strictEqual(result.session_id, 'sess-muse-1');
    });

    it('honors explicit client muse on stdin', () => {
      const result = normalizeHookInput({
        client: 'muse',
        hook_event_name: 'PostToolUse',
        tool_name: 'write_file',
        tool_input: { path: 'a.ts', content: '' },
        cwd: 'C:/project',
      });
      assert.strictEqual(result.client, 'muse');
      assert.strictEqual(result.tool_name, 'Write');
      assert.strictEqual(result.tool_input?.file_path, 'a.ts');
    });

    it('passes unknown Muse tool names through unchanged', () => {
      const result = normalizeHookInput({
        ...MUSE_BASE,
        hook_event_name: 'PreToolUse',
        tool_name: 'submit_reminder_decision',
        tool_input: { decision: 'none' },
      });
      assert.strictEqual(result.client, 'muse');
      assert.strictEqual(result.tool_name, 'submit_reminder_decision');
    });

    it('keeps Claude payloads (no model_provider, no MUSE env) unclassified', () => {
      const result = normalizeHookInput({
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: { file_path: 'x.ts' },
        cwd: 'C:/project',
        session_id: 'claude-sess',
      });
      assert.strictEqual(result.client, undefined);
      assert.strictEqual(result.tool_name, 'Write');
    });
  });

  describe('buildPostToolUseContextOutput', () => {
    it('uses the Claude hookSpecificOutput shape for muse', () => {
      const out = buildPostToolUseContextOutput('CTX', 'muse');
      assert.deepStrictEqual(out, {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: 'CTX',
        },
      });
    });
  });

  describe('sendContinue', () => {
    function captureStdout(fn: () => void): string {
      const original = console.log;
      const lines: string[] = [];
      console.log = (...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      };
      try {
        fn();
      } finally {
        console.log = original;
      }
      return lines.join('\n');
    }

    it('stays silent for Muse PreToolUse (continue JSON is rejected there)', () => {
      normalizeHookInput({
        ...MUSE_BASE,
        hook_event_name: 'PreToolUse',
        tool_name: 'read_file',
        tool_input: { path: 'seed.txt' },
      });
      const out = captureStdout(() => sendContinue());
      assert.strictEqual(out, '');
    });

    it('still emits continue JSON for Muse PostToolUse', () => {
      normalizeHookInput({
        ...MUSE_BASE,
        hook_event_name: 'PostToolUse',
        tool_name: 'read_file',
        tool_input: { path: 'seed.txt' },
      });
      const out = captureStdout(() => sendContinue());
      assert.deepStrictEqual(JSON.parse(out), { continue: true });
    });

    it('still emits continue JSON for Claude payloads', () => {
      normalizeHookInput({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
        cwd: 'C:/project',
        session_id: 'claude-sess',
      });
      const out = captureStdout(() => sendContinue());
      assert.deepStrictEqual(JSON.parse(out), { continue: true });
    });
  });

  describe('toMusePlainText', () => {
    it('rewrites the [sqlew] prefix that Muse misreads as JSON', () => {
      assert.strictEqual(
        toMusePlainText('[sqlew] Session context (auto-injected)\nbody'),
        'sqlew: Session context (auto-injected)\nbody',
      );
    });

    it('passes other text through unchanged', () => {
      assert.strictEqual(toMusePlainText('plain text'), 'plain text');
    });
  });
});
