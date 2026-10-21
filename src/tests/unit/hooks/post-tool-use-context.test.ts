/**
 * PostToolUse context adapters — client-correct JSON shapes.
 *
 * Locked 2026-10-21 (Post-only inject):
 * - Cursor → top-level additional_context
 * - Claude / Grok → hookSpecificOutput.additionalContext
 * - omp / Codex → top-level additionalContext
 * - Hermes → continue only (no Post inject)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  buildPostToolUseContextOutput,
  normalizeHookInput,
  type HookClient,
} from '../../../cli/hooks/stdin-parser.js';

const SAMPLE = 'Related Context: use decision X';

describe('buildPostToolUseContextOutput', () => {
  it('Cursor: top-level additional_context (snake_case)', () => {
    const out = buildPostToolUseContextOutput(SAMPLE, 'cursor');
    assert.deepStrictEqual(out, { additional_context: SAMPLE });
    assert.strictEqual('additionalContext' in out, false);
    assert.strictEqual('hookSpecificOutput' in out, false);
  });

  it('Claude: nested hookSpecificOutput.additionalContext', () => {
    const out = buildPostToolUseContextOutput(SAMPLE, 'claude');
    assert.deepStrictEqual(out, {
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: SAMPLE,
      },
    });
  });

  it('Grok: same nested shape as Claude', () => {
    const out = buildPostToolUseContextOutput(SAMPLE, 'grok');
    assert.deepStrictEqual(out, {
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: SAMPLE,
      },
    });
  });

  it('omp: top-level additionalContext (camelCase)', () => {
    const out = buildPostToolUseContextOutput(SAMPLE, 'omp');
    assert.deepStrictEqual(out, { continue: true, additionalContext: SAMPLE });
    assert.strictEqual('additional_context' in out, false);
    assert.strictEqual('hookSpecificOutput' in out, false);
  });

  it('Codex: top-level additionalContext (camelCase)', () => {
    const out = buildPostToolUseContextOutput(SAMPLE, 'codex');
    assert.deepStrictEqual(out, { continue: true, additionalContext: SAMPLE });
  });

  it('Hermes: continue only (Post inject unsupported)', () => {
    const out = buildPostToolUseContextOutput(SAMPLE, 'hermes');
    assert.deepStrictEqual(out, { continue: true });
  });

  it('undefined / null client defaults to Claude nested shape', () => {
    assert.deepStrictEqual(
      buildPostToolUseContextOutput(SAMPLE, undefined),
      buildPostToolUseContextOutput(SAMPLE, 'claude'),
    );
    assert.deepStrictEqual(
      buildPostToolUseContextOutput(SAMPLE, null),
      buildPostToolUseContextOutput(SAMPLE, 'claude'),
    );
  });

  it('normalizes client string case', () => {
    const out = buildPostToolUseContextOutput(SAMPLE, 'CURSOR');
    assert.deepStrictEqual(out, { additional_context: SAMPLE });
  });

  it('unknown client falls back to Claude nested shape', () => {
    const out = buildPostToolUseContextOutput(SAMPLE, 'dots');
    assert.deepStrictEqual(out, {
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: SAMPLE,
      },
    });
  });

  const matrix: Array<{ client: HookClient; hasSnake: boolean; hasNested: boolean; hasCamelTop: boolean }> = [
    { client: 'cursor', hasSnake: true, hasNested: false, hasCamelTop: false },
    { client: 'claude', hasSnake: false, hasNested: true, hasCamelTop: false },
    { client: 'grok', hasSnake: false, hasNested: true, hasCamelTop: false },
    { client: 'omp', hasSnake: false, hasNested: false, hasCamelTop: true },
    { client: 'codex', hasSnake: false, hasNested: false, hasCamelTop: true },
  ];

  for (const row of matrix) {
    it(`matrix ${row.client}: key placement`, () => {
      const out = buildPostToolUseContextOutput(SAMPLE, row.client) as Record<string, unknown>;
      assert.strictEqual('additional_context' in out, row.hasSnake);
      assert.strictEqual('hookSpecificOutput' in out, row.hasNested);
      if (row.hasCamelTop) {
        assert.strictEqual(typeof out.additionalContext, 'string');
      } else if (!row.hasNested) {
        assert.strictEqual('additionalContext' in out, false);
      }
    });
  }
});

describe('normalizeHookInput explicit client', () => {
  it('preserves explicit cursor client without Grok mis-detect', () => {
    const result = normalizeHookInput({
      client: 'cursor',
      sessionId: 'conv-1',
      hook_event_name: 'PostToolUse',
      tool_name: 'Grep',
      additional_context: 'x',
    });
    assert.strictEqual(result.client, 'cursor');
    assert.strictEqual(result.hook_event_name, 'PostToolUse');
    assert.strictEqual(result.tool_name, 'Grep');
  });

  it('preserves explicit omp client', () => {
    const result = normalizeHookInput({
      client: 'omp',
      hook_event_name: 'PostToolUse',
      tool_name: 'bash',
    });
    assert.strictEqual(result.client, 'omp');
  });

  it('explicit client overrides Codex env heuristic', () => {
    const prev = process.env.CODEX_HOME;
    process.env.CODEX_HOME = '/tmp/codex-home-test';
    try {
      const result = normalizeHookInput({
        client: 'claude',
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
      });
      assert.strictEqual(result.client, 'claude');
    } finally {
      if (prev === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = prev;
      }
    }
  });
});
