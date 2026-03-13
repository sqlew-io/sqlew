/**
 * Path Normalization Utilities
 *
 * Cross-platform path normalization for Windows environments.
 * Handles Git Bash/MSYS2 path conversion and drive letter consistency.
 *
 * @since v5.2.0
 */

import { resolve } from 'path';

/**
 * Normalize a path for Windows cross-platform consistency.
 *
 * Performs:
 * 1. Git Bash/MSYS2 path conversion (/c/Users/... -> C:\Users\...)
 * 2. Absolute path resolution via resolve()
 * 3. Drive letter lowercase normalization
 *
 * On non-Windows platforms, only resolve() is applied.
 *
 * @param inputPath - Path to normalize
 * @returns Normalized absolute path
 */
export function normalizeWindowsPath(inputPath: string): string {
  let normalizedPath = inputPath;

  // Convert Git Bash/MSYS2 paths (/c/Users/...) to Windows paths (C:\Users\...)
  if (process.platform === 'win32' && /^\/[a-zA-Z]\//.test(normalizedPath)) {
    const driveLetter = normalizedPath[1].toUpperCase();
    normalizedPath = driveLetter + ':' + normalizedPath.slice(2).replace(/\//g, '\\');
  }

  // Resolve to absolute path
  normalizedPath = resolve(normalizedPath);

  // Lowercase drive letter for consistency
  if (process.platform === 'win32' && /^[A-Z]:/.test(normalizedPath)) {
    normalizedPath = normalizedPath[0].toLowerCase() + normalizedPath.slice(1);
  }

  return normalizedPath;
}
