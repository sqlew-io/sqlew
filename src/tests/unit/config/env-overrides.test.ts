import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  applyEnvConfigOverrides,
  buildDatabaseConfigFromDiscreteEnv,
  hasEnvDiscreteDatabaseConnection,
  hasEnvProjectNameOverride,
  readEnvDatabaseType,
  readEnvDatabaseUrl,
  readEnvProjectName,
  sslConfigFromDiscreteEnv,
  SQLEW_ENV_VARS,
} from '../../../config/env-overrides.js';
import { DEFAULT_CONFIG } from '../../../config/types.js';

const DISCRETE_ENV_KEYS = [
  SQLEW_ENV_VARS.DATABASE_HOST,
  SQLEW_ENV_VARS.DATABASE_PORT,
  SQLEW_ENV_VARS.DATABASE_NAME,
  SQLEW_ENV_VARS.DATABASE_USER,
  SQLEW_ENV_VARS.DATABASE_PASSWORD,
  SQLEW_ENV_VARS.DATABASE_SSL,
  SQLEW_ENV_VARS.DATABASE_SSL_REJECT_UNAUTHORIZED,
] as const;

describe('env-overrides', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env[SQLEW_ENV_VARS.PROJECT_NAME];
    delete process.env[SQLEW_ENV_VARS.DATABASE_TYPE];
    delete process.env[SQLEW_ENV_VARS.DATABASE_URL];
    delete process.env[SQLEW_ENV_VARS.DATABASE_URL_ALIAS];
    for (const key of DISCRETE_ENV_KEYS) {
      delete process.env[key];
    }
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

    it('builds Neon-like connection from discrete Secrets vars only', () => {
      process.env[SQLEW_ENV_VARS.PROJECT_NAME] = 'neon-discrete';
      process.env[SQLEW_ENV_VARS.DATABASE_TYPE] = 'postgres';
      process.env[SQLEW_ENV_VARS.DATABASE_HOST] = 'ep-x.us-east-2.aws.neon.tech';
      process.env[SQLEW_ENV_VARS.DATABASE_PORT] = '5432';
      process.env[SQLEW_ENV_VARS.DATABASE_NAME] = 'neondb';
      process.env[SQLEW_ENV_VARS.DATABASE_USER] = 'neondb_owner';
      process.env[SQLEW_ENV_VARS.DATABASE_PASSWORD] = 's3cret';
      process.env[SQLEW_ENV_VARS.DATABASE_SSL] = 'true';

      const merged = applyEnvConfigOverrides({
        ...DEFAULT_CONFIG,
        project: { name: 'workspace' },
        database: { path: '.sqlew/sqlew.db' },
      });

      assert.strictEqual(merged.project?.name, 'neon-discrete');
      assert.strictEqual(merged.database?.type, 'postgres');
      assert.strictEqual(merged.database?.path, undefined);
      assert.deepStrictEqual(merged.database?.connection, {
        host: 'ep-x.us-east-2.aws.neon.tech',
        port: 5432,
        database: 'neondb',
      });
      assert.strictEqual(merged.database?.auth?.user, 'neondb_owner');
      assert.strictEqual(merged.database?.auth?.password, 's3cret');
      assert.deepStrictEqual(merged.database?.auth?.ssl, {
        rejectUnauthorized: false,
      });
    });

    it('uses default postgres port when PORT unset', () => {
      process.env[SQLEW_ENV_VARS.DATABASE_TYPE] = 'postgres';
      process.env[SQLEW_ENV_VARS.DATABASE_HOST] = '127.0.0.1';
      process.env[SQLEW_ENV_VARS.DATABASE_NAME] = 'sqlew';
      process.env[SQLEW_ENV_VARS.DATABASE_USER] = 'postgres';
      process.env[SQLEW_ENV_VARS.DATABASE_PASSWORD] = 'x';

      const merged = applyEnvConfigOverrides({
        ...DEFAULT_CONFIG,
        database: { path: '.sqlew/sqlew.db' },
      });
      assert.strictEqual(merged.database?.connection?.port, 5432);
    });

    it('builds mysql discrete connection with default port 3306', () => {
      process.env[SQLEW_ENV_VARS.DATABASE_TYPE] = 'mysql';
      process.env[SQLEW_ENV_VARS.DATABASE_HOST] = '10.0.0.5';
      process.env[SQLEW_ENV_VARS.DATABASE_NAME] = 'sqlew';
      process.env[SQLEW_ENV_VARS.DATABASE_USER] = 'app';
      process.env[SQLEW_ENV_VARS.DATABASE_PASSWORD] = 'pw';

      const merged = applyEnvConfigOverrides({
        ...DEFAULT_CONFIG,
        database: { path: '.sqlew/sqlew.db' },
      });
      assert.strictEqual(merged.database?.type, 'mysql');
      assert.deepStrictEqual(merged.database?.connection, {
        host: '10.0.0.5',
        port: 3306,
        database: 'sqlew',
      });
    });

    it('URL wins over discrete HOST when both are set', () => {
      process.env[SQLEW_ENV_VARS.DATABASE_URL] = 'postgres://u:p@from-url/db';
      process.env[SQLEW_ENV_VARS.DATABASE_TYPE] = 'postgres';
      process.env[SQLEW_ENV_VARS.DATABASE_HOST] = 'from-host';
      process.env[SQLEW_ENV_VARS.DATABASE_NAME] = 'ignored';
      process.env[SQLEW_ENV_VARS.DATABASE_USER] = 'ignored';

      const merged = applyEnvConfigOverrides({
        ...DEFAULT_CONFIG,
        database: { path: '.sqlew/sqlew.db' },
      });
      assert.strictEqual(merged.database?.connection?.host, 'from-url');
    });

    it('honors SSL_REJECT_UNAUTHORIZED=true for discrete SSL', () => {
      process.env[SQLEW_ENV_VARS.DATABASE_TYPE] = 'postgres';
      process.env[SQLEW_ENV_VARS.DATABASE_HOST] = 'db.example.com';
      process.env[SQLEW_ENV_VARS.DATABASE_NAME] = 'sqlew';
      process.env[SQLEW_ENV_VARS.DATABASE_USER] = 'u';
      process.env[SQLEW_ENV_VARS.DATABASE_PASSWORD] = 'p';
      process.env[SQLEW_ENV_VARS.DATABASE_SSL] = 'true';
      process.env[SQLEW_ENV_VARS.DATABASE_SSL_REJECT_UNAUTHORIZED] = 'true';

      const merged = applyEnvConfigOverrides({ ...DEFAULT_CONFIG });
      assert.deepStrictEqual(merged.database?.auth?.ssl, {
        rejectUnauthorized: true,
      });
    });
  });

  describe('discrete database env helpers', () => {
    it('hasEnvDiscreteDatabaseConnection reflects HOST', () => {
      assert.strictEqual(hasEnvDiscreteDatabaseConnection(), false);
      process.env[SQLEW_ENV_VARS.DATABASE_HOST] = '127.0.0.1';
      assert.strictEqual(hasEnvDiscreteDatabaseConnection(), true);
    });

    it('sslConfigFromDiscreteEnv defaults rejectUnauthorized false', () => {
      process.env[SQLEW_ENV_VARS.DATABASE_SSL] = 'true';
      assert.deepStrictEqual(sslConfigFromDiscreteEnv(), {
        rejectUnauthorized: false,
      });
    });

    it('buildDatabaseConfigFromDiscreteEnv returns undefined without HOST', () => {
      assert.strictEqual(
        buildDatabaseConfigFromDiscreteEnv('postgres'),
        undefined
      );
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
