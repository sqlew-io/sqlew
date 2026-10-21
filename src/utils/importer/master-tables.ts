/**
 * Master Table Import with Smart Merge
 *
 * Handles importing master tables with intelligent ID remapping:
 * - Project-scoped tables (m_tags, m_scopes): Smart merge on UNIQUE (project_id, name)
 * - Global tables (m_context_keys, etc.): Always create new IDs
 *
 * Note: Agent system removed in v4.0 - no agent imports
 * Note: Files, task_statuses removed in v5.0
 *
 * Architectural Decision: Decision #253 - Smart merge for project-scoped master tables
 */

import type { ImportContext } from '../../types.js';
import { insertReturningId } from '../insert-returning-id.js';

/**
 * Import master tables and build ID mappings
 *
 * @param ctx - Import context with target project ID
 * @returns Updated context with ID mappings populated
 */
export async function importMasterTables(ctx: ImportContext): Promise<ImportContext> {
  console.error('  Importing master tables...');

  // Import order: no dependencies between master tables
  // Note: importAgents removed in v4.0 (agent system deleted)
  // Note: importFiles, importTaskStatuses removed in v5.0
  await importContextKeys(ctx);
  await importTags(ctx);
  await importScopes(ctx);
  await importConstraintCategories(ctx);
  await importLayers(ctx);

  console.error(`  ✓ Master tables imported (${getTotalMappings(ctx)} ID mappings created)`);
  return ctx;
}

/**
 * Import m_context_keys (global, reuse if key_name matches)
 *
 * UPDATED v5.0: Context keys are global (not project-scoped), so we should
 * reuse existing keys if key_name matches to avoid UNIQUE constraint violations.
 * This allows importing to the same DB (e.g., project cloning).
 */
async function importContextKeys(ctx: ImportContext): Promise<void> {
  const keys = ctx.jsonData.master_tables.context_keys || [];
  let created = 0;
  let reused = 0;

  for (const key of keys) {
    // Check if context key already exists (global table)
    const existing = await ctx.knex('m_context_keys')
      .where({ key_name: key.key })
      .first();

    if (existing) {
      // Reuse existing ID
      ctx.mappings.context_keys.set(key.id, existing.id);
      reused++;
    } else {
      // Create new context key
      const newId = await insertReturningId(ctx.knex, 'm_context_keys', {
        key_name: key.key
      });
      ctx.mappings.context_keys.set(key.id, newId);
      created++;
    }
  }

  ctx.stats.master_tables.context_keys_created = created;
}

/**
 * Import m_tags (project-scoped, smart merge)
 */
async function importTags(ctx: ImportContext): Promise<void> {
  const tags = ctx.jsonData.master_tables.tags || [];
  let created = 0;
  let reused = 0;

  for (const tag of tags) {
    // Check if tag already exists in target project
    const existing = await ctx.knex('m_tags')
      .where({
        project_id: ctx.projectId,
        name: tag.name
      })
      .first();

    if (existing) {
      // Reuse existing ID
      ctx.mappings.tags.set(tag.id, existing.id);
      reused++;
    } else {
      // Create new tag entry
      const newId = await insertReturningId(ctx.knex, 'm_tags', {
        project_id: ctx.projectId,
        name: tag.name
      });

      ctx.mappings.tags.set(tag.id, newId);
      created++;
    }
  }

  ctx.stats.master_tables.tags_created = created;
  ctx.stats.master_tables.tags_reused = reused;
}

/**
 * Import m_scopes (project-scoped, smart merge)
 */
async function importScopes(ctx: ImportContext): Promise<void> {
  const scopes = ctx.jsonData.master_tables.scopes || [];
  let created = 0;
  let reused = 0;

  for (const scope of scopes) {
    // Check if scope already exists in target project
    const existing = await ctx.knex('m_scopes')
      .where({
        project_id: ctx.projectId,
        name: scope.name
      })
      .first();

    if (existing) {
      // Reuse existing ID
      ctx.mappings.scopes.set(scope.id, existing.id);
      reused++;
    } else {
      // Create new scope entry
      const newId = await insertReturningId(ctx.knex, 'm_scopes', {
        project_id: ctx.projectId,
        name: scope.name
      });

      ctx.mappings.scopes.set(scope.id, newId);
      created++;
    }
  }

  ctx.stats.master_tables.scopes_created = created;
  ctx.stats.master_tables.scopes_reused = reused;
}

/**
 * Import m_constraint_categories (global, create or reuse by name)
 */
async function importConstraintCategories(ctx: ImportContext): Promise<void> {
  const categories = ctx.jsonData.master_tables.constraint_categories || [];

  for (const category of categories) {
    // Check if category exists by name (global lookup)
    const existing = await ctx.knex('m_constraint_categories')
      .where({ name: category.name })
      .first();

    if (existing) {
      // Reuse existing global category
      ctx.mappings.constraint_categories.set(category.id, existing.id);
    } else {
      // Create new category
      const newId = await insertReturningId(ctx.knex, 'm_constraint_categories', {
        name: category.name
      });

      ctx.mappings.constraint_categories.set(category.id, newId);
    }
  }
}

/**
 * Import m_layers (global, create or reuse by name)
 */
async function importLayers(ctx: ImportContext): Promise<void> {
  const layers = ctx.jsonData.master_tables.layers || [];

  for (const layer of layers) {
    // Check if layer exists by name (global lookup)
    const existing = await ctx.knex('m_layers')
      .where({ name: layer.name })
      .first();

    if (existing) {
      // Reuse existing global layer
      ctx.mappings.layers.set(layer.id, existing.id);
    } else {
      // Create new layer
      const newId = await insertReturningId(ctx.knex, 'm_layers', {
        name: layer.name
      });

      ctx.mappings.layers.set(layer.id, newId);
    }
  }
}

/**
 * Get total number of ID mappings created
 * Note: agents removed in v4.0, files/task_statuses removed in v5.0
 */
function getTotalMappings(ctx: ImportContext): number {
  return (
    ctx.mappings.context_keys.size +
    ctx.mappings.tags.size +
    ctx.mappings.scopes.size +
    ctx.mappings.constraint_categories.size +
    ctx.mappings.layers.size
  );
}
