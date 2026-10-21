import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  applyEnvConfigOverrides,
  hasEnvProjectNameOverride,
  readEnvDatabaseType,
  readEnvProjectName,
  SQLEW_ENV_VARS,
} from '../../../config/env-overrides.js';
import { DEFAULT_CONFIG } from '../../../config/types.js';

describe('env-overrides', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env[SQLEW_ENV_VARS.PROJECT_NAME];
    delete process.env[SQLEW_ENV_VARS.DATABASE_TYPE];
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  describe('readEnvProjectName', () => {
    it('returns undefined when unset', () => {
      assert.strictEqual(readEnvProjectName(), undefined);
    });

    it('returns trimmed name when set', () => {
      process.env[SQLEW_ENV_VARS.PROJECT_NAME] = '  my-app  ';
      assert.strictEqual(readEnvProjectName(), 'my-app');
    });

    it('treats whitespace-only as unset', () => {
      process.env[SQLEW_ENV_VARS.PROJECT_NAME] = '   ';
      assert.strictEqual(readEnvProjectName(), undefined);
    });
  });

  describe('readEnvDatabaseType', () => {
    it('accepts cloud case-insensitively', () => {
      process.env[SQLEW_ENV_VARS.DATABASE_TYPE] = 'Cloud';
      assert.strictEqual(readEnvDatabaseType(), 'cloud');
    });

    it('returns undefined for invalid type', () => {
      process.env[SQLEW_ENV_VARS.DATABASE_TYPE] = 'mongodb';
      assert.strictEqual(readEnvDatabaseType(), undefined);
    });
  });

  describe('applyEnvConfigOverrides', () => {
    it('overrides local sqlite config with cloud + project name from env', () => {
      process.env[SQLEW_ENV_VARS.DATABASE_TYPE] = 'cloud';
      process.env[SQLEW_ENV_VARS.PROJECT_NAME] = 'cursor-agent-project';

      const localLike: typeof DEFAULT_CONFIG = {
        ...DEFAULT_CONFIG,
        project: { name: 'workspace' },
        database: { path: '.sqlew/sqlew.db' },
      };

      const merged = applyEnvConfigOverrides(localLike);

      assert.strictEqual(merged.database?.type, 'cloud');
      assert.strictEqual(merged.database?.path, undefined);
      assert.strictEqual(merged.project?.name, 'cursor-agent-project');
    });

    it('leaves config unchanged when env is unset', () => {
      const base = {
        ...DEFAULT_CONFIG,
        project: { name: 'from-file' },
      };
      const merged = applyEnvConfigOverrides(base);
      assert.strictEqual(merged.project?.name, 'from-file');
      assert.deepStrictEqual(merged.database, DEFAULT_CONFIG.database);
    });
  });

  describe('hasEnvProjectNameOverride', () => {
    it('reflects SQLEW_PROJECT_NAME presence', () => {
      assert.strictEqual(hasEnvProjectNameOverride(), false);
      process.env[SQLEW_ENV_VARS.PROJECT_NAME] = 'x';
      assert.strictEqual(hasEnvProjectNameOverride(), true);
    });
  });

  describe('loadProjectName integration (cloud-config-loader)', () => {
    it('prefers env over config.toml on disk', async () => {
      const { loadProjectName } = await import('../../../config/cloud-config-loader.js');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlew-env-'));
      const sqlewDir = path.join(tmpDir, '.sqlew');
      fs.mkdirSync(sqlewDir, { recursive: true });
      fs.writeFileSync(
        path.join(sqlewDir, 'config.toml'),
        '[project]\nname = "from-toml"\n',
        'utf-8'
      );

      process.env[SQLEW_ENV_VARS.PROJECT_NAME] = 'from-env';
      assert.strictEqual(loadProjectName(tmpDir), 'from-env');

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});
