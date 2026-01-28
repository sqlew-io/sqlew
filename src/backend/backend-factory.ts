/**
 * Backend Factory
 *
 * Creates and manages backend instances based on configuration.
 * Supports LocalBackend (direct DB) and SaaS backend (submodule).
 */

import type { ToolBackend } from './types.js';
import type { SqlewConfig, CloudConfig } from '../config/types.js';
import { CLOUD_ENV_VARS } from '../config/types.js';
import { LocalBackend } from './local-backend.js';
import { TransformingBackend } from './transforming-backend.js';
import {
  createBackend as createSaaSBackend,
  resolveProject,
} from '@sqlew/saas-connector';
import { debugLog } from '../utils/debug-logger.js';
import {
  loadCloudConfigFromGlobal,
  checkEnvFilePermissions,
  loadCachedProjectId,
  saveCachedProjectId,
} from '../config/cloud-config-loader.js';

/**
 * Global backend instance (singleton)
 */
let globalBackend: ToolBackend | null = null;
let initialized = false;

/**
 * Check if the configuration specifies cloud mode
 */
export function isCloudMode(config: SqlewConfig): boolean {
  return config.database?.type === 'cloud';
}

/**
 * Load cloud configuration from global ~/.sqlew.env or environment variables
 *
 * Flow:
 * 1. Load API key from ~/.sqlew.env
 * 2. Load project name from .sqlew/config.toml
 * 3. Check cached project ID in ~/.sqlew.env
 * 4. If not cached, resolve via /api/v1/project/resolve and cache
 *
 * @param projectRoot - Project root directory (for ConnectionIdentity)
 * @returns CloudConfig or null if not configured
 */
export async function loadCloudConfig(projectRoot?: string): Promise<CloudConfig | null> {
  // Check file permissions (Unix: warn if not 600)
  const permCheck = checkEnvFilePermissions();
  if (!permCheck.ok) {
    console.warn(`⚠️  ${permCheck.message}`);
  }

  // Load base config (API key, project name, connection identity)
  const baseConfig = loadCloudConfigFromGlobal(projectRoot);
  if (!baseConfig) {
    return null;
  }

  // Resolve project ID if project name is set
  let projectId: string | undefined;
  if (baseConfig.projectName) {
    // 1. Check cache
    const cachedId = loadCachedProjectId(baseConfig.projectName);
    if (cachedId) {
      projectId = cachedId;
      debugLog('INFO', 'Using cached project ID', { projectName: baseConfig.projectName });
    } else {
      // 2. Resolve via API
      try {
        debugLog('INFO', 'Resolving project ID via API', { projectName: baseConfig.projectName });
        projectId = await resolveProject(baseConfig.apiKey, baseConfig.projectName);
        // 3. Cache for future use
        saveCachedProjectId(baseConfig.projectName, projectId);
        debugLog('INFO', 'Project ID resolved and cached', { projectName: baseConfig.projectName });
      } catch (error) {
        console.warn(`⚠️  Failed to resolve project ID: ${error instanceof Error ? error.message : String(error)}`);
        // Continue without projectId - some features may not work
      }
    }
  }

  return {
    ...baseConfig,
    projectId,
  };
}

/**
 * Validate cloud configuration
 */
export function validateCloudConfig(config: CloudConfig | null): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config) {
    errors.push(`${CLOUD_ENV_VARS.API_KEY} is required for cloud mode`);
    return { valid: false, errors };
  }

  if (!config.apiKey) {
    errors.push(`${CLOUD_ENV_VARS.API_KEY} is required for cloud mode`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Create a backend instance based on configuration
 *
 * @param config - sqlew configuration
 * @param projectRoot - Project root directory
 * @returns Backend instance
 */
export async function createBackend(config: SqlewConfig, projectRoot?: string): Promise<ToolBackend> {
  if (isCloudMode(config)) {
    // Load cloud config from environment (async: resolves project ID)
    const cloudConfig = await loadCloudConfig(projectRoot);
    const validation = validateCloudConfig(cloudConfig);

    if (!validation.valid) {
      throw new Error(validation.errors.join('; '));
    }

    // Create SaaS backend and wrap with TransformingBackend
    // TransformingBackend handles quick_set → set transformation locally
    try {
      const saasBackend = createSaaSBackend(cloudConfig!);
      return new TransformingBackend(saasBackend);
    } catch (error) {
      throw new Error(
        `SaaS connector initialization failed. Run: cd saas-connector && npm run build`
      );
    }
  }

  // Default: LocalBackend
  return new LocalBackend();
}

/**
 * Initialize the global backend instance
 *
 * @param config - sqlew configuration
 * @param projectRoot - Project root directory
 * @returns Backend instance
 */
export async function initializeBackend(config: SqlewConfig, projectRoot?: string): Promise<ToolBackend> {
  if (initialized && globalBackend) {
    return globalBackend;
  }

  globalBackend = await createBackend(config, projectRoot);
  initialized = true;

  const modeInfo = globalBackend.backendType === 'saas'
    ? `saas (${globalBackend.pluginName || 'saas-connector'})`
    : globalBackend.backendType;
  debugLog('INFO', 'Backend initialized', { type: modeInfo });

  return globalBackend;
}

/**
 * Get the current backend instance
 *
 * @returns Backend instance (creates LocalBackend if not initialized)
 */
export function getBackend(): ToolBackend {
  if (!globalBackend) {
    console.error('⚠️  Backend not initialized, using default LocalBackend');
    globalBackend = new LocalBackend();
  }
  return globalBackend;
}

/**
 * Check if backend is initialized
 */
export function isBackendInitialized(): boolean {
  return initialized;
}

/**
 * Get current backend type
 */
export function getBackendType(): 'local' | 'saas' | null {
  return globalBackend?.backendType ?? null;
}

/**
 * Reset backend state (for testing)
 */
export async function resetBackend(): Promise<void> {
  if (globalBackend) {
    await globalBackend.disconnect();
    globalBackend = null;
  }
  initialized = false;
}
