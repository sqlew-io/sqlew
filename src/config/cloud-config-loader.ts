/**
 * Cloud Configuration Loader
 *
 * Loads API key from global ~/.sqlew.env file.
 * Loads project ID from .sqlew/config.toml [project].name.
 * Supports environment variable override for CI/CD environments.
 *
 * @since v5.0.0
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parse as parseTOML } from 'smol-toml';
import { CLOUD_ENV_VARS, type CloudConfig, type ProjectConfig } from './types.js';
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
 * Load project name from .sqlew/config.toml [project].name
 *
 * @param projectRoot - Project root directory (optional)
 * @returns Project name or undefined
 */
export function loadProjectName(projectRoot?: string): string | undefined {
  const root = projectRoot ?? getProjectRoot();
  const configPath = path.join(root, '.sqlew', 'config.toml');

  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      const parsed = parseTOML(content) as { project?: ProjectConfig };
      return parsed.project?.name;
    }
  } catch {
    // File read or parse error, return undefined
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
 * It loads API key from ~/.sqlew.env and project name from .sqlew/config.toml.
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

  const projectName = loadProjectName(projectRoot);
  const connectionIdentity = createConnectionIdentity(apiKey, projectName, projectRoot);

  return {
    apiKey,
    projectName,
    connectionIdentity,
  };
}

/**
 * Check if global .sqlew.env file exists
 */
export function hasGlobalEnvFile(): boolean {
  return fs.existsSync(getGlobalEnvPath());
}

// ============================================================================
// Project ID Cache (v5.0.0+)
// ============================================================================

/**
 * Convert project name to env var key format
 * Replaces special characters with underscores
 */
function projectNameToEnvKey(projectName: string): string {
  // Replace non-alphanumeric (except - and _) with underscore
  const sanitized = projectName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `SQLEW_PROJECT_ID_${sanitized}`;
}

/**
 * Load cached project ID from ~/.sqlew.env
 *
 * Key format: SQLEW_PROJECT_ID_{project_name}
 *
 * @param projectName - Project name from config.toml
 * @returns Cached project UUID or null if not found
 */
export function loadCachedProjectId(projectName: string): string | null {
  const globalEnvPath = getGlobalEnvPath();
  const envKey = projectNameToEnvKey(projectName);

  try {
    if (fs.existsSync(globalEnvPath)) {
      const content = fs.readFileSync(globalEnvPath, 'utf-8');
      const parsed = parseEnvContent(content);
      return parsed[envKey] ?? null;
    }
  } catch {
    // File read error, return null
  }

  return null;
}

/**
 * Save project ID to ~/.sqlew.env
 *
 * Appends or updates the key SQLEW_PROJECT_ID_{project_name}
 *
 * @param projectName - Project name from config.toml
 * @param projectId - Resolved project UUID
 */
export function saveCachedProjectId(projectName: string, projectId: string): void {
  const globalEnvPath = getGlobalEnvPath();
  const envKey = projectNameToEnvKey(projectName);

  try {
    let content = '';
    let keyExists = false;

    // Read existing content
    if (fs.existsSync(globalEnvPath)) {
      content = fs.readFileSync(globalEnvPath, 'utf-8');

      // Check if key already exists and update it
      const lines = content.split('\n');
      const updatedLines = lines.map(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith(`${envKey}=`)) {
          keyExists = true;
          return `${envKey}=${projectId}`;
        }
        return line;
      });

      if (keyExists) {
        content = updatedLines.join('\n');
      }
    }

    // Append if key doesn't exist
    if (!keyExists) {
      // Ensure file ends with newline before appending
      if (content && !content.endsWith('\n')) {
        content += '\n';
      }
      content += `${envKey}=${projectId}\n`;
    }

    // Write back
    fs.writeFileSync(globalEnvPath, content, 'utf-8');
  } catch (error) {
    // Log but don't throw - caching failure shouldn't break the flow
    console.warn(`⚠️  Failed to cache project ID: ${error}`);
  }
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
