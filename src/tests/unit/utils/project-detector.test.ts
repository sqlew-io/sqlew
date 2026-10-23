/**
 * Tests for project-detector.ts
 *
 * Verifies project name detection from:
 * - config.toml
 * - VCS (Git)
 * - Directory name
 */

import { describe, it, mock } from 'node:test';
import * as assert from 'node:assert';
import { detectProjectNameSync, detectProjectName } from '../../../utils/project-detector.js';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

describe('Project Detector', () => {
  describe('detectProjectNameSync', () => {
    it('should detect from config.toml when present', () => {
      const testDir = join(process.cwd(), '.tmp-test', 'project-detector-config');

      // Setup: Create test directory with config.toml
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
      mkdirSync(join(testDir, '.sqlew'), { recursive: true });

      const configContent = `
[project]
name = "my-test-project"
`;
      writeFileSync(join(testDir, '.sqlew', 'config.toml'), configContent);

      // Test
      const result = detectProjectNameSync(testDir);

      // Verify
      assert.strictEqual(result.name, 'my-test-project');
      assert.strictEqual(result.source, 'config');

      // Cleanup
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should fallback to directory name when config.toml missing', () => {
      const testDir = join(process.cwd(), '.tmp-test', 'fallback-dir-name');

      // Setup: Create test directory WITHOUT config.toml
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
      mkdirSync(testDir, { recursive: true });

      // Test
      const result = detectProjectNameSync(testDir);

      // Verify
      assert.strictEqual(result.name, 'fallback-dir-name');
      assert.strictEqual(result.source, 'directory');

      // Cleanup
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should handle Windows path separators', () => {
      // Windows path with backslashes
      const windowsPath = 'C:\\Users\\test\\my-windows-project';

      const result = detectProjectNameSync(windowsPath);

      // Should extract last directory name regardless of separator
      assert.strictEqual(result.name, 'my-windows-project');
      assert.strictEqual(result.source, 'directory');
    });

    it('should skip hidden directories like .sqlew', () => {
      // Path ending with hidden directory (common when using --db-path)
      const pathWithHidden = '/home/kitayama/.sqlew';

      const result = detectProjectNameSync(pathWithHidden);

      // Should skip .sqlew and use parent directory 'kitayama'
      assert.strictEqual(result.name, 'kitayama');
      assert.strictEqual(result.source, 'directory');
    });

    it('should skip multiple hidden directories', () => {
      // Multiple hidden directories at the end
      const pathWithMultipleHidden = '/home/kitayama/.config/.sqlew';

      const result = detectProjectNameSync(pathWithMultipleHidden);

      // Should skip .sqlew and .config, use 'kitayama'
      assert.strictEqual(result.name, 'kitayama');
      assert.strictEqual(result.source, 'directory');
    });

    it('should return default when all segments are hidden', () => {
      // Only hidden directories
      const onlyHidden = '/.hidden/.another';

      const result = detectProjectNameSync(onlyHidden);

      // Should fallback to 'default'
      assert.strictEqual(result.name, 'default');
      assert.strictEqual(result.source, 'directory');
    });

    it('should handle empty path', () => {
      const result = detectProjectNameSync('');

      // Empty path resolves to current directory, which has config.toml or is a git repo
      // Just verify it returns something non-empty with valid source
      assert.ok(result.name.length > 0);
      assert.ok(['config', 'directory', 'git'].includes(result.source));
    });

    it('should ignore empty config.toml project name', () => {
      const testDir = join(process.cwd(), '.tmp-test', 'empty-config-name');

      // Setup: Create config with empty project name
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
      mkdirSync(join(testDir, '.sqlew'), { recursive: true });

      const configContent = `
[project]
name = ""
`;
      writeFileSync(join(testDir, '.sqlew', 'config.toml'), configContent);

      // Test
      const result = detectProjectNameSync(testDir);

      // Verify: Should fallback to directory name
      assert.strictEqual(result.name, 'empty-config-name');
      assert.strictEqual(result.source, 'directory');

      // Cleanup
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should handle malformed config.toml', () => {
      const testDir = join(process.cwd(), '.tmp-test', 'malformed-config');

      // Setup: Create invalid TOML
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
      mkdirSync(join(testDir, '.sqlew'), { recursive: true });

      const configContent = `
[project
name = invalid toml syntax
`;
      writeFileSync(join(testDir, '.sqlew', 'config.toml'), configContent);

      // Test
      const result = detectProjectNameSync(testDir);

      // Verify: Should fallback to directory name
      assert.strictEqual(result.name, 'malformed-config');
      assert.strictEqual(result.source, 'directory');

      // Cleanup
      rmSync(testDir, { recursive: true, force: true });
    });
  });

  describe('detectProjectName (async)', () => {
    it('should detect from config.toml when present', async () => {
      const testDir = join(process.cwd(), '.tmp-test', 'async-config-detect');

      // Setup
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
      mkdirSync(join(testDir, '.sqlew'), { recursive: true });

      const configContent = `
[project]
name = "async-test-project"
`;
      writeFileSync(join(testDir, '.sqlew', 'config.toml'), configContent);

      // Test
      const result = await detectProjectName(testDir);

      // Verify
      assert.strictEqual(result.name, 'async-test-project');
      assert.strictEqual(result.source, 'config');

      // Cleanup
      rmSync(testDir, { recursive: true, force: true });
    });

    it('should fallback to directory name when no VCS', async () => {
      const testDir = join(process.cwd(), '.tmp-test', 'async-no-vcs');

      // Setup: Directory without config or .git
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
      mkdirSync(testDir, { recursive: true });

      // Test
      const result = await detectProjectName(testDir);

      // Verify: May detect parent VCS, so just check source is valid
      // In a real isolated directory, it would be 'directory', but in a git repo subdirectory, it might be 'git'
      assert.ok(result.name.length > 0);
      assert.ok(['directory', 'git'].includes(result.source));

      // Cleanup
      rmSync(testDir, { recursive: true, force: true });
    });
  });

  describe('Real project detection', () => {
    it('should detect a project name from the current checkout', () => {
      const projectRoot = process.cwd();

      // Runs in the actual checkout (CI: often "sqlew"; Cloud Agent: often "workspace")
      const result = detectProjectNameSync(projectRoot);

      assert.ok(typeof result.name === 'string' && result.name.length > 0);
      assert.ok(['config', 'directory', 'git'].includes(result.source));
    });
  });
});
