/**
 * Shared Knex factory for db:import / db:export CLI commands.
 *
 * Callers must pass config already merged with applyEnvConfigOverrides
 * so SQLEW_DATABASE_URL / DATABASE_URL / SSL secrets are honored.
 */

import knex, { type Knex } from 'knex';
import * as path from 'path';
import type { SqlewConfig } from '../config/types.js';
import knexConfig from '../knexfile.js';
import { getDefaultDbPath } from '../config/global-config.js';

export type CliDbDialect = 'sqlite' | 'mysql' | 'postgresql';

/**
 * Normalize config database.type to a knex CLI dialect.
 * Returns null for unsupported types (e.g. cloud).
 */
export function resolveCliDbDialect(config: SqlewConfig): CliDbDialect | null {
  const configDbType = config.database?.type || 'sqlite';
  if (configDbType === 'postgres') {
    return 'postgresql';
  }
  if (configDbType === 'mysql' || configDbType === 'sqlite') {
    return configDbType;
  }
  return null;
}

/**
 * Build a knex connection object for postgres/mysql from resolved config.
 * Passes auth.ssl through (same class of bug as #133 for MCP init).
 * Does not log credentials.
 */
export function buildRemoteCliConnection(
  dialect: 'mysql' | 'postgresql',
  config: SqlewConfig
): Record<string, unknown> {
  const connection = config.database?.connection;
  const auth = config.database?.auth;
  const ssl = auth?.ssl;

  if (dialect === 'mysql') {
    return {
      host: connection?.host || '127.0.0.1',
      port: connection?.port || 3306,
      user: auth?.user || 'root',
      password: auth?.password || '',
      database: connection?.database || 'mcp_context',
      charset: 'utf8mb4',
      ...(ssl ? { ssl } : {}),
    };
  }

  return {
    host: connection?.host || 'localhost',
    port: connection?.port || 5432,
    user: auth?.user || 'postgres',
    password: auth?.password || '',
    database: connection?.database || 'mcp_context',
    ...(ssl ? { ssl } : {}),
  };
}

export interface CreateCliKnexOptions {
  /** CLI db-path override (sqlite only). */
  dbPath?: string;
  /** Working directory for resolving relative sqlite paths. */
  cwd?: string;
}

/**
 * Create a Knex instance for CLI import/export from resolved SqlewConfig.
 */
export function createCliKnex(
  config: SqlewConfig,
  options: CreateCliKnexOptions = {}
): Knex {
  const dialect = resolveCliDbDialect(config);
  const cwd = options.cwd || process.cwd();

  if (!dialect) {
    throw new Error(
      `Unsupported database type for CLI: ${config.database?.type ?? '(unset)'}`
    );
  }

  if (dialect === 'sqlite') {
    const dbPath =
      options.dbPath ||
      config.database?.path ||
      process.env.SQLEW_DB_PATH ||
      getDefaultDbPath();
    const resolvedDbPath = path.resolve(cwd, dbPath);
    const sqliteConfig = { ...knexConfig.development };
    sqliteConfig.connection = { filename: resolvedDbPath };
    return knex(sqliteConfig);
  }

  if (dialect === 'mysql') {
    const mysqlConfig = { ...knexConfig.mysql };
    mysqlConfig.connection = buildRemoteCliConnection('mysql', config) as typeof mysqlConfig.connection;
    return knex(mysqlConfig);
  }

  const pgConfig = { ...knexConfig.postgresql };
  pgConfig.connection = buildRemoteCliConnection('postgresql', config) as typeof pgConfig.connection;
  return knex(pgConfig);
}

/**
 * Safe summary for stderr (host/port/db only — never password or URL).
 */
export function describeCliConnection(
  dialect: CliDbDialect,
  config: SqlewConfig,
  sqlitePath?: string
): string {
  if (dialect === 'sqlite') {
    return `SQLite: ${sqlitePath || config.database?.path || '(default)'}`;
  }
  const conn = config.database?.connection;
  const host = conn?.host || (dialect === 'mysql' ? '127.0.0.1' : 'localhost');
  const port = conn?.port || (dialect === 'mysql' ? 3306 : 5432);
  const database = conn?.database || 'mcp_context';
  const ssl = config.database?.auth?.ssl ? ' (ssl)' : '';
  const label = dialect === 'mysql' ? 'MySQL' : 'PostgreSQL';
  return `${label}: ${host}:${port}/${database}${ssl}`;
}
