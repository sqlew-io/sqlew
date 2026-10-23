/**
 * Configuration file writer with atomic write support
 *
 * Satisfies constraints:
 * - #23 (CRITICAL): Write config.toml on first run if missing project_name
 * - #24: Persist detected name to config.toml (runtime still prefers env > git > config)
 * - #32 (HIGH): Atomic write using temp file + rename pattern
 * - #33 (HIGH): Preserve existing config sections during write
 */

import { writeFileSync, renameSync, existsSync, readFileSync, mkdirSync, unlinkSync } from 'fs';
import { dirname, resolve } from 'path';
import { parse as parseTOML, stringify as stringifyTOML } from 'smol-toml';
import type { SqlewConfig, ProjectConfig } from './types.js';
import { DEFAULT_CONFIG_PATH } from './loader.js';

/**
 * Check if config.toml has project.name field
 *
 * @param projectRoot - Project root directory
 * @param configPath - Path to config file (optional, defaults to .sqlew/config.toml)
 * @returns true if project.name exists, false otherwise
 *
 * Satisfies Constraint #23: Detection logic for missing project_name
 */
export function hasProjectName(projectRoot: string = process.cwd(), configPath?: string): boolean {
  const finalPath = configPath || DEFAULT_CONFIG_PATH;
  const absolutePath = resolve(projectRoot, finalPath);

  // Config file doesn't exist
  if (!existsSync(absolutePath)) {
    return false;
  }

  try {
    const content = readFileSync(absolutePath, 'utf-8');
    const parsed = parseTOML(content) as SqlewConfig;

    // Check if project.name exists and is non-empty
    return Boolean(parsed.project?.name && parsed.project.name.trim().length > 0);
  } catch {
    // Parse error or read error - treat as missing
    return false;
  }
}

/**
 * Write config.toml atomically with project name
 *
 * Atomic write pattern (Constraint #32):
 * 1. Write to temporary file (.sqlew/config.toml.tmp)
 * 2. Rename temporary file to final path (atomic operation)
 *
 * Preservation pattern (Constraint #33):
 * 1. Load existing config if file exists
 * 2. Merge with new project config
 * 3. Write complete merged config
 *
 * @param projectRoot - Project root directory
 * @param projectName - Project name to write
 * @param options - Optional display name and config path
 * @throws Error if write fails
 *
 * Satisfies Constraints:
 * - #23: Auto-write config.toml on first run
 * - #32: Atomic write (temp file + rename)
 * - #33: Preserve existing config sections
 */
export function writeProjectConfig(
  projectRoot: string,
  projectName: string,
  options?: {
    displayName?: string;
    configPath?: string;
  }
): void {
  const finalPath = options?.configPath || DEFAULT_CONFIG_PATH;
  const absolutePath = resolve(projectRoot, finalPath);
  const tempPath = `${absolutePath}.tmp`;
  const dirPath = dirname(absolutePath);

  // Ensure .sqlew directory exists
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }

  // Load existing config or start with defaults
  let config: SqlewConfig = {};

  if (existsSync(absolutePath)) {
    try {
      const content = readFileSync(absolutePath, 'utf-8');
      config = parseTOML(content) as SqlewConfig;
    } catch {
      // Parse error - start fresh but log warning
      // Note: Can't use console.* (Constraint #42)
      // In actual usage, this will be called from index.ts which has logger access
      config = {};
    }
  }

  // Add/update project section (Constraint #33: Preserve other sections)
  const projectConfig: ProjectConfig = {
    name: projectName,
  };

  if (options?.displayName) {
    projectConfig.display_name = options.displayName;
  }

  config.project = projectConfig;

  // Convert to TOML string
  const tomlContent = stringifyTOML(config);

  try {
    // Step 1: Write to temp file (Constraint #32)
    writeFileSync(tempPath, tomlContent, 'utf-8');

    // Step 2: Atomic rename (Constraint #32)
    renameSync(tempPath, absolutePath);
  } catch (error) {
    // Clean up temp file if rename failed
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    } catch {
      // Ignore cleanup errors
    }

    throw new Error(
      `Failed to write config.toml: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Ensure project.name exists in config.toml
 *
 * This function:
 * 1. Checks if project.name exists
 * 2. If missing, writes it to config.toml atomically
 * 3. Returns whether write was performed
 *
 * @param projectRoot - Project root directory
 * @param projectName - Project name to write if missing
 * @param options - Optional display name and config path
 * @returns true if config was written, false if already existed
 *
 * Satisfies Constraint #23: Detection + auto-write on first run
 */
export function ensureProjectConfig(
  projectRoot: string,
  projectName: string,
  options?: {
    displayName?: string;
    configPath?: string;
  }
): boolean {
  // Check if project.name already exists (Constraint #24)
  if (hasProjectName(projectRoot, options?.configPath)) {
    return false; // Already configured, no write needed
  }

  // Write project config atomically (Constraint #32)
  writeProjectConfig(projectRoot, projectName, options);

  return true; // Config was written
}
