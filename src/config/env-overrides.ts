/**
 * Environment variable overrides for sqlew configuration.
 *
 * Applied after config file loading so Cursor Secrets / MCP env can override
 * auto-written `.sqlew/config.toml` on cloud agents (see issues #127, #131).
 *
 * Priority (see docs/CONFIGURATION.md): CLI > env > config file > defaults.
 *
 * Database connection from env (first match wins):
 * 1. SQLEW_DATABASE_URL / DATABASE_URL
 * 2. Discrete SQLEW_DATABASE_HOST (+ type, name, user, …)
 * 3. SQLEW_DATABASE_TYPE alone (preserves file connection/auth)
 */

import type { AuthConfig, DatabaseConfig, SSLConfig, SqlewConfig } from './types.js';
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
  /** Discrete connection fields (preferred for Cursor Secrets UI). */
  DATABASE_HOST: 'SQLEW_DATABASE_HOST',
  DATABASE_PORT: 'SQLEW_DATABASE_PORT',
  DATABASE_NAME: 'SQLEW_DATABASE_NAME',
  DATABASE_USER: 'SQLEW_DATABASE_USER',
  DATABASE_PASSWORD: 'SQLEW_DATABASE_PASSWORD',
  /** Enable SSL (`true` / `1` / `require`). Do not put a host IP in DATABASE_URL. */
  DATABASE_SSL: 'SQLEW_DATABASE_SSL',
  /** When SSL is on: `true` verifies CA; `false` matches Neon sslmode=require. */
  DATABASE_SSL_REJECT_UNAUTHORIZED: 'SQLEW_DATABASE_SSL_REJECT_UNAUTHORIZED',
} as const;

const VALID_DATABASE_TYPES = ['sqlite', 'postgres', 'mysql', 'cloud'] as const;
type DatabaseType = (typeof VALID_DATABASE_TYPES)[number];
type RemoteDatabaseType = 'postgres' | 'mysql';

const DEFAULT_PORTS: Record<RemoteDatabaseType, number> = {
  postgres: 5432,
  mysql: 3306,
};

function readTrimmedEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseEnvBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (['1', 'true', 'yes', 'on', 'require'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off', 'disable', 'disabled'].includes(normalized)) {
    return false;
  }
  return undefined;
}

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
  return (
    readTrimmedEnv(SQLEW_ENV_VARS.DATABASE_URL) ??
    readTrimmedEnv(SQLEW_ENV_VARS.DATABASE_URL_ALIAS)
  );
}

/**
 * True when SQLEW_DATABASE_HOST is set (discrete connection mode).
 */
export function hasEnvDiscreteDatabaseConnection(): boolean {
  return readTrimmedEnv(SQLEW_ENV_VARS.DATABASE_HOST) !== undefined;
}

/**
 * SSL from discrete env vars.
 * - SQLEW_DATABASE_SSL=true → enable SSL (default rejectUnauthorized=false, Neon-friendly)
 * - SQLEW_DATABASE_SSL_REJECT_UNAUTHORIZED overrides rejectUnauthorized when SSL is on
 * - REJECT_UNAUTHORIZED alone also enables SSL
 */
export function sslConfigFromDiscreteEnv(): SSLConfig | undefined {
  const sslFlag = parseEnvBool(process.env[SQLEW_ENV_VARS.DATABASE_SSL]);
  const rejectRaw = process.env[SQLEW_ENV_VARS.DATABASE_SSL_REJECT_UNAUTHORIZED];
  const rejectUnauthorized = parseEnvBool(rejectRaw);

  if (sslFlag === false) {
    return undefined;
  }

  if (sslFlag === true || rejectUnauthorized !== undefined) {
    return {
      rejectUnauthorized: rejectUnauthorized ?? false,
    };
  }

  return undefined;
}

/**
 * Build postgres/mysql DatabaseConfig from discrete SQLEW_DATABASE_* env vars.
 * Returns undefined when HOST is unset or required fields are missing/invalid.
 */
export function buildDatabaseConfigFromDiscreteEnv(
  databaseType: DatabaseType | undefined
): DatabaseConfig | undefined {
  const host = readTrimmedEnv(SQLEW_ENV_VARS.DATABASE_HOST);
  if (!host) {
    return undefined;
  }

  if (databaseType !== 'postgres' && databaseType !== 'mysql') {
    console.warn(
      `⚠️  ${SQLEW_ENV_VARS.DATABASE_HOST} is set but ${SQLEW_ENV_VARS.DATABASE_TYPE} must be postgres or mysql (got ${databaseType ?? 'unset'})`
    );
    return undefined;
  }

  const database = readTrimmedEnv(SQLEW_ENV_VARS.DATABASE_NAME);
  const user = readTrimmedEnv(SQLEW_ENV_VARS.DATABASE_USER);
  if (!database || !user) {
    console.warn(
      `⚠️  Discrete database env requires ${SQLEW_ENV_VARS.DATABASE_NAME} and ${SQLEW_ENV_VARS.DATABASE_USER} when ${SQLEW_ENV_VARS.DATABASE_HOST} is set`
    );
    return undefined;
  }

  const portRaw = readTrimmedEnv(SQLEW_ENV_VARS.DATABASE_PORT);
  let port = DEFAULT_PORTS[databaseType];
  if (portRaw !== undefined) {
    const parsedPort = Number.parseInt(portRaw, 10);
    if (!Number.isFinite(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      console.warn(
        `⚠️  ${SQLEW_ENV_VARS.DATABASE_PORT}="${portRaw}" is invalid; expected 1–65535`
      );
      return undefined;
    }
    port = parsedPort;
  }

  // Password may be empty (local trust); treat unset as empty string
  const password =
    process.env[SQLEW_ENV_VARS.DATABASE_PASSWORD] !== undefined
      ? process.env[SQLEW_ENV_VARS.DATABASE_PASSWORD]!
      : '';

  const ssl = sslConfigFromDiscreteEnv();
  const auth: AuthConfig = {
    type: 'direct',
    user,
    password,
    ...(ssl ? { ssl } : {}),
  };

  return normalizeDatabaseConfig({
    type: databaseType,
    connection: { host, port, database },
    auth,
  });
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
 * Merge project name + database env (URL, discrete fields, or type) into a
 * loaded config. Does not mutate the input object.
 *
 * Connection priority: URL > discrete HOST fields > type-only > file.
 * Env connection always replaces auto-written local `.sqlew/config.toml`.
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
  } else {
    const discrete = buildDatabaseConfigFromDiscreteEnv(databaseType);
    if (discrete) {
      merged.database = discrete;
    } else if (databaseType) {
      merged.database = applyDatabaseTypeOnly(config.database, databaseType);
    }
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
