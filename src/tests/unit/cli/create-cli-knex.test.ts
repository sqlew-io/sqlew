import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  buildRemoteCliConnection,
  describeCliConnection,
  resolveCliDbDialect,
} from '../../../cli/create-cli-knex.js';
import { resolveDbImportConfig } from '../../../cli/db-import.js';
import { SQLEW_ENV_VARS } from '../../../config/env-overrides.js';
import type { SqlewConfig } from '../../../config/types.js';
import { DEFAULT_CONFIG } from '../../../config/types.js';

const ENV_KEYS = [
  SQLEW_ENV_VARS.PROJECT_NAME,
  SQLEW_ENV_VARS.DATABASE_TYPE,
  SQLEW_ENV_VARS.DATABASE_URL,
  SQLEW_ENV_VARS.DATABASE_URL_ALIAS,
  SQLEW_ENV_VARS.DATABASE_HOST,
  SQLEW_ENV_VARS.DATABASE_PORT,
  SQLEW_ENV_VARS.DATABASE_NAME,
  SQLEW_ENV_VARS.DATABASE_USER,
  SQLEW_ENV_VARS.DATABASE_PASSWORD,
  SQLEW_ENV_VARS.DATABASE_SSL,
  SQLEW_ENV_VARS.DATABASE_SSL_REJECT_UNAUTHORIZED,
] as const;

describe('create-cli-knex helpers', () => {
  it('resolveCliDbDialect maps postgres → postgresql', () => {
    assert.equal(
      resolveCliDbDialect({
        ...DEFAULT_CONFIG,
        database: { type: 'postgres' },
      }),
      'postgresql'
    );
  });

  it('resolveCliDbDialect returns null for cloud', () => {
    assert.equal(
      resolveCliDbDialect({
        ...DEFAULT_CONFIG,
        database: { type: 'cloud' },
      }),
      null
    );
  });

  it('buildRemoteCliConnection passes auth.ssl for postgres', () => {
    const config: SqlewConfig = {
      ...DEFAULT_CONFIG,
      database: {
        type: 'postgres',
        connection: {
          host: 'ep.example.neon.tech',
          port: 5432,
          database: 'neondb',
        },
        auth: {
          type: 'direct',
          user: 'neondb_owner',
          password: 'secret-should-not-leak',
          ssl: { rejectUnauthorized: false },
        },
      },
    };

    const conn = buildRemoteCliConnection('postgresql', config);
    assert.equal(conn.host, 'ep.example.neon.tech');
    assert.equal(conn.user, 'neondb_owner');
    assert.deepEqual(conn.ssl, { rejectUnauthorized: false });
    assert.equal(conn.password, 'secret-should-not-leak');
  });

  it('buildRemoteCliConnection omits ssl when unset', () => {
    const config: SqlewConfig = {
      ...DEFAULT_CONFIG,
      database: {
        type: 'postgres',
        connection: { host: 'localhost', port: 5432, database: 'sqlew' },
        auth: { type: 'direct', user: 'u', password: 'p' },
      },
    };
    const conn = buildRemoteCliConnection('postgresql', config);
    assert.equal('ssl' in conn, false);
  });

  it('describeCliConnection never includes password', () => {
    const config: SqlewConfig = {
      ...DEFAULT_CONFIG,
      database: {
        type: 'postgres',
        connection: { host: 'db.example', port: 5432, database: 'app' },
        auth: {
          type: 'direct',
          user: 'u',
          password: 'super-secret-password',
          ssl: { rejectUnauthorized: false },
        },
      },
    };
    const summary = describeCliConnection('postgresql', config);
    assert.match(summary, /PostgreSQL: db\.example:5432\/app \(ssl\)/);
    assert.equal(summary.includes('super-secret-password'), false);
    assert.equal(summary.includes('password'), false);
  });
});

describe('resolveDbImportConfig env overrides', () => {
  const originalEnv = { ...process.env };
  let tempDir: string;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlew-db-import-cfg-'));
    fs.mkdirSync(path.join(tempDir, '.sqlew'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, '.sqlew', 'config.toml'),
      `[project]\nname = "workspace"\n\n[database]\npath = ".sqlew/sqlew.db"\n`
    );
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('applies SQLEW_DATABASE_URL over local sqlite config.toml', () => {
    process.env[SQLEW_ENV_VARS.DATABASE_URL] =
      'postgresql://neondb_owner:secret@ep-x.us-east-2.aws.neon.tech/neondb?sslmode=require';

    const merged = resolveDbImportConfig(undefined, tempDir);

    assert.equal(merged.database?.type, 'postgres');
    assert.equal(merged.database?.path, undefined);
    assert.equal(merged.database?.connection?.host, 'ep-x.us-east-2.aws.neon.tech');
    assert.equal(merged.database?.connection?.database, 'neondb');
    assert.equal(merged.database?.auth?.user, 'neondb_owner');
    assert.deepEqual(merged.database?.auth?.ssl, { rejectUnauthorized: false });

    // Connection builder must receive SSL (Prisma/Neon)
    const conn = buildRemoteCliConnection('postgresql', merged);
    assert.deepEqual(conn.ssl, { rejectUnauthorized: false });
    assert.equal(conn.host, 'ep-x.us-east-2.aws.neon.tech');
  });

  it('applies DATABASE_URL alias when SQLEW_DATABASE_URL unset', () => {
    process.env[SQLEW_ENV_VARS.DATABASE_URL_ALIAS] =
      'postgresql://u:p@db.example.com:5432/app?sslmode=require';

    const merged = resolveDbImportConfig(undefined, tempDir);
    assert.equal(merged.database?.type, 'postgres');
    assert.equal(merged.database?.connection?.host, 'db.example.com');
  });

  it('falls back to sqlite from config when no DB env set', () => {
    const merged = resolveDbImportConfig(undefined, tempDir);
    assert.equal(merged.database?.type || 'sqlite', 'sqlite');
    assert.ok(merged.database?.path?.includes('sqlew.db'));
  });
});
