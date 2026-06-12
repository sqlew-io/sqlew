/**
 * On-Exit-Plan Hook Command
 *
 * PostToolUse hook for ExitPlanMode - extracts and auto-registers decisions/constraints.
 * Delegates to plan-processor.ts for actual processing.
 *
 * Usage:
 *   echo '{"tool_name": "ExitPlanMode"}' | sqlew on-exit-plan
 *
 * @since v4.2.0
 * @modified v4.2.5 - Refactored to use plan-processor.ts (DRY)
 */

import { randomUUID } from 'crypto';
import { readStdinJson, sendContinue, sendPostToolUseContext, getProjectPath, computeGrokPlanPath } from './stdin-parser.js';
import { loadCurrentPlan, saveCurrentPlan, type CurrentPlanInfo } from '../../config/global-config.js';
import { processPlanPatterns } from './plan-processor.js';
import {
  extractPlanMarkdownFromCodexTranscript,
  findCodexTranscriptPath,
  materializeCodexPlanFile,
} from './codex-transcript.js';
import { debugLog } from '../../utils/debug-logger.js';

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Main on-exit-plan command entry point
 *
 * Called as PostToolUse hook when ExitPlanMode is invoked.
 * Delegates to processPlanPatterns for extraction and registration.
 */
export async function onExitPlanCommand(): Promise<void> {
  try {
    const input = await readStdinJson();

    const projectPath = getProjectPath(input);
    const isExitPlanTool = input.tool_name === 'ExitPlanMode';
    const isCodexStopWithPendingPlan =
      input.client === 'codex' &&
      input.hook_event_name === 'Stop' &&
      !!projectPath &&
      !!loadCurrentPlan(projectPath)?.decision_pending;

    if (!isExitPlanTool && !isCodexStopWithPendingPlan) {
      sendContinue();
      return;
    }
    if (!projectPath) {
      debugLog('WARN', '[on-exit-plan] No project path', {
        client: input.client,
        session_id: input.session_id,
        cwd: input.cwd,
      });
      sendContinue();
      return;
    }

    debugLog('DEBUG', '[on-exit-plan] Processing exit', {
      client: input.client,
      session_id: input.session_id,
      projectPath,
    });

    // Grok Build: the per-session plan lives at ~/.grok/sessions/<enc(cwd)>/<sessionId>/plan.md.
    // The exit hook's session_id is authoritative (each Grok session has its own plan.md), so
    // ALWAYS resolve the path from it here — never trust a stored plan_path, which may be stale
    // from a previous session and would make processPlanPatterns read the wrong/missing file.
    // When the stored info belongs to a different session we reset it as a new plan; when it's
    // the same session we preserve plan_id/recorded so dedup still works.
    if (input.client === 'grok' && input.session_id) {
      const planPath = computeGrokPlanPath(projectPath, input.session_id);
      if (planPath) {
        const existing = loadCurrentPlan(projectPath);
        const sameSession = existing?.plan_path === planPath;
        const planInfo: CurrentPlanInfo = {
          plan_id: sameSession && existing ? existing.plan_id : randomUUID(),
          plan_file: 'plan.md',
          plan_path: planPath,
          plan_updated_at: new Date().toISOString(),
          recorded: sameSession ? (existing?.recorded ?? false) : false,
          decision_pending: sameSession ? (existing?.decision_pending ?? true) : true,
          enforcement_shown_at: sameSession ? existing?.enforcement_shown_at : undefined,
        };
        saveCurrentPlan(projectPath, planInfo);
      }
    }

    if (input.client === 'codex') {
      const existing = loadCurrentPlan(projectPath);
      const transcriptPath =
        input.transcript_path ||
        existing?.plan_path ||
        (input.session_id ? findCodexTranscriptPath(input.session_id) : null);

      if (transcriptPath) {
        const extracted = extractPlanMarkdownFromCodexTranscript(transcriptPath);
        if (extracted) {
          const materializedPath = materializeCodexPlanFile(
            projectPath,
            input.session_id || existing?.plan_id || 'codex',
            extracted,
          );
          const planInfo: CurrentPlanInfo = {
            plan_id: existing?.plan_id || randomUUID(),
            plan_file: 'codex-plan.md',
            plan_path: materializedPath,
            plan_updated_at: new Date().toISOString(),
            recorded: existing?.recorded ?? false,
            decision_pending: existing?.decision_pending ?? true,
            enforcement_shown_at: existing?.enforcement_shown_at,
          };
          saveCurrentPlan(projectPath, planInfo);
        }
      }
    }

    // Delegate to shared processor
    const result = processPlanPatterns(projectPath);

    debugLog('DEBUG', '[on-exit-plan] Result', {
      processed: result.processed,
      skipReason: result.skipReason,
      projectPath,
    });

    if (!result.processed) {
      // Map skip reasons to user-friendly messages
      const messages: Record<string, string> = {
        no_active_plan: '[sqlew] No active plan tracked.',
        already_recorded: '[sqlew] Patterns already extracted.',
        plan_file_not_found: '[sqlew] Plan file not found.',
        read_error: '[sqlew] Could not read plan file.',
        no_patterns: '[sqlew] No decisions or constraints detected in plan.',
        no_valid_patterns: '[sqlew] No valid decisions or constraints found.',
      };
      sendContinue(messages[result.skipReason || ''] || '');
      return;
    }

    // Send confirmation message
    if (result.confirmationMessage) {
      sendPostToolUseContext(result.confirmationMessage);
    } else {
      sendContinue();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[sqlew on-exit-plan] Error: ${message}`);
    sendContinue();
  }
}
