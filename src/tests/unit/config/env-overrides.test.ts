import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  applyEnvConfigOverrides,
  hasEnvProjectNameOverride,
  readEnvDatabaseType,
  readEnvDatabaseUrl,
  readEnvProjectName,
  SQLEW_ENV_VARS,
} from '../../../config/env-overrides.js';
import { DEFAULT_CONFIG } from '../../../config/types.js';

describe('env-overrides', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env[SQLEW_ENV_VARS.PROJECT_NAME];
    delete process.env[SQLEW_ENV_VARS.DATABASE_TYPE];
    delete process.env[SQLEW_ENV_VARS.DATABASE_URL];
    delete process.env[SQLEW_ENV_VARS.DATABASE_URL_ALIAS];
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

  describe('readEnvDatabaseUrl', () => {
    it('prefers SQLEW_DATABASE_URL over DATABASE_URL', () => {
      process.env[SQLEW_ENV_VARS.DATABASE_URL] = 'postgres://a:b@h/db1';
      process.env[SQLEW_ENV_VARS.DATABASE_URL_ALIAS] = 'postgres://a:b@h/db2';
      assert.strictEqual(readEnvDatabaseUrl(), 'postgres://a:b@h/db1');
    });

    it('falls back to DATABASE_URL', () => {
      process.env[SQLEW_ENV_VARS.DATABASE_URL_ALIAS] =
        'mysql://root:secret@127.0.0.1:3306/sqlew';
      assert.strictEqual(
        readEnvDatabaseUrl(),
        'mysql://root:secret@127.0.0.1:3306/sqlew'
      );
    });

    it('treats empty primary as unset and uses alias', () => {
      process.env[SQLEW_ENV_VARS.DATABASE_URL] = '  ';
      process.env[SQLEW_ENV_VARS.DATABASE_URL_ALIAS] = 'postgres://u:p@h/db';
      assert.strictEqual(readEnvDatabaseUrl(), 'postgres://u:p@h/db');
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

    it('type=postgres alone preserves file connection/auth (does not wipe)', () => {
      process.env[SQLEW_ENV_VARS.DATABASE_TYPE] = 'postgres';

      const fileConfig = {
        ...DEFAULT_CONFIG,
        database: {
          type: 'mysql' as const,
          connection: { host: 'db.local', port: 3306, database: 'sqlew' },
          auth: { type: 'direct' as const, user: 'u', password: 'p' },
        },
      };

      const merged = applyEnvConfigOverrides(fileConfig);
      assert.strictEqual(merged.database?.type, 'postgres');
      assert.deepStrictEqual(merged.database?.connection, {
        host: 'db.local',
        port: 3306,
        database: 'sqlew',
      });
      assert.strictEqual(merged.database?.auth?.user, 'u');
      assert.strictEqual(merged.database?.auth?.password, 'p');
    });

    it('SQLEW_DATABASE_URL wins over local sqlite config.toml-like settings', () => {
      process.env[SQLEW_ENV_VARS.DATABASE_URL] =
        'postgresql://neondb_owner:secret@ep-x.us-east-2.aws.neon.tech/neondb?sslmode=require';
      process.env[SQLEW_ENV_VARS.PROJECT_NAME] = 'neon-cloud-agent';

      const localLike = {
        ...DEFAULT_CONFIG,
        project: { name: 'workspace' },
        database: { path: '.sqlew/sqlew.db' },
      };

      const merged = applyEnvConfigOverrides(localLike);
      assert.strictEqual(merged.database?.type, 'postgres');
      assert.strictEqual(merged.database?.path, undefined);
      assert.strictEqual(
        merged.database?.connection?.host,
        'ep-x.us-east-2.aws.neon.tech'
      );
      assert.strictEqual(merged.database?.connection?.database, 'neondb');
      assert.strictEqual(merged.database?.auth?.user, 'neondb_owner');
      assert.deepStrictEqual(merged.database?.auth?.ssl, {
        rejectUnauthorized: false,
      });
      assert.strictEqual(merged.project?.name, 'neon-cloud-agent');
    });

    it('mysql DATABASE_URL alias overrides file sqlite', () => {
      process.env[SQLEW_ENV_VARS.DATABASE_URL_ALIAS] =
        'mysql://app:pass@mysql.example.com:3306/sqlew_prod';

      const merged = applyEnvConfigOverrides({
        ...DEFAULT_CONFIG,
        database: { path: '.sqlew/sqlew.db' },
      });

      assert.strictEqual(merged.database?.type, 'mysql');
      assert.deepStrictEqual(merged.database?.connection, {
        host: 'mysql.example.com',
        port: 3306,
        database: 'sqlew_prod',
      });
      assert.strictEqual(merged.database?.auth?.password, 'pass');
    });

    it('URL wins when both URL and DATABASE_TYPE=cloud are set', () => {
      process.env[SQLEW_ENV_VARS.DATABASE_TYPE] = 'cloud';
      process.env[SQLEW_ENV_VARS.DATABASE_URL] = 'postgres://u:p@h/db';

      const merged = applyEnvConfigOverrides({
        ...DEFAULT_CONFIG,
        database: { path: '.sqlew/sqlew.db' },
      });

      assert.strictEqual(merged.database?.type, 'postgres');
      assert.strictEqual(merged.database?.connection?.host, 'h');
    });

    it('ignores invalid URL and leaves file database intact', () => {
      process.env[SQLEW_ENV_VARS.DATABASE_URL] = 'not-a-url';

      const base = {
        ...DEFAULT_CONFIG,
        database: { path: '.sqlew/sqlew.db' },
      };
      const merged = applyEnvConfigOverrides(base);
      assert.deepStrictEqual(merged.database, { path: '.sqlew/sqlew.db' });
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
