/**
 * Environment variable overrides for sqlew configuration.
 *
 * Applied after config file loading so Cursor Secrets / MCP env can override
 * auto-written `.sqlew/config.toml` on cloud agents (see issues #127, #131).
 *
 * Priority (see docs/CONFIGURATION.md): CLI > env > config file > defaults.
 */

import type { DatabaseConfig, SqlewConfig } from './types.js';
import { normalizeDatabaseConfig } from './loader.js';
import { parseDatabaseUrl } from './database-url.js';

export const SQLEW_ENV_VARS = {
  API_KEY: 'SQLEW_API_KEY',
  PROJECT_NAME: 'SQLEW_PROJECT_NAME',
  DATABASE_TYPE: 'SQLEW_DATABASE_TYPE',
  /** Primary connection URL for postgres/mysql (Cursor Secrets). */
  DATABASE_URL: 'SQLEW_DATABASE_URL',
  /** Common alias accepted when SQLEW_DATABASE_URL is unset. */
  DATABASE_URL_ALIAS: 'DATABASE_URL',
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
 * Read connection URL: prefer SQLEW_DATABASE_URL, else DATABASE_URL.
 * Empty / whitespace-only → undefined.
 */
export function readEnvDatabaseUrl(): string | undefined {
  const primary = process.env[SQLEW_ENV_VARS.DATABASE_URL];
  if (primary !== undefined) {
    const trimmed = primary.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  const alias = process.env[SQLEW_ENV_VARS.DATABASE_URL_ALIAS];
  if (alias !== undefined) {
    const trimmed = alias.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return undefined;
}

/**
 * Merge type-only env into an existing database config without wiping
 * connection/auth from the file when switching to postgres/mysql.
 */
function applyDatabaseTypeOnly(
  existing: DatabaseConfig | undefined,
  databaseType: DatabaseType
): DatabaseConfig {
  if (databaseType === 'cloud') {
    return normalizeDatabaseConfig({ type: 'cloud' });
  }

  if (databaseType === 'sqlite') {
    return normalizeDatabaseConfig({
      type: 'sqlite',
      path: existing?.path,
    });
  }

  // postgres / mysql: keep file connection + auth; only change type
  return normalizeDatabaseConfig({
    type: databaseType,
    connection: existing?.connection,
    auth: existing?.auth,
  });
}

/**
 * Merge SQLEW_PROJECT_NAME, SQLEW_DATABASE_TYPE, and SQLEW_DATABASE_URL
 * (or DATABASE_URL) into a loaded config. Does not mutate the input object.
 *
 * Env URL always replaces file database settings (wins over auto-written
 * local `.sqlew/config.toml`). Type alone no longer wipes connection/auth.
 */
export function applyEnvConfigOverrides(config: SqlewConfig): SqlewConfig {
  const merged: SqlewConfig = { ...config };

  const databaseType = readEnvDatabaseType();
  const databaseUrl = readEnvDatabaseUrl();

  if (databaseUrl) {
    try {
      const parsed = parseDatabaseUrl(databaseUrl);
      if (
        databaseType &&
        databaseType !== parsed.type &&
        (databaseType === 'postgres' || databaseType === 'mysql')
      ) {
        console.warn(
          `⚠️  ${SQLEW_ENV_VARS.DATABASE_TYPE}=${databaseType} conflicts with URL scheme (${parsed.type}); using URL`
        );
      } else if (databaseType === 'cloud' || databaseType === 'sqlite') {
        console.warn(
          `⚠️  ${SQLEW_ENV_VARS.DATABASE_TYPE}=${databaseType} ignored because ${SQLEW_ENV_VARS.DATABASE_URL} (or DATABASE_URL) is set`
        );
      }
      merged.database = normalizeDatabaseConfig(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️  Ignoring database URL env: ${message}`);
    }
  } else if (databaseType) {
    merged.database = applyDatabaseTypeOnly(config.database, databaseType);
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
