// knexfile.ts
import type { Knex } from 'knex';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { existsSync, readFileSync } from 'fs';
import { parse as parseTOML } from 'smol-toml';
import { homedir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Project root is one level up from src/ (where this file lives)
// This ensures migrations always target the correct database regardless of cwd
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Read database path from config.toml (same as MCP server does)
// Priority: Environment variable > config.toml > default
let configDbPath: string | undefined;
// Use PROJECT_ROOT for config lookup (not process.cwd())
// This ensures consistent DB path resolution regardless of where npm command is run
const configPath = path.join(PROJECT_ROOT, '.sqlew/config.toml');

if (existsSync(configPath)) {
  try {
    const content = readFileSync(configPath, 'utf-8');
    const parsed = parseTOML(content) as any;
    configDbPath = parsed.database?.path;
  } catch (error) {
    // Ignore config parsing errors, use default
  }
}

const DEFAULT_DB_PATH = process.env.SQLEW_DB_PATH || configDbPath || path.join(homedir(), '.config', 'sqlew', 'sqlew-shared.db');

const config: { [key: string]: Knex.Config } = {
  development: {
    client: 'better-sqlite3',
    connection: {
      // Development uses project root relative path
      filename: path.resolve(PROJECT_ROOT, DEFAULT_DB_PATH),
    },
    useNullAsDefault: true,
    migrations: {
      directory: path.join(__dirname, 'database/migrations/v4'),
      extension: 'js',  // Use .js to match production (tsx still loads .ts via loadExtensions)
      tableName: 'knex_migrations',
      loadExtensions: ['.ts'],
    },
    seeds: {
      directory: path.join(__dirname, 'seeds'),
      extension: 'js',  // Use .js to match production
      loadExtensions: ['.ts'],
    },
    // Enable better-sqlite3 pragmas for performance
    pool: {
      afterCreate: (conn: any, cb: any) => {
        conn.pragma('journal_mode = WAL');
        conn.pragma('foreign_keys = ON');
        conn.pragma('synchronous = NORMAL');
        conn.pragma('busy_timeout = 5000');
        cb(null, conn);
      },
    },
  },

  test: {
    client: 'better-sqlite3',
    connection: {
      filename: ':memory:', // In-memory database for testing
    },
    useNullAsDefault: true,
    migrations: {
      directory: path.join(__dirname, 'database/migrations/v4'),
      extension: 'js',  // Use .js to match production
      loadExtensions: ['.ts'],
    },
    seeds: {
      directory: path.join(__dirname, 'seeds'),
      extension: 'js',  // Use .js to match production
      loadExtensions: ['.ts'],
    },
  },

  production: {
    client: 'better-sqlite3',
    connection: {
      // Production uses project root relative path
      filename: path.resolve(PROJECT_ROOT, DEFAULT_DB_PATH),
    },
    useNullAsDefault: true,
    migrations: {
      directory: path.join(__dirname, 'database/migrations/v4'),
      extension: 'js',
      loadExtensions: ['.js'],
    },
    seeds: {
      directory: path.join(__dirname, 'seeds'),
      extension: 'js',
      loadExtensions: ['.js'],
    },
    pool: {
      afterCreate: (conn: any, cb: any) => {
        conn.pragma('journal_mode = WAL');
        conn.pragma('foreign_keys = ON');
        conn.pragma('synchronous = FULL'); // Production: maximum safety
        conn.pragma('busy_timeout = 10000');
        cb(null, conn);
      },
    },
  },

  // MySQL/MariaDB configuration for data migration
  mysql: {
    client: 'mysql2',
    connection: {
      host: process.env.MYSQL_HOST || '127.0.0.1',
      port: parseInt(process.env.MYSQL_PORT || '3306'),
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'mcp_context',
      charset: 'utf8mb4',
    },
    migrations: {
      directory: path.join(__dirname, 'database/migrations/v4'),
      extension: 'js',  // Use .js to match production
      tableName: 'knex_migrations',
      loadExtensions: ['.ts'],
    },
    seeds: {
      directory: path.join(__dirname, 'seeds'),
      extension: 'js',  // Use .js to match production
      loadExtensions: ['.ts'],
    },
    pool: {
      min: 2,
      max: 10,
    },
  },

  // PostgreSQL configuration for data migration
  postgresql: {
    client: 'pg',
    connection: {
      host: process.env.PG_HOST || 'localhost',
      port: parseInt(process.env.PG_PORT || '5432'),
      user: process.env.PG_USER || 'postgres',
      password: process.env.PG_PASSWORD || '',
      database: process.env.PG_DATABASE || 'mcp_context',
    },
    migrations: {
      directory: path.join(__dirname, 'database/migrations/v4'),
      extension: 'js',  // Use .js to match production
      tableName: 'knex_migrations',
      loadExtensions: ['.ts'],
    },
    seeds: {
      directory: path.join(__dirname, 'seeds'),
      extension: 'js',  // Use .js to match production
      loadExtensions: ['.ts'],
    },
    pool: {
      min: 2,
      max: 10,
    },
  },
};

export default config;
