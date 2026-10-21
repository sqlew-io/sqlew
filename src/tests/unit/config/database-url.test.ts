import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  databaseConfigFromUrl,
  parseDatabaseUrl,
  sslConfigFromUrlSearchParams,
} from '../../../config/database-url.js';

describe('database-url', () => {
  describe('sslConfigFromUrlSearchParams', () => {
    it('maps sslmode=require to SSL without CA verification', () => {
      const params = new URLSearchParams('sslmode=require');
      assert.deepStrictEqual(sslConfigFromUrlSearchParams(params), {
        rejectUnauthorized: false,
      });
    });

    it('maps sslmode=verify-full to rejectUnauthorized true', () => {
      const params = new URLSearchParams('sslmode=verify-full');
      assert.deepStrictEqual(sslConfigFromUrlSearchParams(params), {
        rejectUnauthorized: true,
      });
    });

    it('maps ssl=true', () => {
      const params = new URLSearchParams('ssl=true');
      assert.deepStrictEqual(sslConfigFromUrlSearchParams(params), {
        rejectUnauthorized: false,
      });
    });

    it('returns undefined for sslmode=disable', () => {
      const params = new URLSearchParams('sslmode=disable');
      assert.strictEqual(sslConfigFromUrlSearchParams(params), undefined);
    });

    it('returns undefined when no SSL flags', () => {
      assert.strictEqual(sslConfigFromUrlSearchParams(new URLSearchParams()), undefined);
    });
  });

  describe('parseDatabaseUrl', () => {
    it('parses a Neon-style postgres URL with sslmode=require', () => {
      const url =
        'postgresql://neondb_owner:p%40ss@ep-cool-name.us-east-2.aws.neon.tech/neondb?sslmode=require';
      const parsed = parseDatabaseUrl(url);

      assert.strictEqual(parsed.type, 'postgres');
      assert.deepStrictEqual(parsed.connection, {
        host: 'ep-cool-name.us-east-2.aws.neon.tech',
        port: 5432,
        database: 'neondb',
      });
      assert.strictEqual(parsed.auth.type, 'direct');
      assert.strictEqual(parsed.auth.user, 'neondb_owner');
      assert.strictEqual(parsed.auth.password, 'p@ss');
      assert.deepStrictEqual(parsed.auth.ssl, { rejectUnauthorized: false });
    });

    it('parses postgres:// with explicit port', () => {
      const parsed = parseDatabaseUrl('postgres://u:secret@db.example.com:5433/app');
      assert.strictEqual(parsed.type, 'postgres');
      assert.strictEqual(parsed.connection.port, 5433);
      assert.strictEqual(parsed.auth.password, 'secret');
      assert.strictEqual(parsed.auth.ssl, undefined);
    });

    it('parses mysql URL with default port 3306', () => {
      const parsed = parseDatabaseUrl('mysql://root:rootpass@127.0.0.1/sqlew');
      assert.strictEqual(parsed.type, 'mysql');
      assert.deepStrictEqual(parsed.connection, {
        host: '127.0.0.1',
        port: 3306,
        database: 'sqlew',
      });
      assert.strictEqual(parsed.auth.user, 'root');
      assert.strictEqual(parsed.auth.password, 'rootpass');
    });

    it('accepts mysql2 and mariadb schemes as mysql', () => {
      assert.strictEqual(parseDatabaseUrl('mysql2://u:p@h/db').type, 'mysql');
      assert.strictEqual(parseDatabaseUrl('mariadb://u:p@h/db').type, 'mysql');
    });

    it('rejects unsupported schemes', () => {
      assert.throws(() => parseDatabaseUrl('sqlite:///tmp/x.db'), /Unsupported database URL scheme/);
    });

    it('rejects missing database name', () => {
      assert.throws(() => parseDatabaseUrl('postgres://u:p@localhost'), /database name/);
    });

    it('rejects missing username', () => {
      assert.throws(() => parseDatabaseUrl('postgres://localhost/db'), /username/);
    });

    it('databaseConfigFromUrl returns DatabaseConfig shape', () => {
      const config = databaseConfigFromUrl('mysql://u:p@host:3307/db?ssl=true');
      assert.strictEqual(config.type, 'mysql');
      assert.strictEqual(config.connection?.port, 3307);
      assert.deepStrictEqual(config.auth?.ssl, { rejectUnauthorized: false });
    });
  });
});
