/**
 * Environment variable overrides for sqlew configuration.
 *
 * Applied after config file loading so Cursor Secrets / MCP env can override
 * auto-written `.sqlew/config.toml` on cloud agents (see issue #127).
 *
 * Priority (see docs/CONFIGURATION.md): CLI > env > config file > defaults.
 */

import type { SqlewConfig } from './types.js';
import { normalizeDatabaseConfig } from './loader.js';

export const SQLEW_ENV_VARS = {
  API_KEY: 'SQLEW_API_KEY',
  PROJECT_NAME: 'SQLEW_PROJECT_NAME',
  DATABASE_TYPE: 'SQLEW_DATABASE_TYPE',
} as const;

const VALID_DATABASE_TYPES = ['sqlite', 'postgres', 'mysql', 'cloud'] as const;
type DatabaseType = (typeof VALID_DATABASE_TYPES)[number];

/**
 * Read project name from SQLEW_PROJECT_NAME (trimmed, empty → undefined).
 */
export function readEnvProjectName(): string | undefined {
  const raw = process.env[SQLEW_ENV_VARS.PROJECT_NAME];
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * True when SQLEW_PROJECT_NAME is set to a non-empty value.
 */
export function hasEnvProjectNameOverride(): boolean {
  return readEnvProjectName() !== undefined;
}

/**
 * Read database.type from SQLEW_DATABASE_TYPE (case-insensitive).
 * Returns undefined when unset, empty, or invalid (invalid values are ignored).
 */
export function readEnvDatabaseType(): DatabaseType | undefined {
  const raw = process.env[SQLEW_ENV_VARS.DATABASE_TYPE];
  if (raw === undefined) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if ((VALID_DATABASE_TYPES as readonly string[]).includes(normalized)) {
    return normalized as DatabaseType;
  }
  console.warn(
    `⚠️  ${SQLEW_ENV_VARS.DATABASE_TYPE}="${raw}" is invalid; expected one of: ${VALID_DATABASE_TYPES.join(', ')}`
  );
  return undefined;
}

/**
 * Merge SQLEW_PROJECT_NAME and SQLEW_DATABASE_TYPE into a loaded config.
 * Does not mutate the input object.
 */
export function applyEnvConfigOverrides(config: SqlewConfig): SqlewConfig {
  const merged: SqlewConfig = { ...config };

  const databaseType = readEnvDatabaseType();
  if (databaseType) {
    merged.database = normalizeDatabaseConfig({ type: databaseType });
  }

  const projectName = readEnvProjectName();
  if (projectName) {
    merged.project = {
      ...merged.project,
      name: projectName,
    };
  }

  return merged;
}
