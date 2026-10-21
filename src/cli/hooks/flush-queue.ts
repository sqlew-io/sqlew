/**
 * Flush Queue Command
 *
 * Processes `.sqlew/queue/pending.json` into the DB (upsert-by-key).
 * Used when MCP QueueWatcher is absent (e.g. Cursor Cloud) and from
 * `on-stop` so Stop always drains the queue.
 *
 * Usage:
 *   sqlew flush-queue
 *   echo '{"hook_event_name":"Stop","cwd":"/path"}' | sqlew flush-queue
 *
 * @since v5.4.x
 */

import { existsSync } from 'fs';
import { resolve, isAbsolute, basename } from 'path';
import { readStdinJson, getProjectPath, sendContinue } from './stdin-parser.js';
import { determineProjectRoot } from '../../utils/project-root.js';
import { loadConfigFile } from '../../config/loader.js';
import { applyEnvConfigOverrides } from '../../config/env-overrides.js';
import { getDefaultDbPath } from '../../config/global-config.js';
import { DEFAULT_DB_PATH } from '../../constants.js';
import { initializeDatabase, getAdapter, closeDatabase } from '../../database.js';
import { ProjectContext } from '../../utils/project-context.js';
import {
  createBackend,
  initializeBackend,
  getBackend,
  isCloudMode,
  resetBackend,
} from '../../backend/backend-factory.js';
import {
  hasQueueItems,
  processQueue,
  readQueue,
} from '../../utils/hook-queue.js';
import { processQueueItem } from '../../utils/queue-processor.js';
import type { ToolBackend } from '../../backend/types.js';
import type { SqlewConfig } from '../../config/types.js';

export interface FlushQueueResult {
  processed: number;
  skipped: boolean;
  reason?: string;
  projectPath: string;
}

export interface FlushQueueOptions {
  /** Project root (cwd). Defaults to determineProjectRoot / stdin cwd. */
  projectPath?: string;
  /** Existing backend — skip DB bootstrap when provided (MCP / tests). */
  backend?: ToolBackend;
  /** Close DB/backend after flush when this command opened them. Default true for CLI. */
  shutdown?: boolean;
}

/**
 * Resolve project path from optional stdin + env + cwd.
 */
export async function resolveFlushProjectPath(
  explicit?: string
): Promise<string> {
  if (explicit) return explicit;

  // Prefer stdin cwd when piped (Stop hook / plugin)
  if (!process.stdin.isTTY) {
    try {
      const input = await readStdinJson();
      const fromHook = getProjectPath(input);
      if (fromHook) return fromHook;
    } catch {
      // empty / non-JSON stdin — fall through
    }
  }

  return determineProjectRoot();
}

/**
 * Bootstrap local/cloud backend for a project root (CLI / on-stop path).
 */
async function bootstrapBackend(projectPath: string): Promise<{
  backend: ToolBackend;
  config: SqlewConfig;
  owned: true;
}> {
  let config = loadConfigFile(projectPath);
  config = applyEnvConfigOverrides(config);

  if (isCloudMode(config)) {
    const backend = await initializeBackend(config, projectPath);
    const projectName =
      config.project?.name || basename(projectPath.replace(/\/$/, '')) || 'default';
    ProjectContext.reset();
    ProjectContext.getInstance().initWithoutDb(projectName, 'config', {
      projectRootPath: projectPath,
    });
    return { backend, config, owned: true };
  }

  const dbType = config.database?.type || 'sqlite';

  if (dbType === 'mysql' || dbType === 'postgres') {
    const initType = dbType === 'postgres' ? 'postgresql' : 'mysql';
    await initializeDatabase({
      databaseType: initType,
      connection: {
        ...config.database?.connection,
        user: config.database?.auth?.user,
        password: config.database?.auth?.password,
        ...(config.database?.auth?.ssl ? { ssl: config.database.auth.ssl } : {}),
      },
      auth: config.database?.auth,
    });
  } else {
    // SQLite: config path → local .sqlew/db → global shared default
    let dbPath = config.database?.path || process.env.SQLEW_DB_PATH;
    if (dbPath && !isAbsolute(dbPath)) {
      dbPath = resolve(projectPath, dbPath);
    }
    if (!dbPath) {
      const localDb = resolve(projectPath, DEFAULT_DB_PATH);
      dbPath = existsSync(localDb) ? localDb : getDefaultDbPath();
    }
    await initializeDatabase({
      connection: { filename: dbPath },
    });
  }

  const knex = getAdapter().getKnex();
  const projectName =
    config.project?.name || basename(projectPath.replace(/\/$/, '')) || 'default';
  ProjectContext.reset();
  await ProjectContext.getInstance().ensureProject(knex, projectName, 'config', {
    projectRootPath: projectPath,
  });

  const backend = await initializeBackend(config, projectPath);
  return { backend, config, owned: true };
}

/**
 * Process pending.json into DB via upsert-by-key processor.
 *
 * Safe to call when queue is empty or another process holds the lock
 * (returns processed=0 / skipped).
 */
export async function flushPendingQueue(
  options: FlushQueueOptions = {}
): Promise<FlushQueueResult> {
  const projectPath = options.projectPath
    ? options.projectPath
    : await resolveFlushProjectPath();

  if (!hasQueueItems(projectPath)) {
    return {
      processed: 0,
      skipped: true,
      reason: 'empty',
      projectPath,
    };
  }

  let backend = options.backend;
  let owned = false;

  try {
    if (!backend) {
      const boot = await bootstrapBackend(projectPath);
      backend = boot.backend;
      owned = true;
    }

    const pendingBefore = readQueue(projectPath).items.length;
    const processed = await processQueue(
      projectPath,
      (item) => processQueueItem(backend!, item, 'flush-queue'),
      'flush-queue'
    );

    return {
      processed,
      skipped: processed === 0 && pendingBefore > 0,
      reason:
        processed === 0 && pendingBefore > 0
          ? 'lock_held_or_race'
          : undefined,
      projectPath,
    };
  } finally {
    const shouldShutdown = options.shutdown ?? owned;
    if (shouldShutdown && owned) {
      try {
        await resetBackend();
      } catch {
        /* ignore */
      }
      try {
        await closeDatabase();
      } catch {
        /* ignore */
      }
      ProjectContext.reset();
    }
  }
}

/**
 * CLI / hook entry: flush queue then emit continue (fail-open).
 */
export async function flushQueueCommand(): Promise<void> {
  try {
    const result = await flushPendingQueue({ shutdown: true });
    if (result.processed > 0) {
      // stdout for plugin / scripts that await the CLI
      console.log(
        JSON.stringify({
          ok: true,
          processed: result.processed,
          projectPath: result.projectPath,
        })
      );
    } else {
      console.log(
        JSON.stringify({
          ok: true,
          processed: 0,
          skipped: result.skipped,
          reason: result.reason ?? 'empty',
          projectPath: result.projectPath,
        })
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[sqlew flush-queue] Error: ${message}`);
    // Fail-open for hooks
    sendContinue();
  }
}

/** @internal re-export for callers that already hold a backend */
export { createBackend, getBackend };
