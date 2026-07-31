/**
 * OMP_PROJECT_ROOT project-root resolution tests
 *
 * @since v5.4.0
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  determineProjectRoot,
  wasProjectRootExplicit,
} from '../../../utils/project-root.js';

const ENV_KEYS = [
  'CLAUDE_PROJECT_DIR',
  'GROK_WORKSPACE_ROOT',
  'CODEX_CWD',
  'TERMINAL_CWD',
  'OMP_PROJECT_ROOT',
  'SQLEW_PROJECT_ROOT',
] as const;

const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function stashEnv(): void {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
}

function restoreEnv(): void {
  for (const k of ENV_KEYS) {
    const v = saved[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe('OMP_PROJECT_ROOT', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('wins over bare cwd when set', () => {
    stashEnv();
    process.env.OMP_PROJECT_ROOT = 'C:/Users/kitayama/RustroverProjects/demo';
    const root = determineProjectRoot();
    assert.equal(root, 'C:/Users/kitayama/RustroverProjects/demo');
    assert.equal(wasProjectRootExplicit(), true);
  });

  it('does not override CLAUDE_PROJECT_DIR', () => {
    stashEnv();
    process.env.CLAUDE_PROJECT_DIR = 'C:/claude-project';
    process.env.OMP_PROJECT_ROOT = 'C:/omp-project';
    const root = determineProjectRoot();
    assert.equal(root, 'C:/claude-project');
  });

  it('is used by getProjectPath fallback', async () => {
    stashEnv();
    process.env.OMP_PROJECT_ROOT = 'C:/omp-only';
    const { getProjectPath } = await import('../../../cli/hooks/stdin-parser.js');
    assert.equal(getProjectPath({}), 'C:/omp-only');
  });
});
