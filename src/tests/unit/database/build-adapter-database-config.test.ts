import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildAdapterDatabaseConfig } from '../../../database/initialization/init.js';

describe('buildAdapterDatabaseConfig', () => {
  it('copies auth.ssl onto adapter auth for Neon-style require', () => {
    const config = buildAdapterDatabaseConfig({
      databaseType: 'postgresql',
      connection: {
        host: 'pooled.db.prisma.io',
        port: 5432,
        database: 'postgres',
        user: 'user',
        password: 'secret',
      },
      auth: {
        type: 'direct',
        user: 'user',
        password: 'secret',
        ssl: { rejectUnauthorized: false },
      },
    });

    assert.ok(config);
    assert.strictEqual(config!.type, 'postgres');
    assert.deepStrictEqual(config!.auth?.ssl, { rejectUnauthorized: false });
    assert.strictEqual(config!.auth?.user, 'user');
  });

  it('falls back to connection.ssl when auth omits ssl', () => {
    const config = buildAdapterDatabaseConfig({
      databaseType: 'postgresql',
      connection: {
        host: 'db.example.com',
        port: 5432,
        database: 'sqlew',
        user: 'u',
        password: 'p',
        ssl: { rejectUnauthorized: false },
      },
      auth: {
        type: 'direct',
        user: 'u',
        password: 'p',
      },
    });

    assert.deepStrictEqual(config!.auth?.ssl, { rejectUnauthorized: false });
  });

  it('rebuilds auth from connection including ssl (legacy callers)', () => {
    const config = buildAdapterDatabaseConfig({
      databaseType: 'postgresql',
      connection: {
        host: 'db.example.com',
        port: 5432,
        database: 'sqlew',
        user: 'legacy',
        password: 'legacy-pass',
        ssl: { rejectUnauthorized: true },
      },
    });

    assert.deepStrictEqual(config!.auth, {
      type: 'direct',
      user: 'legacy',
      password: 'legacy-pass',
      ssl: { rejectUnauthorized: true },
    });
  });

  it('returns undefined without connection', () => {
    assert.strictEqual(buildAdapterDatabaseConfig({ databaseType: 'sqlite' }), undefined);
  });
});
