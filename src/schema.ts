/**
 * Schema verification module (v5.0)
 * Provides schema verification utilities using async Knex queries
 *
 * v5.0 Update: All tables now use m_ (master) / t_ (transaction) prefixes
 * v5.0 Update: Task and file management tables removed
 * v4.0 Update: v4_agents table removed (agent tracking eliminated)
 */

import { DatabaseAdapter } from './adapters/index.js';

/**
 * Check if schema is already initialized
 * Checks for existence of the m_projects table (v5 schema)
 *
 * @param adapter - Database adapter instance
 * @returns true if schema exists, false otherwise
 */
export async function isSchemaInitialized(adapter: DatabaseAdapter): Promise<boolean> {
  try {
    const knex = adapter.getKnex();
    return await knex.schema.hasTable('m_projects');
  } catch (error) {
    return false;
  }
}

/**
 * Get schema version information
 * Returns counts of all master tables to verify schema integrity
 *
 * @param adapter - Database adapter instance
 * @returns Object with table counts
 */
export async function getSchemaInfo(adapter: DatabaseAdapter): Promise<{
  context_keys: number;
  layers: number;
  tags: number;
  scopes: number;
  constraint_categories: number;
}> {
  const counts = {
    context_keys: 0,
    layers: 0,
    tags: 0,
    scopes: 0,
    constraint_categories: 0,
  };

  try {
    const knex = adapter.getKnex();

    const contextKeysResult = await knex('m_context_keys').count('* as count').first() as { count: number } | undefined;
    counts.context_keys = contextKeysResult?.count || 0;

    const layersResult = await knex('m_layers').count('* as count').first() as { count: number } | undefined;
    counts.layers = layersResult?.count || 0;

    const tagsResult = await knex('m_tags').count('* as count').first() as { count: number } | undefined;
    counts.tags = tagsResult?.count || 0;

    const scopesResult = await knex('m_scopes').count('* as count').first() as { count: number } | undefined;
    counts.scopes = scopesResult?.count || 0;

    const categoriesResult = await knex('m_constraint_categories').count('* as count').first() as { count: number } | undefined;
    counts.constraint_categories = categoriesResult?.count || 0;
  } catch (error) {
    // If tables don't exist yet, return zeros
  }

  return counts;
}

/**
 * Verify schema integrity
 * Checks that all required tables, indexes, views, and triggers exist
 *
 * @param adapter - Database adapter instance
 * @returns Object with integrity check results
 */
export async function verifySchemaIntegrity(adapter: DatabaseAdapter): Promise<{
  valid: boolean;
  missing: string[];
  errors: string[];
}> {
  const result = {
    valid: true,
    missing: [] as string[],
    errors: [] as string[],
  };

  // v5.0: All tables use m_ (master) / t_ (transaction) prefixes
  // v5.0: Task and file management tables removed
  // v5.0: Help system tables removed (help data now lives in src/help-data/*.toml)
  const requiredTables = [
    // Master tables (7)
    'm_projects', 'm_layers', 'm_context_keys', 'm_constraint_categories',
    'm_builtin_policies', 'm_tags', 'm_scopes',
    // Transaction tables (11)
    't_tag_index', 't_decisions', 't_decisions_numeric', 't_decision_history',
    't_decision_tags', 't_decision_scopes', 't_decision_context', 't_decision_policies',
    't_constraints', 't_constraint_tags', 't_token_usage',
  ];

  // v4.0: Views removed for cross-DB compatibility (replaced with application-level queries)
  const requiredViews: string[] = [];

  // v4.0: Triggers removed for cross-DB compatibility (replaced with application-level logic)
  const requiredTriggers: string[] = [];

  try {
    const knex = adapter.getKnex();

    // Check tables
    for (const table of requiredTables) {
      const exists = await knex.schema.hasTable(table);
      if (!exists) {
        result.valid = false;
        result.missing.push(`table:${table}`);
      }
    }

    // Check views - use raw query for SQLite, hasTable for others
    for (const view of requiredViews) {
      let exists = false;
      try {
        // Try hasTable first (works for some databases with views)
        exists = await knex.schema.hasTable(view);
      } catch {
        // Fall back to raw query for SQLite
        const viewResult = await knex.raw(
          "SELECT name FROM sqlite_master WHERE type='view' AND name=?",
          [view]
        ) as any;
        exists = viewResult && viewResult.length > 0 && viewResult[0];
      }

      if (!exists) {
        result.valid = false;
        result.missing.push(`view:${view}`);
      }
    }

    // Check triggers - SQLite-specific
    for (const trigger of requiredTriggers) {
      const triggerResult = await knex.raw(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND name=?",
        [trigger]
      ) as any;
      const exists = triggerResult && triggerResult.length > 0 && triggerResult[0];

      if (!exists) {
        result.valid = false;
        result.missing.push(`trigger:${trigger}`);
      }
    }

    // Verify standard data exists
    const layerResult = await knex('m_layers').count('* as count').first() as { count: number } | undefined;
    const layerCount = layerResult?.count || 0;
    if (layerCount < 9) {  // 9 layers (presentation, business, data, etc.)
      result.errors.push(`Expected 9 standard layers, found ${layerCount}`);
      result.valid = false;
    }

    const categoryResult = await knex('m_constraint_categories').count('* as count').first() as { count: number } | undefined;
    const categoryCount = categoryResult?.count || 0;
    if (categoryCount < 3) {
      result.errors.push(`Expected 3 standard categories, found ${categoryCount}`);
      result.valid = false;
    }

    const tagResult = await knex('m_tags').count('* as count').first() as { count: number } | undefined;
    const tagCount = tagResult?.count || 0;
    if (tagCount < 8) {  // 8 common development tags
      result.errors.push(`Expected 8 standard tags, found ${tagCount}`);
      result.valid = false;
    }

  } catch (error) {
    result.valid = false;
    result.errors.push(error instanceof Error ? error.message : String(error));
  }

  return result;
}
