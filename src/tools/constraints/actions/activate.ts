/**
 * Activate constraints (by tag or by ID)
 *
 * - activateConstraintsByTag: Bulk activate by tag (for plan-based workflow)
 * - activateConstraint: Single constraint by ID (MCP action)
 *
 * @since v4.2.1
 */

import { DatabaseAdapter } from '../../../adapters/index.js';
import { getAdapter } from '../../../database.js';
import { getProjectContext } from '../../../utils/project-context.js';
import { normalizeParams, CONSTRAINT_ALIASES } from '../../../utils/param-normalizer.js';
import connectionManager from '../../../utils/connection-manager.js';
import { SQLITE_TRUE } from '../../../constants.js';
import { scheduleSnapshotRefresh } from '../../../utils/session-snapshot.js';

/**
 * Activate constraints by tag response
 */
export interface ActivateConstraintsResponse {
  success: boolean;
  activated_count: number;
}

/**
 * Activate constraint by ID response
 */
export interface ActivateConstraintByIdResponse {
  success: boolean;
  id: number | string;
  message: string;
}

/**
 * Activate all constraints matching a specific tag
 *
 * Used by queue-watcher to activate constraints when implementation starts.
 * The tag typically contains the plan_id short form (8 chars).
 *
 * @param tag - Tag to match (e.g., plan_id short form)
 * @param adapter - Optional database adapter (for testing)
 * @returns Number of constraints activated
 */
export async function activateConstraintsByTag(
  tag: string,
  adapter?: DatabaseAdapter
): Promise<ActivateConstraintsResponse> {
  const actualAdapter = adapter ?? getAdapter();
  const knex = actualAdapter.getKnex();

  try {
    return await connectionManager.executeWithRetry(async () => {
      const projectId = getProjectContext().getProjectId();

      // Find constraints with matching tag that are inactive
      const constraintIds = await knex('t_constraints as c')
        .join('t_constraint_tags as ct', 'c.id', 'ct.constraint_id')
        .join('m_tags as t', 'ct.tag_id', 't.id')
        .where('c.project_id', projectId)
        .where('c.active', 0)
        .where('t.name', tag)
        .select('c.id')
        .then(rows => rows.map(r => r.id as number));

      if (constraintIds.length === 0) {
        return { success: true, activated_count: 0 };
      }

      // Activate all matching constraints
      await knex('t_constraints')
        .whereIn('id', constraintIds)
        .where('project_id', projectId)
        .update({ active: SQLITE_TRUE });

      scheduleSnapshotRefresh();
      return {
        success: true,
        activated_count: constraintIds.length,
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to activate constraints: ${message}`);
  }
}

/**
 * Activate a single constraint by ID
 *
 * @param params - Parameters containing constraint_id
 * @param adapter - Optional database adapter (for testing)
 * @returns Success response with constraint ID
 */
export async function activateConstraint(
  params: { id: number | string },
  adapter?: DatabaseAdapter
): Promise<ActivateConstraintByIdResponse> {
  const actualAdapter = adapter ?? getAdapter();
  const knex = actualAdapter.getKnex();

  // Normalize aliases: constraint_id → id (backward compatibility)
  const normalizedParams = normalizeParams(params, CONSTRAINT_ALIASES) as { id: number | string };

  try {
    return await connectionManager.executeWithRetry(async () => {
      const projectId = getProjectContext().getProjectId();

      // Check if constraint exists
      const constraint = await knex('t_constraints')
        .where('id', normalizedParams.id)
        .where('project_id', projectId)
        .first();

      if (!constraint) {
        throw new Error(`Constraint not found: ${normalizedParams.id}`);
      }

      if (constraint.active === 1) {
        return {
          success: true,
          id: normalizedParams.id,
          message: 'Constraint already active',
        };
      }

      // Activate the constraint
      await knex('t_constraints')
        .where('id', normalizedParams.id)
        .where('project_id', projectId)
        .update({ active: SQLITE_TRUE });

      scheduleSnapshotRefresh();
      return {
        success: true,
        id: normalizedParams.id,
        message: 'Constraint activated',
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to activate constraint: ${message}`);
  }
}
