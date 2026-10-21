/**
 * On-Stop Hook Command
 *
 * Stop hook - fires when main agent response completes.
 * Always flushes `.sqlew/queue/pending.json` to DB (Cloud / no QueueWatcher).
 * When a plan is tracked, also processes TOML decisions/constraints.
 *
 * Usage:
 *   echo '{"hook_event_name": "Stop"}' | sqlew on-stop
 *
 * @since v4.2.0
 * @updated v5.4.x - Always flush pending queue (upsert-by-key)
 */

import { readStdinJson, sendContinue, getProjectPath, type HookInput } from './stdin-parser.js';
import {
  loadCurrentPlan,
  loadPlanCache,
  savePlanCache,
  type PlanCache,
} from '../../config/global-config.js';
import { enqueueDecisionCreate } from '../../utils/hook-queue.js';
import { flushPendingQueue } from './flush-queue.js';

// ============================================================================
// TOML Decision/Constraint Processing
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
 * Main on-stop command entry point
 *
 * Called as Stop hook when main agent response completes.
 * Always attempts to flush the pending queue to DB, then processes
 * plan TOML cache when a recorded plan is tracked.
 */
export async function onStopCommand(): Promise<void> {
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

    // Always flush pending queue (Cloud without QueueWatcher; also safe with watcher —
    // file lock skips if another process is already draining).
    // Plan TOML may enqueue more items first when recorded — flush after that.
    let flushNote = '';

    // Check if there's a current plan being tracked
    const planInfo = loadCurrentPlan(projectPath);
    const messages: string[] = [];

    if (planInfo?.recorded) {
      const tomlCache = loadPlanCache(projectPath);
      if (tomlCache && tomlCache.plan_id === planInfo.plan_id) {
        const tomlContext = processPlanCache(projectPath, tomlCache);
        if (tomlContext) {
          messages.push(tomlContext);
        }
      }
    }

    try {
      const flush = await flushPendingQueue({
        projectPath,
        shutdown: true,
      });
      if (flush.processed > 0) {
        flushNote = `[sqlew] Flushed ${flush.processed} queued item(s) to DB`;
        messages.push(flushNote);
      }
    } catch (flushError) {
      const msg = flushError instanceof Error ? flushError.message : String(flushError);
      console.error(`[sqlew on-stop] flush-queue error: ${msg}`);
      // Fail-open: continue even if flush fails
    }

    if (messages.length > 0) {
      sendContinue(messages.join('\n'));
      return;
    }

    sendContinue();
  } catch (error) {
    // On error, log to stderr but continue execution
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[sqlew on-stop] Error: ${message}`);
    sendContinue();
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if stop hook is already active (infinite loop prevention)
 *
 * @param input - Hook input
 * @returns true if stop hook is already active
 */
function isStopHookActive(input: HookInput): boolean {
  // stop_hook_active is set by Claude Code when a Stop/SubagentStop hook
  // is already in progress, to prevent infinite loops
  return input.stop_hook_active === true;
}
