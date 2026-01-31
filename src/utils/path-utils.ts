/**
 * Path Utilities Module
 *
 * Cross-platform path manipulation utilities for connection identification.
 *
 * @since v5.0.0
 */

import * as path from 'path';

/**
 * Extract the last two segments of a path for display purposes.
 *
 * This provides enough context to identify the project location
 * without exposing the full path (privacy consideration).
 *
 * @param fullPath - Full absolute path to the project
 * @returns Last two path segments joined with '/'
 *
 * @example
 * extractPathSuffix('C:\\Users\\kitayama\\RustroverProjects\\my-app')
 * // => 'RustroverProjects/my-app'
 *
 * @example
 * extractPathSuffix('/home/user/projects/my-app')
 * // => 'projects/my-app'
 *
 * @example
 * extractPathSuffix('/single')
 * // => 'single'
 */
export function extractPathSuffix(fullPath: string): string {
  // Normalize to forward slashes for consistent output
  const normalized = fullPath.replace(/\\/g, '/');

  // Remove trailing slash if present
  const trimmed = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;

  // Split by forward slash
  const segments = trimmed.split('/').filter(Boolean);

  if (segments.length === 0) {
    return '';
  }

  if (segments.length === 1) {
    return segments[0];
  }

  // Return last two segments
  return segments.slice(-2).join('/');
}

/**
 * Normalize a path for consistent hash generation.
 *
 * This ensures the same logical path produces the same hash
 * regardless of OS or path format variations.
 *
 * @param inputPath - Path to normalize
 * @returns Normalized path with forward slashes, lowercase, no trailing slash
 */
export function normalizePathForHash(inputPath: string): string {
  // Convert backslashes to forward slashes
  let normalized = inputPath.replace(/\\/g, '/');

  // Remove trailing slash
  if (normalized.endsWith('/') && normalized.length > 1) {
    normalized = normalized.slice(0, -1);
  }

  // Convert to lowercase for case-insensitive comparison
  // (Windows paths are case-insensitive)
  normalized = normalized.toLowerCase();

  return normalized;
}

/**
 * Get the project root directory from the current working directory.
 *
 * @returns Absolute path to the project root
 */
export function getProjectRoot(): string {
  return process.cwd();
}
