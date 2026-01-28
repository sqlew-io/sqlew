/**
 * Connection Hash Generation Module
 *
 * Generates unique connection identifiers for SaaS mode.
 * Uses SHA256 to create deterministic hashes from connection parameters.
 *
 * @since v5.0.0
 */

import * as crypto from 'crypto';
import { normalizePathForHash } from './path-utils.js';

/**
 * Generate a unique connection hash from connection parameters.
 *
 * The hash uniquely identifies a connection based on:
 * - API key (who)
 * - Project ID (which project, optional)
 * - Full path (where, normalized)
 *
 * This allows the same user to have multiple connections
 * from different directories (e.g., git worktrees).
 *
 * @param apiKey - API key for authentication
 * @param projectId - Optional project ID
 * @param fullPath - Full path to the project directory
 * @returns SHA256 hash in Base64URL format (43 chars)
 *
 * @example
 * generateConnectionHash('sk_live_xxx', 'proj_123', 'C:\\Users\\dev\\my-app')
 * // => 'dGhpcyBpcyBhIHRlc3QgaGFzaA...'
 */
export function generateConnectionHash(
  apiKey: string,
  projectId: string | undefined,
  fullPath: string
): string {
  // Normalize the path for consistent hashing
  const normalizedPath = normalizePathForHash(fullPath);

  // Create hash input: apiKey + projectId + normalizedPath
  // Use pipe separator that won't appear in any of the values
  const hashInput = [apiKey, projectId ?? '', normalizedPath].join('|');

  // Generate SHA256 hash
  const hash = crypto.createHash('sha256').update(hashInput, 'utf-8').digest();

  // Convert to Base64URL format (URL-safe, no padding)
  return hash
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Generate a short connection hash for display purposes.
 *
 * @param fullHash - Full 43-character hash
 * @returns First 12 characters of the hash
 */
export function getShortConnectionHash(fullHash: string): string {
  return fullHash.slice(0, 12);
}
