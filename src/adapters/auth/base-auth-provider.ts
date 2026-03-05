import type { DatabaseConfig } from '../../config/types.js';

/** Connection parameters returned by authentication providers. */
export interface ConnectionParams {
  /** Database host address. */
  host: string;

  /** Database port number. */
  port: number;

  /** Target database name. */
  database: string;

  /** Database user/username. */
  user: string;

  /** Database password or authentication token. */
  password?: string;

  /** SSL/TLS configuration for encrypted connections. */
  ssl?: {
    /** Certificate Authority (CA) certificate. */
    ca?: string;
    /** Client certificate for mutual TLS. */
    cert?: string;
    /** Client private key for mutual TLS. */
    key?: string;
    /** Whether to reject unauthorized certificates. */
    rejectUnauthorized?: boolean;
  };

  /** Database-specific additional connection parameters. */
  additionalParams?: Record<string, any>;
}

/** Abstract base class for all authentication providers. */
export abstract class BaseAuthProvider {
  /** @protected */
  protected readonly config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  /** Authenticates and returns connection parameters. @abstract */
  abstract authenticate(): Promise<ConnectionParams>;

  /** Returns a human-readable name for this authentication method. @abstract */
  abstract getAuthMethod(): string;

  /** Releases resources allocated during authentication. @abstract */
  abstract cleanup(): Promise<void>;

  /** Validates the authentication configuration. @abstract */
  abstract validate(): void;
}
