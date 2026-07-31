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
 * v5.4.0: Session context injection for Hermes (primary) and Codex (fallback).
 *
 * Usage:
 *   echo '{"hook_event_name":"UserPromptSubmit","permission_mode":"plan"}' | sqlew on-prompt
 *
 * @since v5.0.6
 */

import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import {
  readStdinJson,
  isPlanMode,
  readGrokPlanModeState,
  computeGrokPlanPath,
  getProjectPath,
  sendHermesContext,
  type HookInput,
} from './stdin-parser.js';
import {
  loadCurrentPlan,
  saveCurrentPlan,
  saveSessionContextMarker,
  type CurrentPlanInfo,
} from '../../config/global-config.js';
import { findCodexTranscriptPath } from './codex-transcript.js';
import {
  buildSessionContext,
  shouldInjectOnPrompt,
} from './session-context.js';
import { ensureGrokPlanTemplate } from './grok-plan-template.js';
import { debugLog } from '../../utils/debug-logger.js';

// ============================================================================
// Plan Mode Enforcement Context
// ============================================================================

export const ENFORCEMENT_FULL = `[sqlew] Plan mode active. REQUIRED:
1. suggest { action: "by_context", key: "<keyword>" } BEFORE planning
2. Include "Related Context (from sqlew)" section
3. Record the WHY (rationale + rejected alternatives); skip facts derivable from code. Format EXACTLY:

### 📌 Decision: key-name
- **Value**: description
- **Layer**: business
- **Rationale**: why

### 🚫 Constraint: category
- **Rule**: description
- **Priority**: high
- **Tags**: comma-separated

4. Check queue: queue { action: "list" }`;

export const ENFORCEMENT_SHORT = `[sqlew] Plan guidance active (see format above)`;

/** @deprecated Use ENFORCEMENT_FULL instead. */
export const PLAN_MODE_ENFORCEMENT = ENFORCEMENT_FULL;

// ============================================================================
// Helpers
// ============================================================================

function resolveSessionId(input: HookInput): string | undefined {
  return input.session_id
    || process.env.HERMES_SESSION_ID
    || process.env.CODEX_SESSION_ID;
}

async function maybeSessionContextBlock(
  projectPath: string,
  sessionId: string | undefined,
  harness: string,
): Promise<string | null> {
  if (!shouldInjectOnPrompt(projectPath, sessionId)) {
    return null;
  }
  const block = await buildSessionContext(projectPath);
  if (block) {
    saveSessionContextMarker(projectPath, {
      session_id: sessionId,
      injected_at: new Date().toISOString(),
      harness,
    });
  }
  return block;
}

function combineContext(sessionBlock: string | null, message: string): string {
  if (sessionBlock) {
    return [sessionBlock, message].join('\n\n');
  }
  return message;
}

function getHermesEnforcement(projectPath: string): { message: string; planInfo: CurrentPlanInfo | null } {
  let planInfo = loadCurrentPlan(projectPath);
  if (!planInfo || !planInfo.enforcement_shown_at) {
    if (planInfo) {
      planInfo.enforcement_shown_at = new Date().toISOString();
      saveCurrentPlan(projectPath, planInfo);
    } else {
      planInfo = {
        plan_id: randomUUID(),
        plan_file: 'hermes-plan.md',
        plan_updated_at: new Date().toISOString(),
        recorded: false,
        decision_pending: true,
        enforcement_shown_at: new Date().toISOString(),
      };
      saveCurrentPlan(projectPath, planInfo);
    }
    return { message: ENFORCEMENT_FULL, planInfo };
  }
  return { message: ENFORCEMENT_SHORT, planInfo };
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Grok UserPromptSubmit: stdout is ignored (passive hook).
 * Side-effect only — seed/maintain plan.md Decision/Constraint template when
 * plan_mode.json reports Active or Pending (covers /plan without enter_plan_mode).
 */
function handleGrokPromptSideEffects(input: HookInput): void {
  const projectPath = getProjectPath(input);
  const sessionId = input.session_id;
  if (!projectPath || !sessionId) {
    return;
  }

  // Prefer plan_mode.json Active/Pending. If the file is missing (Grok format
  // change), fall back when plan.md already exists so mid-session re-inject
  // still works. Inactive/ExitPending → no inject.
  const state = readGrokPlanModeState(projectPath, sessionId);
  let shouldEnsure = state === 'Active' || state === 'Pending';
  if (!shouldEnsure && state === null) {
    const planPath = computeGrokPlanPath(projectPath, sessionId);
    shouldEnsure = !!(planPath && existsSync(planPath));
  }
  if (!shouldEnsure) {
    return;
  }

  const injected = ensureGrokPlanTemplate(projectPath, sessionId);
  debugLog('DEBUG', '[on-prompt] Grok plan template ensure', {
    projectPath,
    sessionId,
    state,
    injected,
  });
}

export async function onPromptCommand(): Promise<void> {
  try {
    const input = await readStdinJson();

    if (input.client === 'grok') {
      // No stdout — Grok ignores passive hook output. File side-effect only.
      handleGrokPromptSideEffects(input);
      return;
    }

    const projectPath = getProjectPath(input);
    const sessionId = resolveSessionId(input);

    // Hermes / omp CLI fallback: session context + plan guidance as plain/JSON
    if (input.client === 'hermes' || input.client === 'omp') {
      if (!projectPath) {
        if (input.client === 'hermes') {
          sendHermesContext(ENFORCEMENT_FULL);
        } else {
          process.stdout.write(ENFORCEMENT_FULL);
        }
        return;
      }

      const harness = input.client;
      const sessionBlock = await maybeSessionContextBlock(projectPath, sessionId, harness);
      const { message } = getHermesEnforcement(projectPath);
      const combined = combineContext(sessionBlock, message);
      if (input.client === 'hermes') {
        sendHermesContext(combined);
      } else {
        // omp CLI fallback: plain text (extension uses library path, not this)
        process.stdout.write(combined);
      }
      return;
    }

    // Codex: session context fallback (before plan-mode early return)
    if (input.client === 'codex' && projectPath) {
      const sessionBlock = await maybeSessionContextBlock(projectPath, sessionId, 'codex');

      if (!isPlanMode(input)) {
        if (sessionBlock) {
          process.stdout.write(sessionBlock);
        }
        return;
      }

      // Plan mode: combine session context with enforcement below
      let planInfo = loadCurrentPlan(projectPath);

      if (!planInfo) {
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

      const enforcement = (!planInfo.enforcement_shown_at) ? ENFORCEMENT_FULL : ENFORCEMENT_SHORT;
      if (!planInfo.enforcement_shown_at) {
        planInfo.enforcement_shown_at = new Date().toISOString();
        saveCurrentPlan(projectPath, planInfo);
      }

      process.stdout.write(combineContext(sessionBlock, enforcement));
      return;
    }

    if (!isPlanMode(input)) {
      return;
    }

    // Claude plan mode (session context injected via SessionStart, not here)
    if (!projectPath) {
      process.stdout.write(ENFORCEMENT_FULL);
      return;
    }

    let planInfo = loadCurrentPlan(projectPath);

    if (!planInfo || !planInfo.enforcement_shown_at) {
      process.stdout.write(ENFORCEMENT_FULL);
      if (planInfo) {
        planInfo.enforcement_shown_at = new Date().toISOString();
        saveCurrentPlan(projectPath, planInfo);
      }
    } else {
      process.stdout.write(ENFORCEMENT_SHORT);
    }
  } catch {
    // Non-fatal: silent exit (allow)
  }
}