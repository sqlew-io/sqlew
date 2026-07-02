/**
 * Session context snapshot writer
 *
 * MCP server writes top-N decisions + active constraints to
 * .sqlew/session-context.json. Hooks read this file without opening the DB.
 *
 * Fail-soft: snapshot failures never fail the primary write operation.
 *
 * @since v5.4.0
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync } from 'fs';
import { join } from 'path';
import type { Knex } from 'knex';
import { getAdapter } from '../database.js';
import { isCloudMode } from '../backend/backend-factory.js';
import { loadConfigWithWorktreeSupport } from '../config/loader.js';
import {
  DEFAULT_SESSION_CONTEXT_BUDGET,
} from '../config/types.js';
import { DEFAULT_STATUS } from '../constants.js';
import { getProjectContext } from './project-context.js';
import { UniversalKnex } from './universal-knex.js';
import { convertPriorityArray } from './enum-converter.js';
import { debugLog } from './debug-logger.js';

// ============================================================================
// Constants
// ============================================================================

export const SESSION_SNAPSHOT_VERSION = 1 as const;
export const SESSION_SNAPSHOT_FILENAME = 'session-context.json';
export const MAX_SNAPSHOT_DECISIONS = 15;
export const MAX_SNAPSHOT_CONSTRAINTS = 15;
export const VALUE_TRUNCATE_CHARS = 200;
export const REASON_TRUNCATE_CHARS = 150;
const DEBOUNCE_MS = 500;

// ============================================================================
// Types
// ============================================================================

export interface SnapshotDecision {
  key: string;
  value: string;
  layer?: string;
  tags?: string;
  updated: string;
}

export interface SnapshotConstraint {
  category: string;
  rule: string;
  priority: string;
  reason?: string;
  tags?: string;
}

export interface SessionSnapshot {
  version: typeof SESSION_SNAPSHOT_VERSION;
  project_name: string;
  generated_at: string;
  decisions: SnapshotDecision[];
  constraints: SnapshotConstraint[];
}

interface PendingRefresh {
  projectId: number;
  projectName: string;
  rootPath: string;
}

// ============================================================================
// State
// ============================================================================

const pendingRefreshes = new Map<number, PendingRefresh>();
const debounceTimers = new Map<number, ReturnType<typeof setTimeout>>();

// ============================================================================
// Path helpers
// ============================================================================

export function getSnapshotPath(rootPath: string): string {
  return join(rootPath, '.sqlew', SESSION_SNAPSHOT_FILENAME);
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(0, maxChars - 3) + '...';
}

// ============================================================================
// Snapshot building
// ============================================================================

export async function buildSessionSnapshot(
  knex: Knex,
  projectId: number,
  projectName: string,
): Promise<SessionSnapshot> {
  const db = new UniversalKnex(knex);

  const castNumericToText = db.isPostgreSQL
    ? 'CAST(dn.value AS TEXT)'
    : db.isSQLite
      ? 'dn.value'
      : 'CAST(dn.value AS CHAR)';

  const decisionRows = await knex('t_decisions as d')
    .join('m_context_keys as k', 'd.key_id', 'k.id')
    .leftJoin('m_layers as l', 'd.layer_id', 'l.id')
    .leftJoin('t_decisions_numeric as dn', function () {
      this.on('dn.key_id', '=', 'd.key_id').andOn('dn.project_id', '=', 'd.project_id');
    })
    .where('d.project_id', projectId)
    .where('d.status', DEFAULT_STATUS)
    .orderBy('d.ts', 'desc')
    .limit(MAX_SNAPSHOT_DECISIONS)
    .select([
      'k.key_name as key',
      knex.raw(`COALESCE(NULLIF(d.value, ''), ${castNumericToText}) as value`),
      'l.name as layer',
      knex.raw(`${db.dateFunction('d.ts')} as updated`),
      knex.raw(`(
        SELECT ${db.stringAgg('t2.name', ',')}
        FROM t_decision_tags dt2
        JOIN m_tags t2 ON dt2.tag_id = t2.id
        WHERE dt2.decision_key_id = d.key_id
      ) as tags`),
    ]);

  const constraintRows = await knex('t_constraints as c')
    .join('m_constraint_categories as cat', 'c.category_id', 'cat.id')
    .where('c.project_id', projectId)
    .where('c.active', db.boolTrue())
    .orderBy('c.priority', 'desc')
    .orderBy('c.ts', 'desc')
    .limit(MAX_SNAPSHOT_CONSTRAINTS)
    .select([
      'cat.name as category',
      'c.constraint_text',
      'c.reason',
      'c.priority',
      knex.raw(`(
        SELECT ${db.stringAgg('t2.name', ',')}
        FROM t_constraint_tags ct2
        JOIN m_tags t2 ON ct2.tag_id = t2.id
        WHERE ct2.constraint_id = c.id
      ) as tags`),
    ]);

  const priorityRows = convertPriorityArray(constraintRows);

  const decisions: SnapshotDecision[] = decisionRows.map((row: Record<string, unknown>) => ({
    key: String(row.key),
    value: truncateText(String(row.value ?? ''), VALUE_TRUNCATE_CHARS),
    ...(row.layer ? { layer: String(row.layer) } : {}),
    ...(row.tags ? { tags: String(row.tags) } : {}),
    updated: String(row.updated),
  }));

  const constraints: SnapshotConstraint[] = priorityRows.map((row: Record<string, unknown>) => ({
    category: String(row.category),
    rule: truncateText(String(row.constraint_text ?? ''), VALUE_TRUNCATE_CHARS),
    priority: String(row.priority),
    ...(row.reason ? { reason: truncateText(String(row.reason), REASON_TRUNCATE_CHARS) } : {}),
    ...(row.tags ? { tags: String(row.tags) } : {}),
  }));

  return {
    version: SESSION_SNAPSHOT_VERSION,
    project_name: projectName,
    generated_at: new Date().toISOString(),
    decisions,
    constraints,
  };
}

// ============================================================================
// Snapshot writing
// ============================================================================

export function writeSessionSnapshot(rootPath: string, snapshot: SessionSnapshot): void {
  const snapshotPath = getSnapshotPath(rootPath);
  const sqlewDir = join(rootPath, '.sqlew');

  if (!existsSync(sqlewDir)) {
    mkdirSync(sqlewDir, { recursive: true });
  }

  const tempPath = snapshotPath + '.tmp';
  const content = JSON.stringify(snapshot, null, 2);
  writeFileSync(tempPath, content, 'utf-8');

  try {
    renameSync(tempPath, snapshotPath);
  } catch (error) {
    debugLog('WARN', '[session-snapshot] rename failed, using direct write', {
      error: error instanceof Error ? error.message : String(error),
    });
    writeFileSync(snapshotPath, content, 'utf-8');
    try {
      unlinkSync(tempPath);
    } catch {
      // ignore
    }
  }
}

export function readSessionSnapshot(rootPath: string): SessionSnapshot | null {
  const snapshotPath = getSnapshotPath(rootPath);
  if (!existsSync(snapshotPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(snapshotPath, 'utf-8')) as SessionSnapshot;
  } catch {
    return null;
  }
}

// ============================================================================
// Refresh scheduling
// ============================================================================

async function isSnapshotEnabled(rootPath: string): Promise<boolean> {
  try {
    const config = await loadConfigWithWorktreeSupport(rootPath);
    if (isCloudMode(config)) {
      return false;
    }
    const budget = config.hooks?.session_context_budget ?? DEFAULT_SESSION_CONTEXT_BUDGET;
    return budget > 0;
  } catch (error) {
    debugLog('WARN', '[session-snapshot] config load failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function executeRefresh(pending: PendingRefresh): Promise<void> {
  try {
    if (!(await isSnapshotEnabled(pending.rootPath))) {
      return;
    }

    const adapter = getAdapter();
    const knex = adapter.getKnex();
    const snapshot = await buildSessionSnapshot(
      knex,
      pending.projectId,
      pending.projectName,
    );
    writeSessionSnapshot(pending.rootPath, snapshot);
    debugLog('DEBUG', '[session-snapshot] refreshed', {
      projectId: pending.projectId,
      decisions: snapshot.decisions.length,
      constraints: snapshot.constraints.length,
    });
  } catch (error) {
    debugLog('WARN', '[session-snapshot] refresh failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Schedule a debounced snapshot refresh for the current project.
 * Captures project metadata at call time (ALS-safe).
 */
export function scheduleSnapshotRefresh(): void {
  try {
    const ctx = getProjectContext();
    if (ctx.isUnbound()) {
      return;
    }

    let metadata;
    try {
      metadata = ctx.getProjectMetadata();
    } catch {
      return;
    }

    const rootPath = metadata.project_root_path;
    if (!rootPath) {
      return;
    }

    const pending: PendingRefresh = {
      projectId: metadata.id,
      projectName: metadata.name,
      rootPath,
    };

    pendingRefreshes.set(metadata.id, pending);

    const existing = debounceTimers.get(metadata.id);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      debounceTimers.delete(metadata.id);
      const latest = pendingRefreshes.get(metadata.id);
      if (latest) {
        void executeRefresh(latest);
      }
    }, DEBOUNCE_MS);

    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    debounceTimers.set(metadata.id, timer);
  } catch (error) {
    debugLog('WARN', '[session-snapshot] schedule failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Immediately refresh the session snapshot for the current project.
 * Used at server startup.
 */
export async function refreshSnapshotNow(): Promise<void> {
  try {
    const ctx = getProjectContext();
    if (ctx.isUnbound()) {
      return;
    }

    const metadata = ctx.getProjectMetadata();
    const rootPath = metadata.project_root_path;
    if (!rootPath) {
      return;
    }

    await executeRefresh({
      projectId: metadata.id,
      projectName: metadata.name,
      rootPath,
    });
  } catch (error) {
    debugLog('WARN', '[session-snapshot] refreshSnapshotNow failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Flush pending debounced refreshes (for tests).
 */
export async function flushSnapshotRefresh(): Promise<void> {
  for (const [projectId, timer] of debounceTimers) {
    clearTimeout(timer);
    debounceTimers.delete(projectId);
    const pending = pendingRefreshes.get(projectId);
    if (pending) {
      await executeRefresh(pending);
    }
  }
}