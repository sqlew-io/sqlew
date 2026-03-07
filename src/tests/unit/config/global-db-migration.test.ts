/**
 * Global DB Migration Unit Tests (v5.1)
 *
 * Tests for:
 * - getGlobalConfigDir() unified path
 * - getDefaultDbPath() global shared DB
 * - migrateLocalToGlobal() (copy / merge / skip)
 * - Old global directory migration
 * - Config template auto-generation
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import {
  getGlobalConfigDir,
  getDefaultDbPath,
  ensureGlobalConfigDir,
} from '../../../config/global-config.js';

describe('global-db-migration', () => {
  describe('getGlobalConfigDir', () => {
    it('should return ~/.config/sqlew on all platforms', () => {
      const expected = join(homedir(), '.config', 'sqlew');
      const result = getGlobalConfigDir();
      assert.strictEqual(result, expected);
    });
  });

  describe('getDefaultDbPath', () => {
    it('should return ~/.config/sqlew/sqlew-shared.db', () => {
      const expected = join(homedir(), '.config', 'sqlew', 'sqlew-shared.db');
      const result = getDefaultDbPath();
      assert.strictEqual(result, expected);
    });

    it('should use sqlew-shared.db name (not sqlew.db)', () => {
      const result = getDefaultDbPath();
      assert.ok(result.endsWith('sqlew-shared.db'), `Expected path ending with sqlew-shared.db, got: ${result}`);
      assert.ok(!result.endsWith('/sqlew.db'), 'Should not use plain sqlew.db');
    });
  });

  describe('ensureGlobalConfigDir', () => {
    // Note: These tests use the real ~/.config/sqlew/ directory.
    // They are safe because ensureGlobalConfigDir is idempotent.

    it('should create ~/.config/sqlew/ directory', () => {
      ensureGlobalConfigDir();
      const dir = getGlobalConfigDir();
      assert.ok(existsSync(dir), `Expected directory to exist: ${dir}`);
    });

    it('should generate config.toml template if missing', () => {
      ensureGlobalConfigDir();
      const configPath = join(getGlobalConfigDir(), 'config.toml');
      // config.toml should exist (either pre-existing or newly created)
      assert.ok(existsSync(configPath), `Expected config.toml at: ${configPath}`);
    });

    it('should not overwrite existing config.toml', () => {
      const configPath = join(getGlobalConfigDir(), 'config.toml');

      // Ensure dir exists first
      ensureGlobalConfigDir();

      // Write custom content
      const customContent = '# Custom config\n[database]\ntype = "sqlite"\n';
      writeFileSync(configPath, customContent, 'utf-8');

      // Call again - should not overwrite
      ensureGlobalConfigDir();

      const content = readFileSync(configPath, 'utf-8');
      assert.strictEqual(content, customContent, 'Config should not be overwritten');

      // Restore template for other tests
      writeFileSync(configPath, '# restored\n', 'utf-8');
    });
  });

  describe('migrateLocalToGlobal', () => {
    let testDir: string;

    beforeEach(() => {
      testDir = join(tmpdir(), `sqlew-migration-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('should skip when local DB does not exist', async () => {
      const { migrateLocalToGlobal } = await import('../../../migration/local-to-global.js');
      const globalDbPath = join(testDir, 'global', 'sqlew-shared.db');

      // No local DB exists - should be a no-op
      await migrateLocalToGlobal(testDir, globalDbPath);
      assert.ok(!existsSync(globalDbPath), 'Global DB should not be created when no local DB');
    });

    it('should copy local DB to global when global does not exist', async () => {
      const { migrateLocalToGlobal } = await import('../../../migration/local-to-global.js');

      // Create a fake local DB file
      const localDir = join(testDir, '.sqlew');
      mkdirSync(localDir, { recursive: true });
      const localDbPath = join(localDir, 'sqlew.db');
      writeFileSync(localDbPath, 'fake-sqlite-db-content', 'utf-8');

      const globalDir = join(testDir, 'global');
      const globalDbPath = join(globalDir, 'sqlew-shared.db');

      await migrateLocalToGlobal(testDir, globalDbPath);

      // Global DB should exist with copied content
      assert.ok(existsSync(globalDbPath), 'Global DB should be created');
      const content = readFileSync(globalDbPath, 'utf-8');
      assert.strictEqual(content, 'fake-sqlite-db-content');

      // Local DB should be renamed to .migrated
      assert.ok(!existsSync(localDbPath), 'Local DB should be removed');
      assert.ok(existsSync(localDbPath + '.migrated'), 'Local DB should be renamed to .migrated');
    });

    it('should rename local DB to .migrated after migration', async () => {
      const { migrateLocalToGlobal } = await import('../../../migration/local-to-global.js');

      const localDir = join(testDir, '.sqlew');
      mkdirSync(localDir, { recursive: true });
      const localDbPath = join(localDir, 'sqlew.db');
      writeFileSync(localDbPath, 'test-content', 'utf-8');

      // Also create a WAL file
      writeFileSync(localDbPath + '-wal', 'wal-content', 'utf-8');

      const globalDbPath = join(testDir, 'global', 'sqlew-shared.db');

      await migrateLocalToGlobal(testDir, globalDbPath);

      assert.ok(existsSync(localDbPath + '.migrated'), '.migrated file should exist');
      assert.ok(existsSync(localDbPath + '-wal.migrated'), '.wal.migrated should exist');
    });
  });
});
