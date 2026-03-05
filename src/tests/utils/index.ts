/**
 * Test Helpers - Backward Compatibility Index
 *
 * Re-exports all functions from modular test helper files.
 * Allows existing test imports to work unchanged.
 *
 * Example usage (all work the same):
 * ```typescript
 * import { seedTestData } from './utils/test-helpers.js';
 * import { seedTestData } from './utils/db-seeding.js';
 * import { seedTestData } from './utils/index.js';
 * ```
 */

// Database configuration
export * from './db-config.js';

// Schema utilities
export * from './db-schema.js';

// Data seeding
export * from './db-seeding.js';

// SQL import
export * from './db-import.js';

// Test lifecycle
export * from './test-lifecycle.js';
