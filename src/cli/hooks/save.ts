/**
 * Save Hook Command
 *
 * PostToolUse hook for Edit|Write - promotes decisions/constraints when implementation starts.
 * When non-markdown files are modified, promotes draft decisions to in_progress
 * and activates inactive constraints.
 *
 * Usage:
 *   echo '{"tool_name": "Write", "tool_input": {"file_path": "src/foo.ts"}}' | sqlew save
 *
 * @since v4.1.0
 * @updated v4.2.1 - Changed to detect implementation files (NOT *.md) and promote decisions/constraints
 */

import { readStdinJson, sendContinue, getProjectPath } from './stdin-parser.js';
import { loadCurrentPlan, saveCurrentPlan, type CurrentPlanInfo } from '../../config/global-config.js';
import { enqueueDecisionUpdate, enqueueConstraintActivate } from '../../utils/hook-queue.js';

// ============================================================================
// Constants
// ============================================================================

/** Status for in-progress decisions */
const IN_PROGRESS_STATUS = 'in_progress' as const;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if a file path is an implementation file (not a markdown or plan file)
 */
function isImplementationFile(filePath: string | undefined): boolean {
  if (!filePath) return false;

  const normalized = filePath.replace(/\\/g, '/').toLowerCase();

  // Exclude markdown files
  if (normalized.endsWith('.md')) return false;

  // Exclude plan files explicitly
  if (normalized.includes('.claude/plans/') || normalized.includes('.hermes/plans/') || normalized.includes('.sqlew/plans/')) return false;

  // Exclude documentation directories
  if (normalized.includes('/docs/')) return false;

  // Exclude config files that aren't really implementation
  if (normalized.endsWith('.json') && !normalized.includes('/src/')) return false;

  return true;
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Main save command entry point
 *
 * Called as PostToolUse hook when Edit|Write completes.
 * When implementation files are modified, promotes decisions and activates constraints.
 */
export async function saveCommand(): Promise<void> {
  try {
    const input = await readStdinJson();

    // Only process Edit and Write tools
    const toolName = input.tool_name;
    if (toolName !== 'Edit' && toolName !== 'Write') {
      sendContinue();
      return;
    }

    const projectPath = getProjectPath(input);
    if (!projectPath) {
      sendContinue();
      return;
    }

    // Get file path from tool input
    const filePath = input.tool_input?.file_path as string | undefined;

    // Only process implementation files
    if (!isImplementationFile(filePath)) {
      sendContinue();
      return;
    }

    // Check if there's a current plan being tracked
    const planInfo = loadCurrentPlan(projectPath);
    if (!planInfo) {
      // No plan being tracked - continue without action
      sendContinue();
      return;
    }

    // Check if already recorded for this plan
    if (planInfo.recorded) {
      // Already recorded - no need to record again
      sendContinue();
      return;
    }

    // Enqueue decision status update: draft → in_progress
    // This will update all decisions with the plan_id tag
    enqueueDecisionUpdate(projectPath, {
      key: `plan/${planInfo.plan_file.replace(/\.md$/, '')}`,
      status: IN_PROGRESS_STATUS,
      tags: ['plan', planInfo.plan_id.slice(0, 8)],
    });

    // Enqueue constraint activation: active=0 → active=1
    enqueueConstraintActivate(projectPath, planInfo.plan_id);

    // Mark plan as recorded (implementation started)
    const updatedInfo: CurrentPlanInfo = {
      ...planInfo,
      recorded: true,
      decision_pending: false,
      plan_updated_at: new Date().toISOString(),
    };
    saveCurrentPlan(projectPath, updatedInfo);

    sendContinue(
      `[sqlew] Implementation started for plan: ${planInfo.plan_file} | ` +
      `Queued: decisions → in_progress, constraints → active`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[sqlew save] Error: ${message}`);
    sendContinue();
  }
}
