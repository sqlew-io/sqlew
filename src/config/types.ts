/**
 * Configuration file type definitions
 * Defines the structure of .sqlew/config.toml
 */

// ============================================================================
// Authentication Types (v3.7.0+)
// ============================================================================

/**
 * SSL/TLS configuration for database connections.
 *
 * Used for secure connections to PostgreSQL and MySQL databases.
 * Supports both file paths and inline certificate content.
 *
 * @since v3.7.0
 *
 * @example
 * // Using certificate files
 * const ssl: SSLConfig = {
 *   ca: '/path/to/ca-cert.pem',
 *   cert: '/path/to/client-cert.pem',
 *   key: '/path/to/client-key.pem',
 *   rejectUnauthorized: true
 * };
 *
 * @example
 * // Using inline certificate content
 * const ssl: SSLConfig = {
 *   ca: '-----BEGIN CERTIFICATE-----\n...',
 *   rejectUnauthorized: true
 * };
 */
export interface SSLConfig {
  /**
   * Certificate Authority (CA) certificate.
   * Can be a file path or the certificate content itself.
   */
  ca?: string;

  /**
   * Client certificate for mutual TLS authentication.
   * Can be a file path or the certificate content itself.
   */
  cert?: string;

  /**
   * Client private key for mutual TLS authentication.
   * Can be a file path or the key content itself.
   */
  key?: string;

  /**
   * Whether to reject unauthorized/self-signed certificates.
   * Set to false for development with self-signed certificates.
   *
   * @default true
   * @security Setting to false is not recommended for production
   */
  rejectUnauthorized?: boolean;
}

/**
 * Authentication configuration for database connections.
 *
 * Supports multiple authentication methods:
 * - direct: Standard username/password (optionally with SSL)
 * - aws-iam: AWS RDS IAM authentication (future)
 * - gcp-iam: GCP Cloud SQL IAM authentication (future)
 *
 * **Note:** SSH tunneling is not supported by this software.
 * Users must set up SSH tunnels manually and connect to localhost:port.
 *
 * @since v3.7.0
 *
 * @example
 * // Direct authentication with SSL
 * const auth: AuthConfig = {
 *   type: 'direct',
 *   user: 'postgres',
 *   password: 'secret',
 *   ssl: {
 *     ca: '/path/to/ca.pem',
 *     rejectUnauthorized: true
 *   }
 * };
 *
 * @example
 * // Connection via manual SSH tunnel
 * // Step 1: Set up SSH tunnel manually:
 * //   ssh -L 3307:db.internal.company.com:3306 user@bastion.example.com
 * // Step 2: Connect to localhost:
 * const config: DatabaseConfig = {
 *   type: 'mysql',
 *   connection: {
 *     host: 'localhost',
 *     port: 3307,  // Forwarded port from SSH tunnel
 *     database: 'mydb'
 *   },
 *   auth: {
 *     type: 'direct',
 *     user: 'dbuser',
 *     password: 'dbpass'
 *   }
 * };
 */
export interface AuthConfig {
  /**
   * Authentication method type.
   *
   * - 'direct': Direct connection with username/password (or localhost tunnel)
   * - 'aws-iam': AWS RDS IAM authentication (planned)
   * - 'gcp-iam': GCP Cloud SQL IAM authentication (planned)
   */
  type: 'direct' | 'aws-iam' | 'gcp-iam';

  /**
   * Database username.
   */
  user?: string;

  /**
   * Database password.
   */
  password?: string;

  /**
   * SSL/TLS configuration for encrypted connections.
   */
  ssl?: SSLConfig;
}

/**
 * Database connection parameters.
 *
 * Defines the target database server location and database name.
 * Used in conjunction with AuthConfig for complete connection setup.
 *
 * @since v3.7.0
 *
 * @example
 * const connection: ConnectionConfig = {
 *   host: 'db.internal.example.com',
 *   port: 5432,
 *   database: 'production'
 * };
 */
export interface ConnectionConfig {
  /**
   * Database server hostname or IP address.
   */
  host: string;

  /**
   * Database server port.
   * - PostgreSQL: 5432 (default)
   * - MySQL: 3306 (default)
   * - SQLite: Not applicable
   */
  port: number;

  /**
   * Database name to connect to.
   * For SQLite, this is the file path.
   */
  database: string;
}

/**
 * Database configuration for MCP Shared Context Server.
 *
 * **SQLite Configuration (default):**
 * - Only requires `path` field
 * - No authentication needed
 * - Suitable for local development and single-agent setups
 *
 * **PostgreSQL/MySQL Configuration:**
 * - Requires `type`, `connection`, and `auth` fields
 * - Supports multiple authentication methods
 * - Suitable for multi-agent production deployments
 *
 * @since v3.7.0
 *
 * @example
 * // SQLite configuration (simple, local)
 * const config: DatabaseConfig = {
 *   path: '.sqlew/sqlew.db'
 * };
 *
 * @example
 * // PostgreSQL with direct authentication
 * const config: DatabaseConfig = {
 *   type: 'postgres',
 *   connection: {
 *     host: 'localhost',
 *     port: 5432,
 *     database: 'sqlew'
 *   },
 *   auth: {
 *     type: 'direct',
 *     user: 'postgres',
 *     password: 'secret'
 *   }
 * };
 *
 * @example
 * // PostgreSQL through SSH tunnel with SSL
 * const config: DatabaseConfig = {
 *   type: 'postgres',
 *   connection: {
 *     host: 'db.internal',
 *     port: 5432,
 *     database: 'production'
 *   },
 *   auth: {
 *     type: 'ssh',
 *     user: 'postgres',
 *     password: 'dbpass',
 *     ssl: {
 *       ca: '/path/to/ca.pem',
 *       rejectUnauthorized: true
 *     },
 *     ssh: {
 *       host: 'bastion.example.com',
 *       username: 'deploy',
 *       privateKeyPath: '/home/user/.ssh/id_rsa'
 *     }
 *   }
 * };
 */
export interface DatabaseConfig {
  /**
   * Database file path for SQLite (overrides default .sqlew/sqlew.db).
   * This is the original field for backward compatibility.
   */
  path?: string;

  /**
   * Database type for multi-RDBMS support.
   * Omit for SQLite (uses path field).
   *
   * - 'sqlite': Local SQLite database (default)
   * - 'postgres': PostgreSQL database
   * - 'mysql': MySQL/MariaDB database
   * - 'cloud': Cloud backend via plugin (requires saas-connector)
   *
   * @since v3.7.0
   * @since v4.4.0 Added 'cloud' type for SaaS backend
   */
  type?: 'sqlite' | 'postgres' | 'mysql' | 'cloud';

  /**
   * Connection configuration for PostgreSQL/MySQL.
   * Not used for SQLite.
   *
   * @since v3.7.0
   */
  connection?: ConnectionConfig;

  /**
   * Authentication configuration for PostgreSQL/MySQL.
   * Not used for SQLite.
   *
   * @since v3.7.0
   */
  auth?: AuthConfig;
}

/**
 * Auto-deletion configuration
 */
export interface AutoDeleteConfig {
  /** Skip weekends in retention calculations */
  ignore_weekend?: boolean;
  /** Message retention period in hours */
  message_hours?: number;
  /** File change history retention in days */
  file_history_days?: number;
}

/**
 * Debug logging configuration (v3.5.4)
 */
export interface DebugConfig {
  /** Debug log file path (environment variable SQLEW_DEBUG takes precedence) */
  log_path?: string;
  /** Log level: "error", "warn", "info", "debug" (case-insensitive, default: "info") */
  log_level?: string;
}

/**
 * Project configuration (v3.7.0+)
 *
 * Multi-project support requires explicit project identification.
 * Once set in config.toml, the project_name becomes the authoritative source.
 *
 * @since v3.7.0
 * @see Constraint #23, #24: Config.toml as source of truth
 */
export interface ProjectConfig {
  /**
   * Project name (alphanumeric + hyphens/underscores, max 64 chars).
   *
   * Once written to config.toml on first run, this becomes the permanent
   * project identifier. Changing this requires MCP server restart.
   *
   * @see Constraint #37: Project name validation
   * @see Constraint #31: Restart required to switch projects
   */
  name: string;

  /**
   * Human-readable project display name (optional).
   * Can include spaces and special characters.
   */
  display_name?: string;
}

// ============================================================================
// Cloud Backend Configuration (v4.4.0+)
// ============================================================================

/**
 * Environment variables for cloud backend configuration.
 * These are read by the saas-connector plugin.
 *
 * Note: API endpoint is hardcoded in the plugin for security.
 * This prevents endpoint information from being exposed in OSS code.
 */
export const CLOUD_ENV_VARS = {
  /** API key for authentication (required for cloud mode) */
  API_KEY: 'SQLEW_API_KEY',
} as const;

/**
 * Detected environment types for connection identification
 * @since v5.0.0
 */
export type Environment =
  | 'windows'
  | 'macos'
  | 'linux'
  | 'wsl'
  | 'docker'
  | 'unknown';

/**
 * Connection identity for SaaS backend.
 * Provides unique identification for each connection.
 *
 * @since v5.0.0
 */
export interface ConnectionIdentity {
  /** SHA256 hash for internal identification (Base64URL, 43 chars) */
  connectionHash: string;
  /** Detected environment for display (windows, macos, linux, wsl, docker) */
  environment: Environment;
  /** Last two path segments for display (e.g., 'RustroverProjects/my-app') */
  pathSuffix: string;
  /** Full path (stored locally, not sent to server) */
  fullPath: string;
}

/**
 * Cloud backend configuration.
 * Loaded from ~/.sqlew.env (API key) and .sqlew/config.toml (project name).
 *
 * Note: API endpoint is NOT configurable here - it's hardcoded in the plugin.
 * This is intentional for security (no endpoint info in OSS).
 *
 * @since v4.4.0
 * @since v5.0.0 Added connectionIdentity for seat-based billing
 */
export interface CloudConfig {
  /** API key for authentication */
  apiKey: string;
  /** Project name from .sqlew/config.toml [project].name */
  projectName?: string;
  /** Resolved project UUID (cached in ~/.sqlew.env) */
  projectId?: string;
  /** Connection identity for SaaS mode (v5.0.0+) */
  connectionIdentity?: ConnectionIdentity;
}

/**
 * Complete configuration structure
 * Maps to .sqlew/config.toml sections
 */
export interface SqlewConfig {
  /** Project identification (v3.7.0+) */
  project?: ProjectConfig;
  /** Database settings */
  database?: DatabaseConfig;
  /** Auto-deletion settings */
  autodelete?: AutoDeleteConfig;
  /** Debug logging settings */
  debug?: DebugConfig;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: SqlewConfig = {
  database: {
    // No default path - uses DEFAULT_DB_PATH from constants
  },
  autodelete: {
    ignore_weekend: false,
    message_hours: 24,
    file_history_days: 7,
  },
};
