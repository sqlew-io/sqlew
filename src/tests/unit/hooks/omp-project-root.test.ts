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

// determineProjectRoot uses path.isAbsolute(), which is platform-specific:
// 'C:/...' is absolute only on win32. Build paths that are absolute on the
// current platform so the precedence assertions hold on Linux CI too.
const absRoot = (p: string): string => (process.platform === 'win32' ? `C:${p}` : p);

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
    const ompRoot = absRoot('/Users/kitayama/RustroverProjects/demo');
    process.env.OMP_PROJECT_ROOT = ompRoot;
    const root = determineProjectRoot();
    assert.equal(root, ompRoot.replace(/\\/g, '/'));
    assert.equal(wasProjectRootExplicit(), true);
  });

  it('does not override CLAUDE_PROJECT_DIR', () => {
    stashEnv();
    const claudeRoot = absRoot('/claude-project');
    const ompRoot = absRoot('/omp-project');
    process.env.CLAUDE_PROJECT_DIR = claudeRoot;
    process.env.OMP_PROJECT_ROOT = ompRoot;
    const root = determineProjectRoot();
    assert.equal(root, claudeRoot.replace(/\\/g, '/'));
  });

  it('is used by getProjectPath fallback', async () => {
    stashEnv();
    const ompRoot = absRoot('/omp-only');
    process.env.OMP_PROJECT_ROOT = ompRoot;
    const { getProjectPath } = await import('../../../cli/hooks/stdin-parser.js');
    assert.equal(getProjectPath({}), ompRoot);
  });
});
