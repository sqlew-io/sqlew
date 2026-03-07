/**
 * Backend Factory Tests
 *
 * Tests for backend creation and configuration.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  createBackend,
  resetBackend,
  initializeBackend,
  getBackend,
  isBackendInitialized,
  getBackendType,
  isCloudMode,
  loadCloudConfig,
  validateCloudConfig,
} from '../../backend/index.js';
import { hasGlobalEnvFile } from '../../config/cloud-config-loader.js';
import type { SqlewConfig } from '../../config/types.js';

describe('Backend Factory', () => {
  beforeEach(async () => {
    await resetBackend();
    // Clear environment variables
    delete process.env.SQLEW_API_KEY;
  });

  afterEach(async () => {
    await resetBackend();
  });

  describe('createBackend', () => {
    it('should create LocalBackend for sqlite config', async () => {
      const config: SqlewConfig = {
        database: { type: 'sqlite' },
      };

      const backend = await createBackend(config);
      assert.strictEqual(backend.backendType, 'local');
    });

    it('should create LocalBackend for postgres config', async () => {
      const config: SqlewConfig = {
        database: { type: 'postgres' },
      };

      const backend = await createBackend(config);
      assert.strictEqual(backend.backendType, 'local');
    });

    it('should create LocalBackend for mysql config', async () => {
      const config: SqlewConfig = {
        database: { type: 'mysql' },
      };

      const backend = await createBackend(config);
      assert.strictEqual(backend.backendType, 'local');
    });

    it('should create LocalBackend when no config specified', async () => {
      const config: SqlewConfig = {};

      const backend = await createBackend(config);
      assert.strictEqual(backend.backendType, 'local');
    });

    it('should throw error for cloud config without API key', async () => {
      // Skip if ~/.config/sqlew/.sqlew.env exists (it will provide API key)
      if (hasGlobalEnvFile()) {
        return;
      }

      const config: SqlewConfig = {
        database: { type: 'cloud' },
      };

      await assert.rejects(
        async () => await createBackend(config),
        /SQLEW_API_KEY is required for cloud mode/
      );
    });

    it('should create SaaS backend when API key is set', async () => {
      const config: SqlewConfig = {
        database: { type: 'cloud' },
      };

      // Set API key - SaaS backend should be created via submodule
      process.env.SQLEW_API_KEY = 'test-key';

      const backend = await createBackend(config);
      assert.strictEqual(backend.backendType, 'saas');
    });
  });

  describe('initializeBackend', () => {
    it('should initialize LocalBackend for local config', async () => {
      const config: SqlewConfig = {
        database: { type: 'sqlite' },
      };

      const backend = await initializeBackend(config);

      assert.strictEqual(backend.backendType, 'local');
      assert.strictEqual(isBackendInitialized(), true);
      assert.strictEqual(getBackendType(), 'local');
    });

    it('should return same instance on getBackend', async () => {
      const config: SqlewConfig = {
        database: { type: 'sqlite' },
      };

      const backend1 = await initializeBackend(config);
      const backend2 = getBackend();

      assert.strictEqual(backend1, backend2);
    });
  });

  describe('getBackend', () => {
    it('should return LocalBackend as default when not initialized', () => {
      const backend = getBackend();

      assert.strictEqual(backend.backendType, 'local');
    });
  });

  describe('resetBackend', () => {
    it('should reset backend state', async () => {
      const config: SqlewConfig = {
        database: { type: 'sqlite' },
      };

      await initializeBackend(config);
      assert.strictEqual(isBackendInitialized(), true);

      await resetBackend();
      assert.strictEqual(isBackendInitialized(), false);
      assert.strictEqual(getBackendType(), null);
    });
  });

  describe('isCloudMode', () => {
    it('should return true for cloud type', () => {
      const config: SqlewConfig = {
        database: { type: 'cloud' },
      };

      assert.strictEqual(isCloudMode(config), true);
    });

    it('should return false for sqlite type', () => {
      const config: SqlewConfig = {
        database: { type: 'sqlite' },
      };

      assert.strictEqual(isCloudMode(config), false);
    });

    it('should return false for no database config', () => {
      const config: SqlewConfig = {};

      assert.strictEqual(isCloudMode(config), false);
    });
  });

  describe('loadCloudConfig', () => {
    it('should return null when no API key set', async () => {
      // Skip if ~/.config/sqlew/.sqlew.env exists (it will provide API key)
      if (hasGlobalEnvFile()) {
        return;
      }

      const config = await loadCloudConfig();

      assert.strictEqual(config, null);
    });

    it('should return config when API key is set', async () => {
      process.env.SQLEW_API_KEY = 'test-api-key';

      const config = await loadCloudConfig();

      assert.strictEqual(config?.apiKey, 'test-api-key');
    });

    it('should include projectName from config.toml if exists', async () => {
      process.env.SQLEW_API_KEY = 'test-api-key';

      const config = await loadCloudConfig(process.cwd());

      // projectName comes from .sqlew/config.toml, may be undefined
      assert.ok(config?.projectName === undefined || typeof config.projectName === 'string');
    });
  });

  describe('validateCloudConfig', () => {
    it('should return valid false for null config', () => {
      const result = validateCloudConfig(null);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.length > 0);
    });

    it('should return valid true for config with API key', () => {
      const result = validateCloudConfig({
        apiKey: 'test-key',
      });

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });
  });
});
