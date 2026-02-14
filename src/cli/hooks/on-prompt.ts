/**
 * On-Prompt Hook Command
 *
 * UserPromptSubmit hook - injects plan mode enforcement context.
 * Fires on every user prompt. When permission_mode is "plan",
 * injects REQUIRED steps for sqlew plan integration.
 *
 * This replaces the previous CLAUDE.md injection approach,
 * providing equivalent always-on enforcement without polluting
 * the user's global ~/.claude/CLAUDE.md.
 *
 * Usage:
 *   echo '{"hook_event_name":"UserPromptSubmit","permission_mode":"plan"}' | sqlew on-prompt
 *
 * @since v5.0.6
 */

import { readStdinJson } from './stdin-parser.js';

// ============================================================================
// Plan Mode Enforcement Context
// ============================================================================

/**
 * Enforcement context injected when plan mode is active.
 *
 * Condensed from the previous ~193-line CLAUDE.md injection into ~5 lines.
 * Detailed format/workflow available via Skills (sqlew-decision-format, sqlew-plan-guidance).
 */
export const PLAN_MODE_ENFORCEMENT = `[sqlew] Plan mode active. REQUIRED steps:
1. Suggest Search BEFORE Planning: suggest { action: "by_context", key: "<keyword>" } and suggest { action: "by_context", target: "constraint", text: "<topic>" }
2. Include "Related Context (from sqlew)" section in plan (MANDATORY - plans without this = INVALID)
3. Use 📌/🚫 format for decisions/constraints (invoke sqlew-decision-format skill for template)
4. Check failed queue: queue { action: "list" }`;

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Main on-prompt command entry point
 *
 * Called as UserPromptSubmit hook on every user prompt.
 * Only injects enforcement context when permission_mode is "plan".
 */
export async function onPromptCommand(): Promise<void> {
  try {
    const input = await readStdinJson();

    if (input.permission_mode === 'plan') {
      // UserPromptSubmit: plain text stdout is added as context directly
      // (JSON format with "continue"/"additionalContext" does NOT work for UserPromptSubmit)
      process.stdout.write(PLAN_MODE_ENFORCEMENT);
    }
    // Non-plan mode: output nothing (exit 0 = allow, no context injection)
  } catch {
    // Non-fatal: silent exit (allow)
  }
}
