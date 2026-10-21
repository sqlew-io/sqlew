/**
 * Parse standard database connection URLs into sqlew DatabaseConfig.
 *
 * Supports postgres / postgresql / mysql / mysql2 / mariadb schemes and
 * common SSL query params (e.g. Neon `sslmode=require`).
 *
 * @see https://github.com/sqlew-io/sqlew/issues/131
 */

import type { AuthConfig, DatabaseConfig, SSLConfig } from './types.js';

const DEFAULT_PORTS: Record<'postgres' | 'mysql', number> = {
  postgres: 5432,
  mysql: 3306,
};

/** Percent-decode without throwing on malformed sequences. */
function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const POSTGRES_SCHEMES = new Set(['postgres', 'postgresql']);
const MYSQL_SCHEMES = new Set(['mysql', 'mysql2', 'mariadb']);

export type ParsedDatabaseUrl = Required<Pick<DatabaseConfig, 'type' | 'connection' | 'auth'>> & {
  type: 'postgres' | 'mysql';
};

/**
 * Map URL query SSL flags to sqlew SSLConfig.
 * Returns undefined when SSL should not be enabled.
 */
export function sslConfigFromUrlSearchParams(params: URLSearchParams): SSLConfig | undefined {
  const sslmode = (params.get('sslmode') || params.get('ssl-mode') || '').trim().toLowerCase();
  const sslFlag = (params.get('ssl') || '').trim().toLowerCase();

  if (sslmode === 'disable' || sslFlag === 'false' || sslFlag === '0') {
    return undefined;
  }

  if (
    sslmode === 'verify-full' ||
    sslmode === 'verify-ca' ||
    sslmode === 'verify_identity'
  ) {
    return { rejectUnauthorized: true };
  }

  if (
    sslmode === 'require' ||
    sslmode === 'prefer' ||
    sslmode === 'allow' ||
    sslmode === 'required' ||
    sslFlag === 'true' ||
    sslFlag === '1' ||
    sslFlag === 'require'
  ) {
    // require / prefer: encrypt without mandating CA verification (Neon-friendly)
    return { rejectUnauthorized: false };
  }

  return undefined;
}

function schemeToDatabaseType(scheme: string): 'postgres' | 'mysql' | undefined {
  const normalized = scheme.replace(/:$/, '').toLowerCase();
  if (POSTGRES_SCHEMES.has(normalized)) {
    return 'postgres';
  }
  if (MYSQL_SCHEMES.has(normalized)) {
    return 'mysql';
  }
  return undefined;
}

/**
 * Parse a postgres/mysql connection URL into sqlew database.type + connection + auth.
 *
 * @throws Error when the URL is missing, malformed, or uses an unsupported scheme
 */
export function parseDatabaseUrl(rawUrl: string): ParsedDatabaseUrl {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error('Database URL is empty');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid database URL: could not parse`);
  }

  const type = schemeToDatabaseType(parsed.protocol);
  if (!type) {
    throw new Error(
      `Unsupported database URL scheme "${parsed.protocol.replace(/:$/, '')}"; expected postgres, postgresql, mysql, mysql2, or mariadb`
    );
  }

  const host = parsed.hostname;
  if (!host) {
    throw new Error('Database URL must include a host');
  }

  const port = parsed.port
    ? Number.parseInt(parsed.port, 10)
    : DEFAULT_PORTS[type];
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`Database URL has invalid port: ${parsed.port}`);
  }

  // pathname is "/dbname" — strip leading slash
  const database = safeDecodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database) {
    throw new Error('Database URL must include a database name in the path');
  }

  // Node's URL.username/password stay percent-encoded; decode for auth fields
  const user = safeDecodeURIComponent(parsed.username || '');
  if (!user) {
    throw new Error('Database URL must include a username');
  }

  const password = safeDecodeURIComponent(parsed.password || '');

  const ssl = sslConfigFromUrlSearchParams(parsed.searchParams);
  const auth: AuthConfig = {
    type: 'direct',
    user,
    password,
    ...(ssl ? { ssl } : {}),
  };

  return {
    type,
    connection: {
      host,
      port,
      database,
    },
    auth,
  };
}

/**
 * Build a DatabaseConfig from a parsed URL (drops path / unrelated fields).
 */
export function databaseConfigFromUrl(rawUrl: string): DatabaseConfig {
  return parseDatabaseUrl(rawUrl);
}
