/**
 * Mark Done Hook Command
 *
 * Marks plan decisions as "implemented" after merge/rebase.
 * Called by Git hooks (post-merge, post-rewrite) or manually.
 *
 * Usage:
 *   sqlew mark-done --auto    # Auto-detect from current plan
 *   sqlew mark-done <plan-id> # Specify plan ID explicitly
 *
 * Git Hooks Usage:
 *   .git/hooks/post-merge:    sqlew mark-done --auto
 *   .git/hooks/post-rewrite:  if [ "$1" = "rebase" ]; then sqlew mark-done --auto; fi
 *
 * @since v4.1.0
 * @modified v5.0.0 - Changed to queue-based processing (same as other hooks)
 */

import { loadCurrentPlan } from '../../config/global-config.js';
import { enqueueDecisionUpdate } from '../../utils/hook-queue.js';
import { determineProjectRoot } from '../../utils/project-root.js';

// ============================================================================
// Constants
// ============================================================================

/** Decision key prefix for plan-based decisions */
const PLAN_DECISION_PREFIX = 'plan/implementation';

/** Status for implemented decisions (using 'active' as DB only supports active/deprecated/draft) */
const IMPLEMENTED_STATUS = 'active' as const;

/** Workflow tag for implemented state */
const WORKFLOW_TAG_IMPLEMENTED = 'workflow:implemented';

// ============================================================================
// Command Implementation
// ============================================================================

/**
 * Parse command line arguments for mark-done
 *
 * @param args - Command line arguments
 * @returns Parsed options
 */
function parseMarkDoneArgs(args: string[]): { auto: boolean; planId?: string } {
  let auto = false;
  let planId: string | undefined;

  for (const arg of args) {
    if (arg === '--auto') {
      auto = true;
    } else if (!arg.startsWith('-')) {
      planId = arg;
    }
  }

  return { auto, planId };
}

/**
 * Main mark-done command entry point
 *
 * Called by Git hooks or manually to mark decisions as implemented.
 *
 * @param args - Command line arguments (optional, for CLI usage)
 */
export async function markDoneCommand(args: string[] = []): Promise<void> {
  try {
    const options = parseMarkDoneArgs(args);

    // Determine project root
    const projectPath = determineProjectRoot();

    // Load current plan if using --auto
    let planInfo = null;
    if (options.auto) {
      planInfo = loadCurrentPlan(projectPath);
      if (!planInfo) {
        // No plan being tracked - nothing to do
        console.log('[sqlew mark-done] No plan currently being tracked.');
        return;
      }

      if (!planInfo.recorded) {
        // Plan was never recorded as a decision
        console.log('[sqlew mark-done] No decision recorded for current plan.');
        return;
      }
    } else if (!options.planId) {
      console.error('[sqlew mark-done] Usage: sqlew mark-done --auto or sqlew mark-done <plan-id>');
      process.exit(1);
    }

    // Build decision key
    let decisionKey: string;
    let planIdTag: string;
    if (planInfo) {
      const planName = planInfo.plan_file.replace(/\.md$/, '');
      decisionKey = `${PLAN_DECISION_PREFIX}/${planName}`;
      planIdTag = planInfo.plan_id.slice(0, 8);
    } else {
      // Use provided plan ID
      decisionKey = `${PLAN_DECISION_PREFIX}/${options.planId}`;
      planIdTag = options.planId!.slice(0, 8);
    }

    // Enqueue decision status update (processed by MCP server's QueueWatcher)
    // This avoids direct DB access and ensures ProjectContext is properly initialized
    try {
      enqueueDecisionUpdate(projectPath, {
        key: decisionKey,
        value: planInfo
          ? `Implementation completed for plan: ${planInfo.plan_file}`
          : `Implementation completed for plan: ${options.planId}`,
        status: IMPLEMENTED_STATUS,
        layer: 'cross-cutting',
        tags: ['plan', 'implementation', WORKFLOW_TAG_IMPLEMENTED, planIdTag],
      });

      console.log(`[sqlew mark-done] Decision queued for update: ${decisionKey}`);
      console.log('[sqlew mark-done] Changes will be applied when MCP server processes the queue.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[sqlew mark-done] Error queuing decision update: ${message}`);
      process.exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[sqlew mark-done] Error: ${message}`);
    process.exit(1);
  }
}
