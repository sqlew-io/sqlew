/**
 * FTS5 full-text search support (SQLite only)
 *
 * Provides candidate narrowing for text-similarity searches: FTS5 returns
 * the top-K bm25-ranked candidate ids, then the existing scorers re-rank
 * that subset. MySQL/PostgreSQL and databases created before the FTS
 * migration fall back to the previous full-scan path (callers must treat
 * a `null` search result as "FTS unavailable").
 *
 * Design constraints (see decision search/fts5-app-level-sync):
 * - Plain (self-contained) FTS5 tables, NOT external-content tables:
 *   t_decisions has a composite PK, so rowid mapping would be fragile.
 * - Synchronization happens in application write paths; DB triggers are
 *   prohibited in this project.
 * - FTS sync/search failures must never fail the primary operation.
 *   Sync errors are logged and swallowed; search errors return null so
 *   callers fall back to the full scan.
 *
 * The trigram tokenizer is used so that both space-separated languages
 * and CJK text can match on substrings (unicode61 would treat a CJK
 * sentence as one giant token).
 */

import type { Knex } from 'knex';
import { debugLog } from './debug-logger.js';

export const DECISIONS_FTS_TABLE = 't_decisions_fts';
export const CONSTRAINTS_FTS_TABLE = 't_constraints_fts';

/** Default number of candidates FTS returns for scorer re-ranking */
export const FTS_CANDIDATE_LIMIT = 200;

/** Maximum number of OR terms in a generated MATCH query */
const MAX_MATCH_TERMS = 50;

/** Long tokens are chunked into windows of this size... */
const CHUNK_SIZE = 6;
/** ...advancing this many characters per window (overlap keeps recall) */
const CHUNK_STEP = 3;

/**
 * FTS availability per knex client (keyed by client so transactions,
 * which share the client of their root knex instance, hit the cache)
 */
const ftsAvailability = new WeakMap<object, boolean>();

/**
 * Whether the connection is SQLite (the only backend with FTS5 support)
 */
export function isSQLiteClient(knex: Knex): boolean {
  const client = (knex.client as { config?: { client?: string } })?.config?.client;
  return client === 'better-sqlite3' || client === 'sqlite3';
}

/**
 * Check whether FTS5 tables exist on this connection (cached per client)
 */
export async function isFtsAvailable(knex: Knex): Promise<boolean> {
  if (!isSQLiteClient(knex)) {
    return false;
  }

  const cacheKey = knex.client as object;
  const cached = ftsAvailability.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  let available = false;
  try {
    const row = await knex('sqlite_master')
      .where({ type: 'table', name: CONSTRAINTS_FTS_TABLE })
      .first();
    available = !!row;
  } catch (error) {
    debugLog('WARN', '[fts] availability check failed', { error: String(error) });
    available = false;
  }

  ftsAvailability.set(cacheKey, available);
  return available;
}

/**
 * Reset the availability cache (for tests that create/drop FTS tables)
 */
export function resetFtsAvailabilityCache(knex?: Knex): void {
  if (knex) {
    ftsAvailability.delete(knex.client as object);
  }
}

/**
 * Build an FTS5 MATCH expression from free text.
 *
 * Every term is double-quoted (with embedded quotes doubled) so user text
 * can never produce MATCH syntax errors. Tokens longer than CHUNK_SIZE are
 * split into overlapping windows so that CJK text (no word separators)
 * still matches candidates that share partial content.
 *
 * Returns null when no usable term remains (text too short for trigram);
 * callers should fall back to the full-scan path.
 */
export function buildFtsMatchQuery(text: string): string | null {
  const terms: string[] = [];

  for (const rawToken of text.trim().split(/\s+/)) {
    // Trigram tokenizer cannot match anything shorter than 3 chars
    if (rawToken.length < 3) {
      continue;
    }

    if (rawToken.length <= CHUNK_SIZE) {
      terms.push(rawToken);
    } else {
      for (let i = 0; i + CHUNK_SIZE <= rawToken.length; i += CHUNK_STEP) {
        terms.push(rawToken.substring(i, i + CHUNK_SIZE));
      }
      // Cover the tail the stepped windows may have missed
      terms.push(rawToken.substring(rawToken.length - CHUNK_SIZE));
    }

    if (terms.length >= MAX_MATCH_TERMS) {
      break;
    }
  }

  if (terms.length === 0) {
    return null;
  }

  return terms
    .slice(0, MAX_MATCH_TERMS)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(' OR ');
}

/**
 * Replace the FTS row for a decision (insert or update)
 */
export async function ftsUpsertDecision(
  knex: Knex,
  entry: { keyId: number; projectId: number; keyName: string; value: string }
): Promise<void> {
  try {
    if (!(await isFtsAvailable(knex))) return;

    await knex(DECISIONS_FTS_TABLE)
      .where({ key_id: entry.keyId, project_id: entry.projectId })
      .delete();
    await knex(DECISIONS_FTS_TABLE).insert({
      key_id: entry.keyId,
      project_id: entry.projectId,
      key_name: entry.keyName,
      value: entry.value,
    });
  } catch (error) {
    debugLog('WARN', '[fts] decision upsert failed (search index may be stale)', {
      keyId: entry.keyId,
      error: String(error),
    });
  }
}

/**
 * Remove the FTS row for a decision (hard delete)
 */
export async function ftsDeleteDecision(
  knex: Knex,
  keyId: number,
  projectId: number
): Promise<void> {
  try {
    if (!(await isFtsAvailable(knex))) return;

    await knex(DECISIONS_FTS_TABLE)
      .where({ key_id: keyId, project_id: projectId })
      .delete();
  } catch (error) {
    debugLog('WARN', '[fts] decision delete failed (search index may be stale)', {
      keyId,
      error: String(error),
    });
  }
}

/**
 * Insert the FTS row for a newly created constraint
 * (constraint_text is immutable; activate/deactivate are handled by the
 * active filter when candidates are loaded, so no FTS update is needed)
 */
export async function ftsInsertConstraint(
  knex: Knex,
  entry: { constraintId: number; projectId: number; constraintText: string; reason?: string | null }
): Promise<void> {
  try {
    if (!(await isFtsAvailable(knex))) return;

    await knex(CONSTRAINTS_FTS_TABLE).insert({
      constraint_id: entry.constraintId,
      project_id: entry.projectId,
      constraint_text: entry.constraintText,
      reason: entry.reason ?? '',
    });
  } catch (error) {
    debugLog('WARN', '[fts] constraint insert failed (search index may be stale)', {
      constraintId: entry.constraintId,
      error: String(error),
    });
  }
}

/**
 * Return the bm25-ranked top-K constraint ids matching the text,
 * or null when FTS is unavailable or the query cannot run
 * (callers must fall back to the full-scan path on null)
 */
export async function ftsSearchConstraintIds(
  knex: Knex,
  text: string,
  projectId: number,
  limit: number = FTS_CANDIDATE_LIMIT
): Promise<number[] | null> {
  if (!(await isFtsAvailable(knex))) {
    return null;
  }

  const match = buildFtsMatchQuery(text);
  if (!match) {
    return null;
  }

  try {
    const rows = (await knex(CONSTRAINTS_FTS_TABLE)
      .select('constraint_id')
      .whereRaw(`${CONSTRAINTS_FTS_TABLE} MATCH ?`, [match])
      .where('project_id', projectId)
      .orderByRaw('rank')
      .limit(limit)) as Array<{ constraint_id: number | string }>;

    return rows.map((r) => Number(r.constraint_id));
  } catch (error) {
    debugLog('WARN', '[fts] constraint search failed, falling back to full scan', {
      error: String(error),
    });
    return null;
  }
}
