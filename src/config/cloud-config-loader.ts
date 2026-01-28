/**
 * Cloud Configuration Loader
 *
 * Loads API key and cloud configuration from global ~/.sqlew.env file.
 * Supports environment variable override for CI/CD environments.
 *
 * @since v5.0.0
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CLOUD_ENV_VARS, type CloudConfig } from './types.js';
import { detectEnvironment, type Environment } from '../utils/environment-detector.js';
import { extractPathSuffix, getProjectRoot } from '../utils/path-utils.js';
import { generateConnectionHash } from '../utils/connection-hash.js';

/**
 * Connection identity for SaaS backend
 */
export interface ConnectionIdentity {
  /** SHA256 hash for internal identification */
  connectionHash: string;
  /** Detected environment for display */
  environment: Environment;
  /** Last two path segments for display */
  pathSuffix: string;
  /** Full path (stored locally, not sent to server) */
  fullPath: string;
}

/**
 * Extended cloud configuration with connection identity
 */
export interface ExtendedCloudConfig extends CloudConfig {
  connectionIdentity?: ConnectionIdentity;
}

/**
 * Get the path to the global .sqlew.env file
 *
 * @returns Absolute path to ~/.sqlew.env
 */
export function getGlobalEnvPath(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, '.sqlew.env');
}

/**
 * Parse .env file content and extract key-value pairs
 *
 * @param content - File content
 * @returns Parsed key-value pairs
 */
function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Remove surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

/**
 * Load API key from global ~/.sqlew.env file
 *
 * Priority:
 * 1. Environment variable SQLEW_API_KEY
 * 2. ~/.sqlew.env file
 *
 * @returns API key or null if not found
 */
export function loadApiKey(): string | null {
  // Priority 1: Environment variable
  const envApiKey = process.env[CLOUD_ENV_VARS.API_KEY];
  if (envApiKey) {
    return envApiKey;
  }

  // Priority 2: Global ~/.sqlew.env file
  const globalEnvPath = getGlobalEnvPath();
  try {
    if (fs.existsSync(globalEnvPath)) {
      const content = fs.readFileSync(globalEnvPath, 'utf-8');
      const parsed = parseEnvContent(content);
      return parsed[CLOUD_ENV_VARS.API_KEY] ?? null;
    }
  } catch {
    // File read error, return null
  }

  return null;
}

/**
 * Load project ID from environment or global config
 *
 * Priority:
 * 1. Environment variable SQLEW_PROJECT_ID
 * 2. ~/.sqlew.env file
 *
 * @returns Project ID or undefined
 */
export function loadProjectId(): string | undefined {
  // Priority 1: Environment variable
  const envProjectId = process.env[CLOUD_ENV_VARS.PROJECT_ID];
  if (envProjectId) {
    return envProjectId;
  }

  // Priority 2: Global ~/.sqlew.env file
  const globalEnvPath = getGlobalEnvPath();
  try {
    if (fs.existsSync(globalEnvPath)) {
      const content = fs.readFileSync(globalEnvPath, 'utf-8');
      const parsed = parseEnvContent(content);
      return parsed[CLOUD_ENV_VARS.PROJECT_ID];
    }
  } catch {
    // File read error, return undefined
  }

  return undefined;
}

/**
 * Create connection identity for SaaS mode
 *
 * @param apiKey - API key
 * @param projectId - Optional project ID
 * @param projectRoot - Project root path (optional, defaults to cwd)
 * @returns Connection identity
 */
export function createConnectionIdentity(
  apiKey: string,
  projectId: string | undefined,
  projectRoot?: string
): ConnectionIdentity {
  const fullPath = projectRoot ?? getProjectRoot();
  const environment = detectEnvironment();
  const pathSuffix = extractPathSuffix(fullPath);
  const connectionHash = generateConnectionHash(apiKey, projectId, fullPath);

  return {
    connectionHash,
    environment,
    pathSuffix,
    fullPath,
  };
}

/**
 * Load complete cloud configuration from global file
 *
 * This is the main entry point for loading cloud configuration.
 * It loads API key, project ID, and creates connection identity.
 *
 * @param projectRoot - Project root path (optional)
 * @returns Extended cloud config or null if API key not found
 */
export function loadCloudConfigFromGlobal(
  projectRoot?: string
): ExtendedCloudConfig | null {
  const apiKey = loadApiKey();
  if (!apiKey) {
    return null;
  }

  const projectId = loadProjectId();
  const connectionIdentity = createConnectionIdentity(apiKey, projectId, projectRoot);

  return {
    apiKey,
    projectId,
    connectionIdentity,
  };
}

/**
 * Check if global .sqlew.env file exists
 */
export function hasGlobalEnvFile(): boolean {
  return fs.existsSync(getGlobalEnvPath());
}

/**
 * Check file permissions (Unix-only)
 *
 * On Unix systems, .sqlew.env should have 600 permissions.
 * On Windows, this check is skipped (returns true).
 *
 * @returns true if permissions are OK or on Windows
 */
export function checkEnvFilePermissions(): {
  ok: boolean;
  message?: string;
} {
  const globalEnvPath = getGlobalEnvPath();

  if (!fs.existsSync(globalEnvPath)) {
    return { ok: true }; // No file, no problem
  }

  // Windows doesn't have Unix-style permissions
  if (process.platform === 'win32') {
    return {
      ok: true,
      message:
        'Windows does not support Unix file permissions. Ensure the file is in a secure location.',
    };
  }

  try {
    const stats = fs.statSync(globalEnvPath);
    const mode = stats.mode & 0o777;

    // Check for 600 (owner read/write only)
    if (mode !== 0o600) {
      return {
        ok: false,
        message: `${globalEnvPath} has insecure permissions (${mode.toString(8)}). Run: chmod 600 ${globalEnvPath}`,
      };
    }

    return { ok: true };
  } catch {
    return { ok: true }; // Can't check, assume OK
  }
}
