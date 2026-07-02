/**
 * Permanently delete a decision and all related data (hard delete)
 * Unlike soft delete (status=deprecated), this removes all records from database
 *
 * WARNING: This operation is irreversible. Version history and all relationships
 * (tags, scopes) will also be deleted due to CASCADE constraints.
 */

import { DatabaseAdapter } from '../../../adapters/index.js';
import { getAdapter } from '../../../database.js';
import { getProjectContext } from '../../../utils/project-context.js';
import connectionManager from '../../../utils/connection-manager.js';
import { ftsDeleteDecision } from '../../../utils/fts.js';
import { scheduleSnapshotRefresh } from '../../../utils/session-snapshot.js';
import { validateActionParams } from '../internal/validation.js';
import type { HardDeleteDecisionParams, HardDeleteDecisionResponse } from '../types.js';

/**
 * Permanently delete a decision
 *
 * @param params - Decision key to delete
 * @param adapter - Optional database adapter (for testing)
 * @returns Response with success status
 */
export async function hardDeleteDecision(
  params: HardDeleteDecisionParams,
  adapter?: DatabaseAdapter
): Promise<HardDeleteDecisionResponse> {
  // Validate parameters
  validateActionParams('decision', 'hard_delete', params);

  const actualAdapter = adapter ?? getAdapter();
  const knex = actualAdapter.getKnex();

  // Validate project context (fail-fast)
  const projectId = getProjectContext().getProjectId();

  try {
    const result = await connectionManager.executeWithRetry(async () => {
      return await actualAdapter.transaction(async (trx) => {
        // Get key_id
        const keyResult = await trx('m_context_keys')
          .where({ key_name: params.key })
          .first('id') as { id: number } | undefined;

        if (!keyResult) {
          // Key doesn't exist - still return success (idempotent)
          return {
            success: true,
            key: params.key,
            message: `Decision "${params.key}" not found (already deleted or never existed)`
          };
        }

        const keyId = keyResult.id;

        // SECURITY: All deletes MUST filter by project_id to prevent cross-project deletion
        // Delete from t_decisions (if exists in this project)
        const deletedString = await trx('t_decisions')
          .where({ key_id: keyId, project_id: projectId })
          .delete();

        // Delete from t_decisions_numeric (if exists in this project)
        const deletedNumeric = await trx('t_decisions_numeric')
          .where({ key_id: keyId, project_id: projectId })
          .delete();

        // Delete from t_decision_history (for this project only)
        const deletedHistory = await trx('t_decision_history')
          .where({ key_id: keyId, project_id: projectId })
          .delete();

        // Delete from t_decision_tags (for this project only)
        const deletedTags = await trx('t_decision_tags')
          .where({ decision_key_id: keyId, project_id: projectId })
          .delete();

        // Delete from t_decision_scopes (for this project only)
        const deletedScopes = await trx('t_decision_scopes')
          .where({ decision_key_id: keyId, project_id: projectId })
          .delete();

        // Remove the FTS search index row (SQLite only; failures are logged, never thrown)
        await ftsDeleteDecision(trx, keyId, projectId);

        // Calculate total deleted records
        const totalDeleted = deletedString + deletedNumeric + deletedHistory + deletedTags + deletedScopes;

        if (totalDeleted === 0) {
          return {
            success: true,
            key: params.key,
            message: `Decision "${params.key}" not found (already deleted or never existed)`
          };
        }

        return {
          success: true,
          key: params.key,
          message: `Decision "${params.key}" permanently deleted (${totalDeleted} record${totalDeleted === 1 ? '' : 's'})`
        };
      });
    });
    scheduleSnapshotRefresh();
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to hard delete decision: ${message}`);
  }
}
