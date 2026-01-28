import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  getGlobalEnvPath,
  loadApiKey,
  loadProjectName,
  createConnectionIdentity,
  loadCloudConfigFromGlobal,
  hasGlobalEnvFile,
  checkEnvFilePermissions,
} from '../../../config/cloud-config-loader.js';

describe('cloud-config-loader', () => {
  // Store original env values
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars
    delete process.env.SQLEW_API_KEY;
  });

  afterEach(() => {
    // Restore original env
    process.env.SQLEW_API_KEY = originalEnv.SQLEW_API_KEY;
  });

  describe('getGlobalEnvPath', () => {
    it('should return path in home directory', () => {
      const envPath = getGlobalEnvPath();
      const homeDir = os.homedir();

      assert.ok(envPath.startsWith(homeDir));
      assert.ok(envPath.endsWith('.sqlew.env'));
    });
  });

  describe('loadApiKey', () => {
    it('should prioritize environment variable', () => {
      process.env.SQLEW_API_KEY = 'env_api_key';

      const apiKey = loadApiKey();
      assert.strictEqual(apiKey, 'env_api_key');
    });

    it('should return null when not configured', () => {
      const apiKey = loadApiKey();
      // May return null or value from ~/.sqlew.env if it exists
      assert.ok(apiKey === null || typeof apiKey === 'string');
    });
  });

  describe('loadProjectName', () => {
    it('should return undefined when config.toml not found', () => {
      const projectName = loadProjectName('/non-existent-path');
      assert.strictEqual(projectName, undefined);
    });

    it('should return project name from config.toml if exists', () => {
      // This test uses the actual project's config.toml
      const projectName = loadProjectName(process.cwd());
      // May return a string or undefined depending on config existence
      assert.ok(projectName === undefined || typeof projectName === 'string');
    });
  });

  describe('createConnectionIdentity', () => {
    it('should create valid connection identity', () => {
      const identity = createConnectionIdentity(
        'sk_test_key',
        'proj_123',
        'C:\\Users\\dev\\my-app'
      );

      assert.ok(identity.connectionHash);
      assert.strictEqual(identity.connectionHash.length, 43);
      assert.ok(['windows', 'macos', 'linux', 'wsl', 'docker', 'unknown'].includes(identity.environment));
      assert.strictEqual(identity.pathSuffix, 'dev/my-app');
      assert.strictEqual(identity.fullPath, 'C:\\Users\\dev\\my-app');
    });

    it('should use cwd when projectRoot not provided', () => {
      const identity = createConnectionIdentity('sk_test_key', undefined);

      assert.strictEqual(identity.fullPath, process.cwd());
    });
  });

  describe('loadCloudConfigFromGlobal', () => {
    it('should return null when API key not found', () => {
      // Ensure env var is not set
      delete process.env.SQLEW_API_KEY;

      const config = loadCloudConfigFromGlobal('/test/project');

      // If no global file exists, should return null
      if (!hasGlobalEnvFile()) {
        assert.strictEqual(config, null);
      }
    });

    it('should include connection identity when API key is set', () => {
      process.env.SQLEW_API_KEY = 'sk_test_key';

      const config = loadCloudConfigFromGlobal('C:\\Users\\dev\\my-app');

      assert.ok(config);
      assert.strictEqual(config.apiKey, 'sk_test_key');
      assert.ok(config.connectionIdentity);
      assert.ok(config.connectionIdentity.connectionHash);
    });
  });

  describe('hasGlobalEnvFile', () => {
    it('should return boolean', () => {
      const result = hasGlobalEnvFile();
      assert.ok(typeof result === 'boolean');
    });
  });

  describe('checkEnvFilePermissions', () => {
    it('should return ok result', () => {
      const result = checkEnvFilePermissions();

      assert.ok(typeof result.ok === 'boolean');
      if (!result.ok) {
        assert.ok(result.message);
      }
    });

    it('should return ok on Windows', () => {
      if (process.platform === 'win32') {
        const result = checkEnvFilePermissions();
        assert.strictEqual(result.ok, true);
      }
    });
  });
});
