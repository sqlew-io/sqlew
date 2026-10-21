import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  insertReturningId,
  normalizeInsertId,
} from '../../../utils/insert-returning-id.js';
import { initializeDatabase, closeDatabase } from '../../../database.js';
import type { DatabaseAdapter } from '../../../adapters/types.js';

describe('normalizeInsertId', () => {
  it('accepts a bare number (sqlite/mysql insertId element)', () => {
    assert.equal(normalizeInsertId(42), 42);
  });

  it('accepts [number] (sqlite/mysql insert return)', () => {
    assert.equal(normalizeInsertId([7]), 7);
  });

  it('accepts [{ id }] (postgres returning)', () => {
    assert.equal(normalizeInsertId([{ id: 99 }]), 99);
  });

  it('accepts { id } object', () => {
    assert.equal(normalizeInsertId({ id: 3 }), 3);
  });

  it('uses a custom id column', () => {
    assert.equal(normalizeInsertId([{ pk: 11 }], 'pk'), 11);
  });

  it('throws on empty array (postgres returning with no rows)', () => {
    assert.throws(() => normalizeInsertId([]), /no id/);
  });

  it('throws when value is not numeric (avoids treating pg row-count misuse silently)', () => {
    assert.throws(() => normalizeInsertId([{ id: 'x' }]), /non-numeric/);
  });
});

describe('insertReturningId (sqlite)', () => {
  let testDb: DatabaseAdapter;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlew-insert-id-'));
    const dbPath = path.join(tempDir, 'test.db');
    testDb = await initializeDatabase({ connection: { filename: dbPath } });
  });

  afterEach(async () => {
    await closeDatabase();
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns numeric id for sqlite insert via returning', async () => {
    const knex = testDb.getKnex();
    const id = await insertReturningId(knex, 'm_context_keys', {
      key_name: `insert-id-helper/${Date.now()}`,
    });
    assert.equal(typeof id, 'number');
    assert.ok(id > 0);

    const row = await knex('m_context_keys').where({ id }).first();
    assert.ok(row);
  });
});
