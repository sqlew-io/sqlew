/**
 * Global configuration loader
 * Reads user-level configuration from ~/.local/share/sqlew/ (Linux/macOS) or %APPDATA%/sqlew/ (Windows)
 *
 * @since v4.1.0
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync, readdirSync, copyFileSync, renameSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { parse as parseTOML, stringify as stringifyTOML } from 'smol-toml';
import { normalizeWindowsPath } from '../utils/path-normalize.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Database configuration for global settings
 */
export interface GlobalDatabaseConfig {
  /** Database type: 'sqlite' | 'postgres' | 'mysql' */
  type?: string;
  /** Database file path (for SQLite) */
  path?: string;
  /** Connection settings (for PostgreSQL/MySQL) */
  connection?: {
    host?: string;
    port?: number;
    database?: string;
  };
  /** Authentication settings */
  auth?: {
    type?: string;
    user?: string;
    password?: string;
    ssl?: {
      rejectUnauthorized?: boolean;
    };
  };
}

/**
 * Autodelete configuration
 */
export interface GlobalAutodeleteConfig {
  ignore_weekend?: boolean;
  message_hours?: number;
  file_history_days?: number;
}

/**
 * Debug configuration
 */
export interface GlobalDebugConfig {
  log_path?: string;
  log_level?: string;
}

/**
 * Global configuration structure
 * Stored in user's home directory, applies to all projects
 */
export interface GlobalConfig {
  /** Project identification */
  project?: { name?: string; display_name?: string };
  /** Database settings (for global install) */
  database?: GlobalDatabaseConfig;
  /** Autodelete settings */
  autodelete?: GlobalAutodeleteConfig;
  /** Debug settings */
  debug?: GlobalDebugConfig;
}

/**
 * Default global configuration values
 */
export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {};

// ============================================================================
// Path Resolution
// ============================================================================

/**
 * Get the old platform-specific global config directory path (pre-v5.1)
 *
 * - Windows: %APPDATA%/sqlew/
 * - Linux/macOS: ~/.local/share/sqlew/
 *
 * @returns Absolute path to old global config directory, or null if same as new
 */
function getOldGlobalConfigDir(): string | null {
  const home = homedir();
  const newDir = join(home, '.config', 'sqlew');

  let oldDir: string;
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
    oldDir = join(appData, 'sqlew');
  } else {
    const xdgDataHome = process.env.XDG_DATA_HOME || join(home, '.local', 'share');
    oldDir = join(xdgDataHome, 'sqlew');
  }

  // If old and new resolve to the same path, no migration needed
  if (resolve(oldDir) === resolve(newDir)) {
    return null;
  }
  return oldDir;
}

/**
 * Migrate from old platform-specific global directory to unified ~/.config/sqlew/
 *
 * - Old path exists & new path doesn't → copy contents, rename old to *.migrated
 * - Old path exists & new path exists → merge session-cache only, rename old to *.migrated
 * - Old path doesn't exist → no-op
 */
function migrateOldGlobalDir(): void {
  const oldDir = getOldGlobalConfigDir();
  if (!oldDir || !existsSync(oldDir)) {
    return;
  }

  const newDir = join(homedir(), '.config', 'sqlew');
  const migratedPath = oldDir + '.migrated';

  // Already migrated
  if (existsSync(migratedPath)) {
    return;
  }

  try {
    if (!existsSync(newDir)) {
      // New dir doesn't exist → copy everything from old
      mkdirSync(newDir, { recursive: true });
      const entries = readdirSync(oldDir, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = join(oldDir, entry.name);
        const destPath = join(newDir, entry.name);
        if (entry.isDirectory()) {
          // Copy subdirectory (session-cache)
          mkdirSync(destPath, { recursive: true });
          const subEntries = readdirSync(srcPath);
          for (const subEntry of subEntries) {
            copyFileSync(join(srcPath, subEntry), join(destPath, subEntry));
          }
        } else {
          copyFileSync(srcPath, destPath);
        }
      }
    } else {
      // Both exist → merge session-cache only
      const oldCacheDir = join(oldDir, 'session-cache');
      const newCacheDir = join(newDir, 'session-cache');
      if (existsSync(oldCacheDir)) {
        if (!existsSync(newCacheDir)) {
          mkdirSync(newCacheDir, { recursive: true });
        }
        const cacheFiles = readdirSync(oldCacheDir);
        for (const file of cacheFiles) {
          const destFile = join(newCacheDir, file);
          if (!existsSync(destFile)) {
            copyFileSync(join(oldCacheDir, file), destFile);
          }
        }
      }
    }

    // Rename old directory to *.migrated
    renameSync(oldDir, migratedPath);
  } catch {
    // Migration is best-effort; don't block startup
  }
}

/**
 * Migrate old ~/.sqlew.env to ~/.config/sqlew/.sqlew.env
 *
 * - Old exists & new doesn't → copy then delete old
 * - Old exists & new exists → keep new, delete old
 * - Old doesn't exist → no-op
 *
 * Unlike migrateOldGlobalDir() which renames to *.migrated,
 * .sqlew.env contains API keys so the old file is deleted outright.
 */
function migrateOldEnvFile(): void {
  const oldEnvPath = join(homedir(), '.sqlew.env');
  if (!existsSync(oldEnvPath)) {
    return;
  }

  const newEnvPath = join(homedir(), '.config', 'sqlew', '.sqlew.env');

  try {
    if (!existsSync(newEnvPath)) {
      // Ensure target directory exists
      const targetDir = join(homedir(), '.config', 'sqlew');
      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
      }
      copyFileSync(oldEnvPath, newEnvPath);
    }
    // Delete old file regardless (new takes priority if both exist)
    unlinkSync(oldEnvPath);
  } catch {
    // Migration is best-effort; don't block startup
  }
}

/**
 * Get the global configuration directory path
 *
 * All platforms: ~/.config/sqlew/ (unified in v5.1)
 *
 * @returns Absolute path to global config directory
 */
export function getGlobalConfigDir(): string {
  return join(homedir(), '.config', 'sqlew');
}

/**
 * Get the default database path for SQLite
 *
 * Uses global shared database by default (v5.1+)
 * Name is 'sqlew-shared.db' to distinguish from project-local 'sqlew.db'
 *
 * @returns Absolute path to default SQLite database
 */
export function getDefaultDbPath(): string {
  return join(getGlobalConfigDir(), 'sqlew-shared.db');
}

/**
 * Get the global configuration file path
 *
 * @returns Absolute path to global config.toml
 */
export function getGlobalConfigPath(): string {
  return join(getGlobalConfigDir(), 'config.toml');
}

/**
 * Get the session cache directory path
 * Used for tracking current plan per project
 *
 * @returns Absolute path to session cache directory
 */
export function getSessionCacheDir(): string {
  return join(getGlobalConfigDir(), 'session-cache');
}

// ============================================================================
// Configuration Loading
// ============================================================================

/** Default config.toml template for new installations */
const CONFIG_TOML_TEMPLATE = `# ~/.config/sqlew/config.toml - Global sqlew configuration
# This config applies to all projects unless overridden by project-local config

[database]
# Default database type: sqlite | mysql | postgresql | cloud
# type = "sqlite"

# SQLite: default path (uncomment to customize)
# path = "~/.config/sqlew/sqlew-shared.db"

# MySQL example:
# type = "mysql"
# [database.connection]
# host = "127.0.0.1"
# port = 3306
# database = "sqlew"

# SaaS/Cloud mode:
# type = "cloud"
`;

/**
 * Ensure global config directory exists
 * Also migrates from old platform-specific directory (pre-v5.1)
 * and generates config.toml template if missing
 */
export function ensureGlobalConfigDir(): void {
  // Migrate from old platform-specific directory first
  migrateOldGlobalDir();
  // Migrate old ~/.sqlew.env to ~/.config/sqlew/.sqlew.env
  migrateOldEnvFile();

  const dir = getGlobalConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Generate config.toml template if missing
  const configPath = join(dir, 'config.toml');
  if (!existsSync(configPath)) {
    try {
      writeFileSync(configPath, CONFIG_TOML_TEMPLATE, 'utf-8');
    } catch {
      // Best-effort; don't block startup
    }
  }
}

/**
 * Load global configuration from user's home directory
 *
 * Priority: File config -> Defaults
 *
 * @returns Parsed and merged global configuration
 */
export function loadGlobalConfig(): GlobalConfig {
  const configPath = getGlobalConfigPath();

  // If file doesn't exist, return defaults
  if (!existsSync(configPath)) {
    return DEFAULT_GLOBAL_CONFIG;
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const parsed = parseTOML(content) as GlobalConfig;

    // Merge with defaults (preserve all parsed fields)
    return {
      project: parsed.project,
      database: parsed.database,
      autodelete: parsed.autodelete,
      debug: parsed.debug,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Warning: Failed to load global config: ${configPath}`);
    console.warn(`  Error: ${message}`);
    console.warn(`  Using default configuration`);
    return DEFAULT_GLOBAL_CONFIG;
  }
}

/**
 * Save global configuration to user's home directory
 *
 * @param config - Configuration to save
 */
export function saveGlobalConfig(config: GlobalConfig): void {
  ensureGlobalConfigDir();
  const configPath = getGlobalConfigPath();

  const toml = stringifyTOML(config as Record<string, unknown>);
  writeFileSync(configPath, toml, 'utf-8');
}

// ============================================================================
// Session Cache
// ============================================================================

/**
 * Current plan tracking information
 */
export interface CurrentPlanInfo {
  /** Unique plan ID (UUID) */
  plan_id: string;
  /** Plan file name (e.g., "rippling-spinning-eagle.md") — legacy, for Claude global plans */
  plan_file: string;
  /**
   * Absolute path to the actual plan file (preferred when set).
   * Used by Grok Build (per-session plan.md) and future environments.
   * When present, extraction logic should use this instead of resolving via plan_file + GLOBAL_PLANS_DIR.
   */
  plan_path?: string;
  /** Plan file last updated timestamp (ISO 8601) */
  plan_updated_at: string;
  /** Whether decision has been recorded for this plan */
  recorded: boolean;
  /** Whether decision needs to be created in DB (lazy registration) */
  decision_pending?: boolean;
  /** ISO 8601 timestamp of when full enforcement message was first shown */
  enforcement_shown_at?: string;
}

/**
 * Get the session cache file path for a project
 *
 * @param projectPath - Project root path
 * @returns Absolute path to session cache file
 */
export function getSessionCachePath(projectPath: string): string {
  ensureGlobalConfigDir();
  const cacheDir = getSessionCacheDir();
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }

  // Normalize path for cross-platform consistency (Git Bash/MSYS2 conversion, drive letter)
  const normalizedPath = normalizeWindowsPath(projectPath);

  // Create a safe filename from project path
  const safeName = normalizedPath
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .slice(-100); // Limit length

  return join(cacheDir, `${safeName}.json`);
}

/**
 * Load current plan info for a project
 *
 * @param projectPath - Project root path
 * @returns Current plan info or null if not found
 */
export function loadCurrentPlan(projectPath: string): CurrentPlanInfo | null {
  const cachePath = getSessionCachePath(projectPath);

  if (!existsSync(cachePath)) {
    return null;
  }

  try {
    const content = readFileSync(cachePath, 'utf-8');
    return JSON.parse(content) as CurrentPlanInfo;
  } catch {
    return null;
  }
}

/**
 * Save current plan info for a project
 *
 * @param projectPath - Project root path
 * @param info - Plan info to save
 */
export function saveCurrentPlan(projectPath: string, info: CurrentPlanInfo): void {
  const cachePath = getSessionCachePath(projectPath);
  writeFileSync(cachePath, JSON.stringify(info, null, 2), 'utf-8');
}

/**
 * Mark current plan as recorded (decision saved)
 *
 * @param projectPath - Project root path
 */
export function markPlanAsRecorded(projectPath: string): void {
  const info = loadCurrentPlan(projectPath);
  if (info) {
    info.recorded = true;
    saveCurrentPlan(projectPath, info);
  }
}

/**
 * Clear current plan info for a project
 * Used when starting a new Plan agent session to prevent stale cache issues
 *
 * @param projectPath - Project root path
 */
export function clearCurrentPlan(projectPath: string): void {
  const cachePath = getSessionCachePath(projectPath);
  if (existsSync(cachePath)) {
    try {
      unlinkSync(cachePath);
    } catch {
      // Ignore errors - file might not exist or be locked
    }
  }
}

// ============================================================================
// Plan Cache (v4.2.0+)
// ============================================================================

/**
 * Decision candidate from TOML template
 */
export interface DecisionCandidate {
  /** Required: hierarchical key (e.g., "api/auth/method") */
  key: string;
  /** Required: what was decided */
  value: string;
  /** Status: active|deprecated|draft (default: active) */
  status?: string;
  /** Layer: presentation|business|data|infrastructure|cross-cutting */
  layer?: string;
  /** Tags for categorization */
  tags?: string[];
  /** Why this choice was made */
  rationale?: string;
  /** Other options considered */
  alternatives?: string[];
  /** Gains vs sacrifices */
  tradeoffs?: string;
}

/**
 * Constraint candidate from TOML template
 */
export interface ConstraintCandidate {
  /** Required: rule description */
  text: string;
  /** Required: architecture|security|code-style|performance */
  category: string;
  /** Priority: critical|high|medium|low (default: medium) */
  priority?: string;
  /** Layer: presentation|business|data|infrastructure|cross-cutting */
  layer?: string;
  /** Tags for categorization */
  tags?: string[];
  /** Why this rule exists */
  rationale?: string;
}

/**
 * Unified cache for plan TOML data
 * Stores parsed decisions and constraints from plan file
 */
export interface PlanCache {
  /** Plan ID this cache is associated with */
  plan_id: string;
  /** Extracted decisions from TOML */
  decisions: DecisionCandidate[];
  /** Extracted constraints from TOML */
  constraints: ConstraintCandidate[];
  /** Last updated timestamp (ISO 8601) */
  updated_at: string;
  /** Whether decisions have been queued for registration */
  decisions_registered: boolean;
  /** Whether user has been prompted about constraints */
  constraints_prompted: boolean;
}

/**
 * Get the plan cache file path for a project
 *
 * @param projectPath - Project root path
 * @returns Absolute path to plan cache file
 */
export function getPlanCachePath(projectPath: string): string {
  ensureGlobalConfigDir();
  const cacheDir = getSessionCacheDir();
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }

  // Normalize path for cross-platform consistency (Git Bash/MSYS2 conversion, drive letter)
  const normalizedPath = normalizeWindowsPath(projectPath);

  const safeName = normalizedPath
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .slice(-100);

  return join(cacheDir, `${safeName}_plan-toml.json`);
}

/**
 * Load plan cache for a project
 *
 * @param projectPath - Project root path
 * @returns Plan TOML cache or null if not found
 */
export function loadPlanCache(projectPath: string): PlanCache | null {
  const cachePath = getPlanCachePath(projectPath);

  if (!existsSync(cachePath)) {
    return null;
  }

  try {
    const content = readFileSync(cachePath, 'utf-8');
    return JSON.parse(content) as PlanCache;
  } catch {
    return null;
  }
}

/**
 * Save plan cache for a project
 *
 * @param projectPath - Project root path
 * @param cache - Cache data to save
 */
export function savePlanCache(projectPath: string, cache: PlanCache): void {
  const cachePath = getPlanCachePath(projectPath);
  writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
}

/**
 * Clear plan cache for a project
 *
 * @param projectPath - Project root path
 */
export function clearPlanCache(projectPath: string): void {
  const cachePath = getPlanCachePath(projectPath);
  if (existsSync(cachePath)) {
    writeFileSync(cachePath, JSON.stringify({ decisions: [], constraints: [] }, null, 2), 'utf-8');
  }
}
