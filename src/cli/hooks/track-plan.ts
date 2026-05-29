/**
 * Track Plan Hook Command
 *
 * PreToolUse hook for Write tool - tracks plan files and injects templates.
 * When a .claude/plans/*.md file is being written:
 * 1. Ensures plan has sqlew-plan-id in YAML frontmatter
 * 2. Saves current plan info to session cache
 * 3. Injects Decision/Constraint template on new plan creation
 *
 * Decision/constraint extraction happens in on-exit-plan.ts using pattern matching.
 *
 * Usage:
 *   echo '{"tool_input": {"file_path": ".claude/plans/my-plan.md"}}' | sqlew track-plan
 *
 * @since v4.1.0
 * @modified v4.2.2 - Removed LLM extraction, simplified to plan tracking only
 * @modified v4.2.3 - Added template injection on new plan creation
 */

import { randomUUID } from 'crypto';
import { readStdinJson, sendContinue, isPlanFile, getProjectPath, computeGrokPlanPath } from './stdin-parser.js';
import { PLAN_MODE_ENFORCEMENT } from './on-prompt.js';
import { extractPlanFileName, parseFrontmatter, generatePlanId, getPlanId } from './plan-id-utils.js';
import {
  saveCurrentPlan,
  loadCurrentPlan,
  clearPlanCache,
  clearCurrentPlan,
  type CurrentPlanInfo,
} from '../../config/global-config.js';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// ============================================================================
// Template Constants
// ============================================================================

/**
 * Decision/Constraint template to inject on new plan creation
 * Compact format for context window efficiency
 */
const PLAN_TEMPLATE = `
---
## 📝 Decision/Constraint Recording (auto-detected on ExitPlanMode)

### 📌 Decision: [key/path]
- **Value**: Description
- **Layer**: presentation | business | data | infrastructure | cross-cutting
- **Rationale**: Why this decision was made

### 🚫 Constraint: [category]
- **Rule**: Description (category: architecture | security | code-style | performance)
- **Priority**: critical | high | medium | low
- **Tags**: comma-separated tags

---
`.trim();

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Main track-plan command entry point
 *
 * Called as PreToolUse hook when Write tool is invoked.
 * Only processes .claude/plans/*.md files.
 *
 * v4.2.2: Simplified to plan tracking only. Pattern extraction happens in on-exit-plan.
 */
export async function trackPlanCommand(): Promise<void> {
  try {
    const input = await readStdinJson();

    // Handle EnterPlanMode - clear old cache and prepare for plan tracking
    if (input.tool_name === 'EnterPlanMode') {
      const projectPath = getProjectPath(input);
      if (projectPath) {
        // Clear old plan cache to prevent stale data on "clear context" approval
        clearPlanCache(projectPath);
        clearCurrentPlan(projectPath);

        // Grok Build: pre-record the per-session plan.md path now (we have the sessionId).
        // This keeps the cache warm; on-exit-plan also recomputes defensively if this is missed.
        if (input.client === 'grok' && input.session_id) {
          const planPath = computeGrokPlanPath(projectPath, input.session_id);
          if (planPath) {
            const planInfo: CurrentPlanInfo = {
              plan_id: randomUUID(),
              plan_file: 'plan.md',
              plan_path: planPath,
              plan_updated_at: new Date().toISOString(),
              recorded: false,
              decision_pending: true,
            };
            saveCurrentPlan(projectPath, planInfo);
          }
        }
      }
      sendContinue(PLAN_MODE_ENFORCEMENT);
      return;
    }

    // Only process plan files for Write tool
    if (!isPlanFile(input)) {
      sendContinue();
      return;
    }

    const projectPath = getProjectPath(input);
    if (!projectPath) {
      sendContinue();
      return;
    }

    const filePath = input.tool_input?.file_path;
    if (!filePath) {
      sendContinue();
      return;
    }

    // Resolve absolute path
    const absolutePath = resolve(projectPath, filePath);

    // Parse frontmatter for plan ID (from tool_input content if available)
    let content: string | undefined;
    if (!existsSync(absolutePath)) {
      content = input.tool_input?.content as string | undefined;
    } else {
      content = (input.tool_input?.content as string | undefined) || readFileSync(absolutePath, 'utf-8');
    }

    // Get or generate plan ID
    let planId: string;
    if (content) {
      const frontmatter = parseFrontmatter(content);
      planId = frontmatter.data['sqlew-plan-id'] || generatePlanId();
    } else {
      planId = generatePlanId();
    }

    const planFileName = extractPlanFileName(absolutePath);

    // Check if we already have cached info for this plan
    const existingPlan = loadCurrentPlan(projectPath);
    const isNewPlan = !existingPlan || existingPlan.plan_id !== planId;

    // Clear old cache if switching plans
    if (isNewPlan) {
      clearPlanCache(projectPath);
    }

    // Save current plan info to cache
    // CRITICAL: Reset recorded flag and enforcement_shown_at on new plan
    const planInfo: CurrentPlanInfo = {
      plan_id: planId,
      plan_file: planFileName,
      plan_updated_at: new Date().toISOString(),
      recorded: isNewPlan ? false : (existingPlan?.recorded ?? false),
      decision_pending: isNewPlan ? true : (existingPlan?.decision_pending ?? false),
      enforcement_shown_at: isNewPlan ? undefined : existingPlan?.enforcement_shown_at,
    };
    saveCurrentPlan(projectPath, planInfo);

    // Build context message
    let contextMsg = `[sqlew] Tracking plan: ${planFileName} (ID: ${planId.slice(0, 8)}...)`;

    // Inject template on new plan creation
    if (isNewPlan) {
      contextMsg += `\n\n${PLAN_TEMPLATE}`;
    }

    sendContinue(contextMsg);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[sqlew track-plan] Error: ${message}`);
    sendContinue();
  }
}

/**
 * Check if a plan is currently being tracked for a project
 *
 * @param projectPath - Project root path
 * @returns Current plan info or null
 */
export function getCurrentTrackedPlan(projectPath: string): CurrentPlanInfo | null {
  return loadCurrentPlan(projectPath);
}

/**
 * Get plan ID from a file path (convenience wrapper)
 *
 * @param filePath - Path to plan file
 * @returns Plan ID or null
 */
export function getPlanIdFromFile(filePath: string): string | null {
  return getPlanId(filePath);
}
