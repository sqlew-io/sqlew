/**
 * Project name detection utility
 *
 * Extracts project detection logic from index.ts for reuse in:
 * - Migrations (sync version)
 * - Index.ts / server setup (async version with VCS support)
 * - Tests
 *
 * Detection Priority (async / runtime):
 * 1. SQLEW_PROJECT_NAME (env)
 * 2. Git remote URL basename (best-effort; e.g. github.com/sqlew-io/sqlew → "sqlew")
 * 3. config.toml [project] name
 * 4. Directory name (fallback)
 *
 * Sync (migrations): env → config → directory (skips VCS; no async git).
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { parse as parseTOML } from 'smol-toml';
import type { SqlewConfig } from '../config/types.js';
import { DEFAULT_CONFIG_PATH } from '../config/loader.js';
import { readEnvProjectName } from '../config/env-overrides.js';
import { detectVCS } from './vcs-adapter.js';

/**
 * Detection result with source attribution
 */
export interface DetectedProject {
  name: string;
  source: 'env' | 'config' | 'git' | 'directory';
}

/** Map detector source to m_projects.detection_source (no separate 'env' value). */
export function toDbDetectionSource(
  source: DetectedProject['source']
): 'cli' | 'config' | 'git' | 'directory' {
  return source === 'env' ? 'cli' : source;
}

/**
 * Detect project name (async version with VCS support)
 *
 * Use this in index.ts and other runtime code where async operations are available.
 *
 * Priority: SQLEW_PROJECT_NAME → git remote basename → config.toml → directory.
 * Git string: last path segment of origin URL (SSH or HTTPS), without `.git`
 * (e.g. `git@github.com:sqlew-io/sqlew.git` → `sqlew`). Full `owner/repo` is
 * not used — only the repo basename is stable across URL forms today.
 *
 * @param projectRoot - Project root directory
 * @param configPath - Optional path to config.toml (defaults to .sqlew/config.toml)
 * @returns Project name and detection source
 */
export async function detectProjectName(
  projectRoot: string,
  configPath?: string
): Promise<DetectedProject> {
  // Priority 1: Environment override
  const fromEnv = readEnvProjectName();
  if (fromEnv) {
    return { name: fromEnv, source: 'env' };
  }

  // Priority 2: VCS / git remote (async)
  const fromVCS = await detectFromVCS(projectRoot);
  if (fromVCS) {
    return fromVCS;
  }

  // Priority 3: config.toml
  const fromConfig = detectFromConfig(projectRoot, configPath);
  if (fromConfig) {
    return fromConfig;
  }

  // Priority 4: Directory name
  return detectFromDirectory(projectRoot);
}

/**
 * Resolve a configured project name without directory fallback.
 *
 * Same priority as async detect (env → git → config), but returns undefined
 * when none of those sources yield a name. Used by SaaS / cloud-config paths
 * that should not invent a directory-based identity.
 *
 * @param projectRoot - Project root directory
 * @param configPath - Optional path to config.toml
 */
export async function resolveConfiguredProjectName(
  projectRoot: string,
  configPath?: string
): Promise<DetectedProject | undefined> {
  const fromEnv = readEnvProjectName();
  if (fromEnv) {
    return { name: fromEnv, source: 'env' };
  }

  const fromVCS = await detectFromVCS(projectRoot);
  if (fromVCS) {
    return fromVCS;
  }

  const fromConfig = detectFromConfig(projectRoot, configPath);
  if (fromConfig) {
    return fromConfig;
  }

  return undefined;
}

/**
 * Detect project name (sync version without VCS support)
 *
 * Use this in migrations where async operations are not available.
 * Detection order: env → config → directory (skips VCS)
 *
 * @param projectRoot - Project root directory
 * @param configPath - Optional path to config.toml (defaults to .sqlew/config.toml)
 * @returns Project name and detection source
 */
export function detectProjectNameSync(
  projectRoot: string,
  configPath?: string
): DetectedProject {
  // Priority 1: Environment override
  const fromEnv = readEnvProjectName();
  if (fromEnv) {
    return { name: fromEnv, source: 'env' };
  }

  // Priority 2: config.toml (sync cannot call git)
  const fromConfig = detectFromConfig(projectRoot, configPath);
  if (fromConfig) {
    return fromConfig;
  }

  // Priority 3: Directory name
  return detectFromDirectory(projectRoot);
}

/**
 * Try to detect project name from config.toml
 *
 * @param projectRoot - Project root directory
 * @param configPath - Optional path to config.toml
 * @returns Project name or null if not found
 */
function detectFromConfig(
  projectRoot: string,
  configPath?: string
): DetectedProject | null {
  const finalPath = configPath || DEFAULT_CONFIG_PATH;
  const absolutePath = resolve(projectRoot, finalPath);

  if (!existsSync(absolutePath)) {
    return null;
  }

  try {
    const content = readFileSync(absolutePath, 'utf-8');
    const parsed = parseTOML(content) as SqlewConfig;

    if (parsed.project?.name && parsed.project.name.trim().length > 0) {
      return {
        name: parsed.project.name,
        source: 'config',
      };
    }
  } catch {
    // Parse error - skip config source
  }

  return null;
}

/**
 * Try to detect project name from VCS (async)
 *
 * @param projectRoot - Project root directory
 * @returns Project name or null if not found
 */
async function detectFromVCS(projectRoot: string): Promise<DetectedProject | null> {
  try {
    const vcsAdapter = await detectVCS(projectRoot);

    if (vcsAdapter) {
      const detectedName = await vcsAdapter.extractProjectName();

      if (detectedName) {
        return {
          name: detectedName,
          source: 'git',
        };
      }
    }
  } catch {
    // VCS detection failed - continue to fallback
  }

  return null;
}

/**
 * Detect project name from directory name (fallback)
 *
 * Skips hidden directories (starting with '.') like .sqlew, .git, etc.
 * This handles cases where --db-path points to ~/.sqlew/sqlew.db
 * and we want to use the parent directory name (e.g., 'kitayama').
 *
 * @param projectRoot - Project root directory
 * @returns Project name from directory
 */
function detectFromDirectory(projectRoot: string): DetectedProject {
  // Handle both Unix (/) and Windows (\) path separators
  // Normalize: replace backslashes with forward slashes for consistent cross-platform parsing
  const normalizedPath = projectRoot.replace(/\\/g, '/');
  const dirSegments = normalizedPath.split('/').filter(s => s.length > 0);

  // Find the first non-hidden directory name from the end
  // Skip directories starting with '.' (e.g., .sqlew, .git)
  for (let i = dirSegments.length - 1; i >= 0; i--) {
    const segment = dirSegments[i];
    if (segment && !segment.startsWith('.')) {
      return {
        name: segment,
        source: 'directory',
      };
    }
  }

  // Fallback to 'default' if all segments are hidden
  return {
    name: 'default',
    source: 'directory',
  };
}
