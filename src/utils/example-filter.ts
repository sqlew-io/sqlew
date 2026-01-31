/**
 * Example Filter Utility
 *
 * Environment-aware filtering for help examples.
 * Filters examples based on current backend type (sqlite/cloud).
 *
 * v5.0.1: Added for SaaS/SQLite example differentiation
 */

import { getBackendType } from '../backend/backend-factory.js';
import type { HelpExample, ExampleTargetType } from '../help-loader.js';

/**
 * Check if backend is in cloud (SaaS) mode
 */
export function isCloudEnvironment(): boolean {
  return getBackendType() === 'saas';
}

/**
 * Check if an example should be shown in the current environment
 *
 * @param targetType - Example's target_type attribute
 * @returns true if the example should be shown
 */
export function shouldShowExample(targetType?: ExampleTargetType): boolean {
  if (!targetType || targetType === 'all') return true;

  const isCloud = isCloudEnvironment();
  if (targetType === 'cloud') return isCloud;
  if (targetType === 'sqlite') return !isCloud;

  return true;
}

/**
 * Filter examples based on current backend environment
 *
 * - target_type undefined or 'all': always shown
 * - target_type 'cloud': shown only in saas mode
 * - target_type 'sqlite': shown only in non-saas mode
 *
 * @param examples - Array of HelpExample objects
 * @returns Filtered examples for current environment
 */
export function filterExamplesByEnvironment<T extends { target_type?: ExampleTargetType }>(
  examples: T[]
): T[] {
  return examples.filter(ex => shouldShowExample(ex.target_type));
}
