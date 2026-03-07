/**
 * Local-to-Global Database Migration (v5.1)
 *
 * Migrates project-local SQLite database (.sqlew/sqlew.db) to the global
 * shared database (~/.config/sqlew/sqlew-shared.db).
 *
 * Strategy:
 * - Global DB doesn't exist → file copy (fastest path)
 * - Global DB exists → JSON export/import merge (data deduplication)
 * - After migration → rename local DB to .migrated
 */

import { existsSync, copyFileSync, renameSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import knex from 'knex';
import { debugLog } from '../utils/debug-logger.js';
import { generateJsonExport } from '../utils/exporter/export.js';
import { importJsonData } from '../utils/importer/import.js';

/**
 * Migrate a project-local SQLite database to the global shared database
 *
 * @param projectRoot - Project root directory containing .sqlew/sqlew.db
 * @param globalDbPath - Target global database path
 */
export async function migrateLocalToGlobal(
  projectRoot: string,
  globalDbPath: string
): Promise<void> {
  const localDbPath = resolve(projectRoot, '.sqlew/sqlew.db');

  if (!existsSync(localDbPath)) {
    return;
  }

  // Ensure global directory exists
  const globalDir = dirname(globalDbPath);
  if (!existsSync(globalDir)) {
    mkdirSync(globalDir, { recursive: true });
  }

  debugLog('INFO', 'Starting local-to-global DB migration', {
    localDbPath,
    globalDbPath,
  });

  try {
    if (!existsSync(globalDbPath)) {
      // Fast path: global DB doesn't exist → file copy
      copyFileSync(localDbPath, globalDbPath);
      // Also copy WAL/SHM files if they exist
      for (const suffix of ['-wal', '-shm', '-journal']) {
        const localExtra = localDbPath + suffix;
        if (existsSync(localExtra)) {
          copyFileSync(localExtra, globalDbPath + suffix);
        }
      }
      debugLog('INFO', 'Local DB copied to global (fast path)', { globalDbPath });
    } else {
      // Merge path: global DB exists → export local, save backup JSON, import into global
      await mergeLocalIntoGlobal(localDbPath, globalDbPath, projectRoot);
      debugLog('INFO', 'Local DB merged into global (merge path)', { globalDbPath });
    }

    // Rename local DB to .migrated
    renameSync(localDbPath, localDbPath + '.migrated');
    // Clean up WAL/SHM files
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const localExtra = localDbPath + suffix;
      if (existsSync(localExtra)) {
        try {
          renameSync(localExtra, localExtra + '.migrated');
        } catch {
          // Best-effort cleanup
        }
      }
    }

    debugLog('INFO', 'Local DB migration complete', {
      migrated: localDbPath + '.migrated',
    });
  } catch (error) {
    // Migration failure is non-fatal; keep local DB intact
    debugLog('WARN', 'Local-to-global DB migration failed, keeping local DB', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Merge local database data into existing global database via JSON export/import
 *
 * Before importing, saves a JSON export to .sqlew/pre-migration-export.json
 * as a safety net. If import skips due to project name conflict, the user
 * can manually run `db:import` with this file later.
 */
async function mergeLocalIntoGlobal(
  localDbPath: string,
  globalDbPath: string,
  projectRoot: string
): Promise<void> {
  // Open local DB for export
  const localKnex = knex({
    client: 'better-sqlite3',
    connection: { filename: localDbPath },
    useNullAsDefault: true,
  });

  try {
    const jsonString = await generateJsonExport(localKnex, {});

    // Save JSON export as safety net before attempting import
    const exportPath = resolve(projectRoot, '.sqlew/pre-migration-export.json');
    writeFileSync(exportPath, jsonString, 'utf-8');
    debugLog('INFO', 'Pre-migration JSON export saved', { exportPath });

    const jsonData = JSON.parse(jsonString);

    // Open global DB for import
    const globalKnex = knex({
      client: 'better-sqlite3',
      connection: { filename: globalDbPath },
      useNullAsDefault: true,
    });

    try {
      const result = await importJsonData(globalKnex, jsonData, { skipIfExists: true });

      if (result.success && !result.skipped) {
        // Import succeeded — remove safety net file
        try { unlinkSync(exportPath); } catch { /* best-effort */ }
      } else {
        debugLog('INFO', 'Pre-migration export kept (import skipped or failed)', {
          exportPath,
          skipped: result.skipped,
          skipReason: result.skip_reason,
        });
      }
    } finally {
      await globalKnex.destroy();
    }
  } finally {
    await localKnex.destroy();
  }
}
