/**
 * On-Subagent-Stop Hook Command
 *
 * SubagentStop hook - fires when any subagent (Plan, Explore, etc.) completes.
 * Delegates pattern extraction to plan-processor.ts for DRY.
 *
 * Usage:
 *   echo '{"hook_event_name": "SubagentStop"}' | sqlew on-subagent-stop
 *
 * @since v4.2.0
 * @modified v4.2.5 - Refactored to use plan-processor.ts (DRY)
 */

import { readStdinJson, sendContinue, sendPostToolUseContext, getProjectPath, type HookInput } from './stdin-parser.js';
import { loadCurrentPlan } from '../../config/global-config.js';
import { processPlanPatterns } from './plan-processor.js';

// ============================================================================
// Constants
// ============================================================================

/** Maximum age for plan cache to be considered valid (30 minutes in ms) */
const MAX_PLAN_CACHE_AGE_MS = 30 * 60 * 1000;

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Main on-subagent-stop command entry point
 *
 * Called as SubagentStop hook when any subagent completes.
 * Delegates pattern extraction to processPlanPatterns.
 */
export async function onSubagentStopCommand(): Promise<void> {
  try {
    const input = await readStdinJson();

    // Check stop_hook_active to prevent infinite loops
    if (isStopHookActive(input)) {
      sendContinue();
      return;
    }

    const projectPath = getProjectPath(input);
    if (!projectPath) {
      sendContinue();
      return;
    }

    // Check if there's a current plan with pending decision
    const planInfo = loadCurrentPlan(projectPath);
    if (!planInfo || !planInfo.decision_pending) {
      sendContinue();
      return;
    }

    // Check if plan cache is stale (older than 30 minutes)
    if (isPlanCacheStale(planInfo)) {
      sendContinue();
      return;
    }

    // Delegate to shared processor (handles recorded check internally)
    const result = processPlanPatterns(projectPath);

    if (result.processed && result.confirmationMessage) {
      sendPostToolUseContext(result.confirmationMessage, input.client);
    } else {
      sendContinue();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[sqlew on-subagent-stop] Error: ${message}`);
    sendContinue();
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if stop hook is already active (infinite loop prevention)
 */
function isStopHookActive(input: HookInput): boolean {
  return input.stop_hook_active === true;
}

/**
 * Check if plan cache is stale (older than MAX_PLAN_CACHE_AGE_MS)
 */
function isPlanCacheStale(planInfo: { plan_updated_at?: string }): boolean {
  if (!planInfo.plan_updated_at) {
    return true;
  }

  try {
    const updatedAt = new Date(planInfo.plan_updated_at).getTime();
    const age = Date.now() - updatedAt;
    return age > MAX_PLAN_CACHE_AGE_MS;
  } catch {
    return true;
  }
}
