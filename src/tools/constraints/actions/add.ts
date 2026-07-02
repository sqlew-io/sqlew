/**
 * Add a constraint with priority, layer, and tags
 * Auto-registers category and agent if they don't exist
 */

import { DatabaseAdapter } from '../../../adapters/index.js';
import {
  getAdapter,
  getLayerId,
  getOrCreateTag,
  getOrCreateCategoryId
} from '../../../database.js';
import {
  STRING_TO_PRIORITY,
  DEFAULT_PRIORITY,
  SQLITE_TRUE,
  STANDARD_LAYERS
} from '../../../constants.js';
import { validateCategory, validatePriority } from '../../../utils/validators.js';
import { validateActionParams } from '../../../utils/parameter-validator.js';
import { normalizeParams, CONSTRAINT_ALIASES } from '../../../utils/param-normalizer.js';
import { parseStringArray } from '../../../utils/param-parser.js';
import { getProjectContext } from '../../../utils/project-context.js';
import { ftsInsertConstraint } from '../../../utils/fts.js';
import connectionManager from '../../../utils/connection-manager.js';
import type {
  AddConstraintParams,
  AddConstraintResponse
} from '../types.js';

/**
 * Add a constraint with priority, layer, and tags
 *
 * @param params - Constraint parameters
 * @param adapter - Optional database adapter (for testing)
 * @returns Constraint ID and timestamp
 */
export async function addConstraint(
  params: AddConstraintParams,
  adapter?: DatabaseAdapter
): Promise<AddConstraintResponse> {
  const actualAdapter = adapter ?? getAdapter();

  // Normalize aliases: text → constraint_text
  const normalizedParams = normalizeParams(params, CONSTRAINT_ALIASES) as AddConstraintParams;

  try {
    return await connectionManager.executeWithRetry(async () => {
      // Fail-fast project_id validation (Constraint #29)
      const projectId = getProjectContext().getProjectId();

      // Validate parameters
      validateActionParams('constraint', 'add', normalizedParams);

      // Validate category
      validateCategory(normalizedParams.category);

      // Validate priority if provided (accepts string or number)
      const priorityStr = validatePriority(normalizedParams.priority || 'medium');
      const priority = STRING_TO_PRIORITY[priorityStr] || DEFAULT_PRIORITY;

      // Validate and get layer ID if provided
      let layerId: number | null = null;
      if (normalizedParams.layer) {
        if (!STANDARD_LAYERS.includes(normalizedParams.layer as any)) {
          throw new Error(`Invalid layer. Must be one of: ${STANDARD_LAYERS.join(', ')}`);
        }
        layerId = await getLayerId(actualAdapter, normalizedParams.layer);
        if (!layerId) {
          throw new Error(`Layer not found: ${normalizedParams.layer}`);
        }
      }

      // Use transaction for multi-table insert
      const result = await actualAdapter.transaction(async (trx) => {
        // Get or create category
        const categoryId = await getOrCreateCategoryId(actualAdapter, normalizedParams.category, trx);

        // Duplicate check: skip if same text + category already exists
        const existing = await trx('t_constraints')
          .where({
            constraint_text: normalizedParams.constraint_text,
            category_id: categoryId,
            project_id: projectId
          })
          .first();
        if (existing) {
          return { constraintId: existing.id, alreadyExists: true };
        }

        // Note: Agent tracking removed in v4.0 (created_by param kept for API compatibility but not stored)

        // Calculate timestamp
        const ts = Math.floor(Date.now() / 1000);

        // Insert constraint with project_id (agent_id removed in v4.0)
        // v4.2.1: Support active parameter for plan-based workflow
        const activeValue = normalizedParams.active === false ? 0 : SQLITE_TRUE;
        const [constraintId] = await trx('t_constraints').insert({
          category_id: categoryId,
          layer_id: layerId,
          constraint_text: normalizedParams.constraint_text,
          reason: normalizedParams.reason ?? null,
          priority: priority,
          active: activeValue,
          ts: ts,
          project_id: projectId
        });

        // Keep the FTS search index in sync (SQLite only; failures are logged, never thrown)
        await ftsInsertConstraint(trx, {
          constraintId: Number(constraintId),
          projectId,
          constraintText: normalizedParams.constraint_text,
          reason: normalizedParams.reason ?? null,
        });

        // Insert m_tags if provided
        if (normalizedParams.tags && normalizedParams.tags.length > 0) {
          // Parse tags (handles both arrays and JSON strings from MCP)
          const tags = parseStringArray(normalizedParams.tags);
          for (const tagName of tags) {
            const tagId = await getOrCreateTag(actualAdapter, projectId, tagName, trx);  // v3.7.3: pass projectId
            await trx('t_constraint_tags').insert({
              constraint_id: Number(constraintId),
              tag_id: tagId
            });
          }
        }

        return { constraintId: Number(constraintId), alreadyExists: false };
      });

      return {
        success: true,
        constraint_id: result.constraintId,
        already_exists: result.alreadyExists,
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to add constraint: ${message}`);
  }
}
