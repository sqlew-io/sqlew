/**
 * Check Completion Hook Command
 *
 * PostToolUse hook for TodoWrite tool - checks if all tasks are completed.
 * When all todos are completed, updates the decision status to "in_review".
 *
 * Usage:
 *   echo '{"tool_input": {"todos": [...]}}' | sqlew check-completion
 *
 * @since v4.1.0
 * @modified v5.0.0 - Changed to queue-based processing (same as other hooks)
 */

import { readStdinJson, sendContinue, areAllTodosCompleted, getProjectPath } from './stdin-parser.js';
import {
  loadCurrentPlan,
  loadPlanCache,
  savePlanCache,
  type PlanCache,
} from '../../config/global-config.js';
import { enqueueDecisionCreate, enqueueDecisionUpdate } from '../../utils/hook-queue.js';

// ============================================================================
// Constants
// ============================================================================

/** Decision key prefix for plan-based decisions */
const PLAN_DECISION_PREFIX = 'plan/implementation';

/** Status for in-review decisions (using 'active' as DB only supports active/deprecated/draft) */
const IN_REVIEW_STATUS = 'active' as const;

/** Workflow tag for in-review state */
const WORKFLOW_TAG_IN_REVIEW = 'workflow:in_review';

// ============================================================================
// TOML Decision/Constraint Processing (v4.2.0+)
// ============================================================================

/**
 * Format constraint candidates as a registration prompt
 *
 * @param cache - Plan TOML cache with constraint candidates
 * @returns Formatted prompt string with MCP command examples
 */
function formatConstraintPrompt(cache: PlanCache): string {
  if (cache.constraints.length === 0) {
    return '';
  }

  const lines: string[] = [
    '',
    '🎯 **Constraint Candidates Ready for Registration**',
    '',
    `Found ${cache.constraints.length} constraint candidate(s) from plan TOML:`,
    '',
  ];

  cache.constraints.forEach((c, i) => {
    const priority = c.priority || 'medium';
    lines.push(`${i + 1}. [${c.category}/${priority}] ${c.text}`);
    if (c.rationale) {
      lines.push(`   Rationale: ${c.rationale}`);
    }
  });

  lines.push('');
  lines.push('To register, use mcp__sqlew__constraint with action="add":');
  lines.push('```');

  // Show example for first constraint
  const first = cache.constraints[0];
  lines.push(`mcp__sqlew__constraint action="add" constraint_text="${first.text}" category="${first.category}" priority="${first.priority || 'medium'}"`);

  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

/**
 * Process TOML decisions and constraints from plan cache
 *
 * @param projectPath - Project root path
 * @param cache - Plan TOML cache
 * @returns Context message with results
 */
function processPlanCache(projectPath: string, cache: PlanCache): string {
  const messages: string[] = [];

  // Auto-register decisions (queued for MCP server processing)
  if (!cache.decisions_registered && cache.decisions.length > 0) {
    for (const d of cache.decisions) {
      enqueueDecisionCreate(projectPath, {
        key: d.key,
        value: d.value,
        status: d.status || 'active',
        layer: d.layer || 'cross-cutting',
        tags: d.tags || [],
      });
    }
    cache.decisions_registered = true;
    messages.push(`✅ Registered ${cache.decisions.length} decision(s) to queue`);
  }

  // Prompt for constraints (user decision required)
  if (!cache.constraints_prompted && cache.constraints.length > 0) {
    messages.push(formatConstraintPrompt(cache));
    cache.constraints_prompted = true;
  }

  // Save updated cache
  if (cache.decisions_registered || cache.constraints_prompted) {
    savePlanCache(projectPath, cache);
  }

  return messages.join('\n');
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Main check-completion command entry point
 *
 * Called as PostToolUse hook when TodoWrite tool completes.
 * Updates decision to in_review when all todos are completed.
 */
export async function checkCompletionCommand(): Promise<void> {
  try {
    const input = await readStdinJson();

    // Only process TodoWrite tool
    if (input.tool_name !== 'TodoWrite') {
      sendContinue();
      return;
    }

    // Check if all todos are completed
    if (!areAllTodosCompleted(input)) {
      // Not all completed - continue without action
      sendContinue();
      return;
    }

    const projectPath = getProjectPath(input);
    if (!projectPath) {
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

    // Only update if the decision was recorded
    if (!planInfo.recorded) {
      sendContinue();
      return;
    }

    // Build decision key from plan file name
    const planName = planInfo.plan_file.replace(/\.md$/, '');
    const decisionKey = `${PLAN_DECISION_PREFIX}/${planName}`;

    // Enqueue decision status update (processed by MCP server's QueueWatcher)
    // This avoids direct DB access and ensures ProjectContext is properly initialized
    try {
      enqueueDecisionUpdate(projectPath, {
        key: decisionKey,
        value: `All tasks completed for plan: ${planInfo.plan_file}`,
        status: IN_REVIEW_STATUS,
        layer: 'cross-cutting',
        tags: ['plan', 'implementation', WORKFLOW_TAG_IN_REVIEW, planInfo.plan_id.slice(0, 8)],
      });

      // Process TOML decisions and constraints (v4.2.0+)
      let tomlContext = '';
      const tomlCache = loadPlanCache(projectPath);
      if (tomlCache && tomlCache.plan_id === planInfo.plan_id) {
        tomlContext = processPlanCache(projectPath, tomlCache);
      }

      const baseMessage = `[sqlew] All tasks completed! Decision queued for update to status: ${IN_REVIEW_STATUS}`;
      sendContinue(tomlContext ? `${baseMessage}\n${tomlContext}` : baseMessage);
    } catch (error) {
      // Log error but continue
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[sqlew check-completion] Error queuing decision update: ${message}`);

      // Still process TOML even if decision queue failed
      const tomlCache = loadPlanCache(projectPath);
      if (tomlCache && tomlCache.plan_id === planInfo.plan_id) {
        const tomlContext = processPlanCache(projectPath, tomlCache);
        if (tomlContext) {
          sendContinue(tomlContext);
          return;
        }
      }
      sendContinue();
    }
  } catch (error) {
    // On error, log to stderr but continue execution
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[sqlew check-completion] Error: ${message}`);
    sendContinue();
  }
}
