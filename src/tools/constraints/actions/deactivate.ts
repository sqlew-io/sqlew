/**
 * Deactivate a constraint (soft delete)
 * Idempotent - deactivating already-inactive constraint is safe
 */

import { DatabaseAdapter } from '../../../adapters/index.js';
import { getAdapter } from '../../../database.js';
import { validateActionParams } from '../../../utils/parameter-validator.js';
import { normalizeParams, CONSTRAINT_ALIASES } from '../../../utils/param-normalizer.js';
import { getProjectContext } from '../../../utils/project-context.js';
import connectionManager from '../../../utils/connection-manager.js';
import { SQLITE_FALSE } from '../../../constants.js';
import { scheduleSnapshotRefresh } from '../../../utils/session-snapshot.js';
import type {
  DeactivateConstraintParams,
  DeactivateConstraintResponse
} from '../types.js';

/**
 * Deactivate a constraint (soft delete)
 * Idempotent - deactivating already-inactive constraint is safe
 *
 * @param params - Constraint ID to deactivate
 * @param adapter - Optional database adapter (for testing)
 * @returns Success status
 */
export async function deactivateConstraint(
  params: DeactivateConstraintParams,
  adapter?: DatabaseAdapter
): Promise<DeactivateConstraintResponse> {
  const actualAdapter = adapter ?? getAdapter();
  const knex = actualAdapter.getKnex();

  // Normalize aliases: constraint_id → id (backward compatibility)
  const normalizedParams = normalizeParams(params, CONSTRAINT_ALIASES) as DeactivateConstraintParams;

  try {
    return await connectionManager.executeWithRetry(async () => {
      // Fail-fast project_id validation (Constraint #29)
      const projectId = getProjectContext().getProjectId();

      // Validate parameters
      validateActionParams('constraint', 'deactivate', normalizedParams);

      // Check if constraint exists in current project
      const constraint = await knex('t_constraints')
        .where({ id: normalizedParams.id, project_id: projectId })
        .select('id', 'active')
        .first() as { id: number; active: number } | undefined;

      if (!constraint) {
        throw new Error(`Constraint not found: ${normalizedParams.id}`);
      }

      // Update constraint to inactive (idempotent) with project_id filter
      await knex('t_constraints')
        .where({ id: normalizedParams.id, project_id: projectId })
        .update({ active: SQLITE_FALSE });

      scheduleSnapshotRefresh();
      return {
        success: true,
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to deactivate constraint: ${message}`);
  }
}
