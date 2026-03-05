import { BaseAuthProvider, type ConnectionParams } from './base-auth-provider.js';
import type { DatabaseConfig } from '../../config/types.js';

/** Direct database authentication provider (no tunneling or proxy). */
export class DirectAuthProvider extends BaseAuthProvider {
  getAuthMethod(): string {
    return 'Direct Connection';
  }

  /** Validates direct connection configuration. */
  validate(): void {
    // Check connection config exists
    if (!this.config.connection) {
      throw new Error('Connection configuration is required for DirectAuthProvider');
    }

    const conn = this.config.connection;

    // Check required connection parameters
    if (!conn.host || !conn.port || !conn.database) {
      throw new Error('Database host, port, and database name are required');
    }

    // Check authentication config exists
    if (!this.config.auth) {
      throw new Error('Authentication configuration is required for DirectAuthProvider');
    }

    // Check required auth parameters (password is optional)
    if (!this.config.auth.user) {
      throw new Error('Database user is required for direct authentication');
    }
  }

  /** Authenticates and returns connection parameters. */
  async authenticate(): Promise<ConnectionParams> {
    // Validate before proceeding (defensive check)
    this.validate();

    // Build connection parameters directly from config
    // Non-null assertions safe after validate()
    const params: ConnectionParams = {
      host: this.config.connection!.host,
      port: this.config.connection!.port,
      database: this.config.connection!.database,
      user: this.config.auth!.user!,
      password: this.config.auth!.password,
    };

    // Preserve SSL configuration if present
    if (this.config.auth!.ssl) {
      params.ssl = {
        ca: this.config.auth!.ssl.ca,
        cert: this.config.auth!.ssl.cert,
        key: this.config.auth!.ssl.key,
        rejectUnauthorized: this.config.auth!.ssl.rejectUnauthorized,
      };
    }

    return params;
  }

  /** No-op: direct connections have no resources to clean up. */
  async cleanup(): Promise<void> {
    // No-op
  }
}
