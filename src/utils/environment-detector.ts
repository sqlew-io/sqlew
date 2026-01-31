/**
 * Environment Detection Module
 *
 * Detects the execution environment for connection identification.
 * Priority: Container > WSL > OS
 *
 * @since v5.0.0
 */

import * as fs from 'fs';

/**
 * Detected environment types
 */
export type Environment =
  | 'windows'
  | 'macos'
  | 'linux'
  | 'wsl'
  | 'docker'
  | 'unknown';

/**
 * Detect current execution environment
 *
 * Detection priority:
 * 1. Docker container (/.dockerenv exists)
 * 2. WSL (/proc/version contains 'microsoft' or 'WSL')
 * 3. Windows (process.platform === 'win32')
 * 4. macOS (process.platform === 'darwin')
 * 5. Linux (process.platform === 'linux', after WSL exclusion)
 *
 * @returns Detected environment type
 */
export function detectEnvironment(): Environment {
  // Priority 1: Docker container
  if (isDocker()) {
    return 'docker';
  }

  // Priority 2: WSL (before Linux check)
  if (isWSL()) {
    return 'wsl';
  }

  // Priority 3-5: OS detection
  const platform = process.platform;

  switch (platform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'macos';
    case 'linux':
      return 'linux';
    default:
      return 'unknown';
  }
}

/**
 * Check if running inside Docker container
 */
function isDocker(): boolean {
  // Docker creates /.dockerenv in every container
  try {
    return fs.existsSync('/.dockerenv');
  } catch {
    return false;
  }
}

/**
 * Check if running inside WSL (Windows Subsystem for Linux)
 */
function isWSL(): boolean {
  // WSL detection only applies on Linux platform
  if (process.platform !== 'linux') {
    return false;
  }

  try {
    const procVersion = fs.readFileSync('/proc/version', 'utf-8').toLowerCase();
    return procVersion.includes('microsoft') || procVersion.includes('wsl');
  } catch {
    return false;
  }
}

/**
 * Get human-readable environment display name
 */
export function getEnvironmentDisplayName(env: Environment): string {
  const displayNames: Record<Environment, string> = {
    windows: 'Windows',
    macos: 'macOS',
    linux: 'Linux',
    wsl: 'WSL',
    docker: 'Docker',
    unknown: 'Unknown',
  };
  return displayNames[env];
}
