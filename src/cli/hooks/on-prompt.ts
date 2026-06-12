/**
 * On-Prompt Hook Command
 *
 * UserPromptSubmit hook - injects plan mode enforcement context.
 * Fires on every user prompt. When permission_mode is "plan",
 * injects REQUIRED steps for sqlew plan integration.
 *
 * v5.0.7: First/repeat split - full message with inline template on first
 * prompt, short reminder on subsequent prompts (~80% token reduction).
 *
 * This replaces the previous CLAUDE.md injection approach,
 * providing equivalent always-on enforcement without polluting
 * the user's global ~/.claude/CLAUDE.md.
 *
 * Usage:
 *   echo '{"hook_event_name":"UserPromptSubmit","permission_mode":"plan"}' | sqlew on-prompt
 *
 * @since v5.0.6
 * @modified v5.0.7 - First/repeat message split, inline template, isPlanMode()
 */

import { randomUUID } from 'crypto';
import { readStdinJson, isPlanMode, getProjectPath } from './stdin-parser.js';
import { loadCurrentPlan, saveCurrentPlan, type CurrentPlanInfo } from '../../config/global-config.js';
import { findCodexTranscriptPath } from './codex-transcript.js';

// ============================================================================
// Plan Mode Enforcement Context
// ============================================================================

/**
 * Full enforcement message with inline decision/constraint template.
 * Shown on the first prompt in plan mode (per plan session).
 *
 * Includes the exact 📌/🚫 format so the AI doesn't need to
 * invoke a separate skill — direct embedding improves compliance.
 */
export const ENFORCEMENT_FULL = `[sqlew] Plan mode active. REQUIRED:
1. suggest { action: "by_context", key: "<keyword>" } BEFORE planning
2. Include "Related Context (from sqlew)" section
3. Format decisions/constraints EXACTLY like this:

### 📌 Decision: key-name
- **Value**: description
- **Layer**: business
- **Rationale**: why

### 🚫 Constraint: category
- **Rule**: description
- **Priority**: high
- **Tags**: comma-separated

4. Check queue: queue { action: "list" }`;

/**
 * Short reminder for subsequent prompts in the same plan session.
 * Relies on the full message already being in context.
 */
export const ENFORCEMENT_SHORT = `[sqlew] Plan guidance active (see format above)`;

/**
 * @deprecated Use ENFORCEMENT_FULL instead. Kept for backwards compatibility
 * with track-plan.ts import.
 */
export const PLAN_MODE_ENFORCEMENT = ENFORCEMENT_FULL;

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Main on-prompt command entry point
 *
 * Called as UserPromptSubmit hook on every user prompt.
 * Only injects enforcement context when permission_mode is "plan".
 *
 * First prompt in a plan session gets the full message with inline template.
 * Subsequent prompts get a short 1-line reminder (~80% token reduction).
 */
export async function onPromptCommand(): Promise<void> {
  try {
    const input = await readStdinJson();

    // Grok Build: UserPromptSubmit is a passive hook — stdout is ignored.
    // Plan mode guidance is delivered via plugin skills instead.
    if (input.client === 'grok') {
      return;
    }

    if (!isPlanMode(input)) {
      // Non-plan mode: output nothing (exit 0 = allow, no context injection)
      return;
    }

    // Determine first vs repeat using session cache
    const projectPath = getProjectPath(input);
    if (!projectPath) {
      // Fallback: always show full message if project path unknown
      process.stdout.write(ENFORCEMENT_FULL);
      return;
    }

    let planInfo = loadCurrentPlan(projectPath);

    if (input.client === 'codex' && !planInfo) {
      const transcriptPath =
        input.transcript_path ||
        (input.session_id ? findCodexTranscriptPath(input.session_id) : undefined) ||
        undefined;
      const codexPlanInfo: CurrentPlanInfo = {
        plan_id: randomUUID(),
        plan_file: 'codex-plan.md',
        plan_path: transcriptPath,
        plan_updated_at: new Date().toISOString(),
        recorded: false,
        decision_pending: true,
      };
      saveCurrentPlan(projectPath, codexPlanInfo);
      planInfo = codexPlanInfo;
    }

    if (!planInfo || !planInfo.enforcement_shown_at) {
      // First prompt in this plan session → full message with inline template
      process.stdout.write(ENFORCEMENT_FULL);

      // Mark enforcement as shown
      if (planInfo) {
        planInfo.enforcement_shown_at = new Date().toISOString();
        saveCurrentPlan(projectPath, planInfo);
      }
    } else {
      // Subsequent prompt → short reminder
      process.stdout.write(ENFORCEMENT_SHORT);
    }
  } catch {
    // Non-fatal: silent exit (allow)
  }
}
