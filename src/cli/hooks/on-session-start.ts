/**
 * On-Session-Start Hook Command
 *
 * SessionStart hook - handles session start events.
 * When source is "clear", triggers Plan-to-ADR processing for cached plans
 * that weren't processed by PostToolUse:ExitPlanMode (due to session clear).
 *
 * v5.4.0: Injects session context (recent decisions + active constraints)
 * on startup/clear for Claude Code and Codex.
 *
 * Usage:
 *   echo '{"hook_event_name": "SessionStart", "source": "clear", "cwd": "/path"}' | sqlew on-session-start
 *
 * @since v5.0.0
 */

import {
  readStdinJson,
  sendContinue,
  sendSessionStartContext,
  getProjectPath,
} from './stdin-parser.js';
import { processPlanPatterns } from './plan-processor.js';
import {
  loadCurrentPlan,
  clearCurrentPlan,
  saveSessionContextMarker,
} from '../../config/global-config.js';
import { buildSessionContext } from './session-context.js';

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Process Plan-to-ADR rescue for source=clear sessions.
 */
function processClearPlanRescue(projectPath: string): void {
  const cachedPlan = loadCurrentPlan(projectPath);
  if (!cachedPlan) {
    return;
  }

  if (cachedPlan.recorded) {
    clearCurrentPlan(projectPath);
    return;
  }

  const result = processPlanPatterns(projectPath);
  clearCurrentPlan(projectPath);

  if (result.processed && result.confirmationMessage) {
    console.error(`[sqlew on-session-start] ${result.confirmationMessage}`);
  }
}

/**
 * Main on-session-start command entry point
 */
export async function onSessionStartCommand(): Promise<void> {
  try {
    const input = await readStdinJson();
    const projectPath = getProjectPath(input);
    const client = input.client ?? 'claude';
    const source = input.source ?? 'startup';

    // Plan-to-ADR rescue for "clear" source (unchanged behavior)
    if (input.source === 'clear' && projectPath) {
      processClearPlanRescue(projectPath);
    }

    // Session context injection: Claude/Codex on startup or clear only
    const shouldInject =
      (client === 'claude' || client === 'codex') &&
      (source === 'startup' || source === 'clear');

    if (shouldInject && projectPath) {
      const context = await buildSessionContext(projectPath);
      if (context) {
        saveSessionContextMarker(projectPath, {
          session_id: input.session_id,
          injected_at: new Date().toISOString(),
          harness: client,
        });
        sendSessionStartContext(context);
        return;
      }
    }

    sendContinue();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[sqlew on-session-start] Error: ${message}`);
    sendContinue();
  }
}