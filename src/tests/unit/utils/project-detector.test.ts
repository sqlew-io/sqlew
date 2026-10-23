/**
 * Tests for project-detector.ts
 *
 * Priority (async): env > git > config > directory
 * Priority (sync):  env > config > directory (skips git)
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  detectProjectNameSync,
  detectProjectName,
  resolveConfiguredProjectName,
} from '../../../utils/project-detector.js';
import { SQLEW_ENV_VARS } from '../../../config/env-overrides.js';

function makeTempDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeConfig(dir: string, name: string): void {
  mkdirSync(join(dir, '.sqlew'), { recursive: true });
  writeFileSync(join(dir, '.sqlew', 'config.toml'), `[project]\nname = "${name}"\n`);
}

function initGitWithRemote(dir: string, remoteUrl: string): void {
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync(`git remote add origin ${remoteUrl}`, { cwd: dir, stdio: 'ignore' });
}

describe('Project Detector', () => {
  const originalEnv = process.env[SQLEW_ENV_VARS.PROJECT_NAME];

  beforeEach(() => {
    delete process.env[SQLEW_ENV_VARS.PROJECT_NAME];
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[SQLEW_ENV_VARS.PROJECT_NAME];
    } else {
      process.env[SQLEW_ENV_VARS.PROJECT_NAME] = originalEnv;
    }
  });

  describe('detectProjectNameSync', () => {
    it('should prefer SQLEW_PROJECT_NAME over config.toml', () => {
      const testDir = makeTempDir('project-detector-env-sync');
      writeConfig(testDir, 'from-config');
      process.env[SQLEW_ENV_VARS.PROJECT_NAME] = 'from-env';

      const result = detectProjectNameSync(testDir);

      assert.strictEqual(result.name, 'from-env');
      assert.strictEqual(result.source, 'env');
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should detect from config.toml when present', () => {
      const testDir = makeTempDir('project-detector-config');
      writeConfig(testDir, 'my-test-project');

      const result = detectProjectNameSync(testDir);

      assert.strictEqual(result.name, 'my-test-project');
      assert.strictEqual(result.source, 'config');
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should fallback to directory name when config.toml missing', () => {
      const testDir = makeTempDir('fallback-dir-name');

      const result = detectProjectNameSync(testDir);

      assert.strictEqual(result.name, testDir.split(/[/\\]/).pop());
      assert.strictEqual(result.source, 'directory');
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should handle Windows path separators', () => {
      const windowsPath = 'C:\\Users\\test\\my-windows-project';
      const result = detectProjectNameSync(windowsPath);
      assert.strictEqual(result.name, 'my-windows-project');
      assert.strictEqual(result.source, 'directory');
    });

    it('should skip hidden directories like .sqlew', () => {
      const pathWithHidden = '/home/kitayama/.sqlew';
      const result = detectProjectNameSync(pathWithHidden);
      assert.strictEqual(result.name, 'kitayama');
      assert.strictEqual(result.source, 'directory');
    });

    it('should skip multiple hidden directories', () => {
      const pathWithMultipleHidden = '/home/kitayama/.config/.sqlew';
      const result = detectProjectNameSync(pathWithMultipleHidden);
      assert.strictEqual(result.name, 'kitayama');
      assert.strictEqual(result.source, 'directory');
    });

    it('should return default when all segments are hidden', () => {
      const onlyHidden = '/.hidden/.another';
      const result = detectProjectNameSync(onlyHidden);
      assert.strictEqual(result.name, 'default');
      assert.strictEqual(result.source, 'directory');
    });

    it('should handle empty path', () => {
      const result = detectProjectNameSync('');
      assert.ok(result.name.length > 0);
      assert.ok(['config', 'directory', 'env'].includes(result.source));
    });

    it('should ignore empty config.toml project name', () => {
      const testDir = makeTempDir('empty-config-name');
      mkdirSync(join(testDir, '.sqlew'), { recursive: true });
      writeFileSync(join(testDir, '.sqlew', 'config.toml'), '[project]\nname = ""\n');

      const result = detectProjectNameSync(testDir);

      assert.strictEqual(result.name, testDir.split(/[/\\]/).pop());
      assert.strictEqual(result.source, 'directory');
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should handle malformed config.toml', () => {
      const testDir = makeTempDir('malformed-config');
      mkdirSync(join(testDir, '.sqlew'), { recursive: true });
      writeFileSync(
        join(testDir, '.sqlew', 'config.toml'),
        '[project\nname = invalid toml syntax\n'
      );

      const result = detectProjectNameSync(testDir);

      assert.strictEqual(result.name, testDir.split(/[/\\]/).pop());
      assert.strictEqual(result.source, 'directory');
      rmSync(testDir, { recursive: true, force: true });
    });
  });

  describe('detectProjectName (async)', () => {
    it('should prefer SQLEW_PROJECT_NAME over git and config', async () => {
      const testDir = makeTempDir('async-env-wins');
      writeConfig(testDir, 'from-config');
      initGitWithRemote(testDir, 'git@github.com:acme/from-git.git');
      process.env[SQLEW_ENV_VARS.PROJECT_NAME] = 'from-env';

      const result = await detectProjectName(testDir);

      assert.strictEqual(result.name, 'from-env');
      assert.strictEqual(result.source, 'env');
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should prefer git remote basename over config.toml', async () => {
      const testDir = makeTempDir('async-git-over-config');
      writeConfig(testDir, 'from-config');
      initGitWithRemote(testDir, 'https://github.com/sqlew-io/sqlew.git');

      const result = await detectProjectName(testDir);

      assert.strictEqual(result.name, 'sqlew');
      assert.strictEqual(result.source, 'git');
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should detect from config.toml when no env and no git', async () => {
      const testDir = makeTempDir('async-config-detect');
      writeConfig(testDir, 'async-test-project');

      const result = await detectProjectName(testDir);

      assert.strictEqual(result.name, 'async-test-project');
      assert.strictEqual(result.source, 'config');
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should fallback to directory name when no env/git/config', async () => {
      const testDir = makeTempDir('async-no-vcs');

      const result = await detectProjectName(testDir);

      assert.strictEqual(result.name, testDir.split(/[/\\]/).pop());
      assert.strictEqual(result.source, 'directory');
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should extract HTTPS remote basename without .git suffix', async () => {
      const testDir = makeTempDir('async-https-remote');
      initGitWithRemote(testDir, 'https://github.com/acme/my-app');

      const result = await detectProjectName(testDir);

      assert.strictEqual(result.name, 'my-app');
      assert.strictEqual(result.source, 'git');
      rmSync(testDir, { recursive: true, force: true });
    });
  });

  describe('resolveConfiguredProjectName', () => {
    it('returns undefined when only directory would apply', async () => {
      const testDir = makeTempDir('resolve-no-sources');
      const result = await resolveConfiguredProjectName(testDir);
      assert.strictEqual(result, undefined);
      rmSync(testDir, { recursive: true, force: true });
    });

    it('returns git without falling back to directory', async () => {
      const testDir = makeTempDir('resolve-git-only');
      initGitWithRemote(testDir, 'git@github.com:org/cloud-repo.git');

      const result = await resolveConfiguredProjectName(testDir);

      assert.ok(result);
      assert.strictEqual(result.name, 'cloud-repo');
      assert.strictEqual(result.source, 'git');
      rmSync(testDir, { recursive: true, force: true });
    });
  });

  describe('Real project detection', () => {
    it('should detect a project name from the current checkout', () => {
      const projectRoot = process.cwd();
      const result = detectProjectNameSync(projectRoot);

      assert.ok(typeof result.name === 'string' && result.name.length > 0);
      assert.ok(['config', 'directory', 'env'].includes(result.source));
    });
  });
});
