/**
 * Dialect-safe insert that returns the new row's numeric primary key.
 *
 * Knex insert return shapes differ by client:
 * - SQLite / MySQL: `[insertId]` (number[])
 * - PostgreSQL without `.returning()`: row count (number) — not iterable
 * - PostgreSQL with `.returning('id')`: `[{ id: N }]`
 *
 * Importers must use this helper (or equivalent) instead of
 * `const [id] = await knex(table).insert(...)`.
 */

import type { Knex } from 'knex';

function clientName(knex: Knex | Knex.Transaction): string {
  return String(knex.client?.config?.client ?? '');
}

function isPostgreSQL(client: string): boolean {
  return client === 'pg' || client === 'postgres' || client === 'postgresql';
}

function isSQLite(client: string): boolean {
  return client === 'better-sqlite3' || client === 'sqlite3';
}

/**
 * Normalize a knex insert / returning payload to a numeric id.
 *
 * Accepts:
 * - `42`
 * - `[42]`
 * - `[{ id: 42 }]`
 * - `{ id: 42 }`
 */
export function normalizeInsertId(result: unknown, idColumn: string = 'id'): number {
  let value: unknown = result;

  if (Array.isArray(result)) {
    if (result.length === 0) {
      throw new Error('Insert returned no id');
    }
    value = result[0];
  }

  if (value !== null && typeof value === 'object' && idColumn in (value as object)) {
    value = (value as Record<string, unknown>)[idColumn];
  }

  const id = Number(value);
  if (!Number.isFinite(id)) {
    throw new Error(`Insert returned non-numeric id: ${String(value)}`);
  }
  return id;
}

/**
 * Insert a row and return its numeric primary key across sqlite/mysql/pg.
 */
export async function insertReturningId(
  knex: Knex | Knex.Transaction,
  table: string,
  data: Record<string, unknown>,
  idColumn: string = 'id'
): Promise<number> {
  const client = clientName(knex);

  // PostgreSQL requires RETURNING; SQLite (better-sqlite3) also supports it.
  // MySQL does not — use the insertId array from a plain insert.
  if (isPostgreSQL(client) || isSQLite(client)) {
    const rows = await knex(table).insert(data).returning(idColumn);
    return normalizeInsertId(rows, idColumn);
  }

  const result = await knex(table).insert(data);
  return normalizeInsertId(result, idColumn);
}
