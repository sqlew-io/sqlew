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
import {
  readStdinJson,
  isPlanMode,
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

export async function onPromptCommand(): Promise<void> {
  try {
    const input = await readStdinJson();

    if (input.client === 'grok') {
      return;
    }

    const projectPath = getProjectPath(input);
    const sessionId = resolveSessionId(input);

    // Hermes: pre_llm_call — session context + plan guidance in one JSON line
    if (input.client === 'hermes') {
      if (!projectPath) {
        sendHermesContext(ENFORCEMENT_FULL);
        return;
      }

      const sessionBlock = await maybeSessionContextBlock(projectPath, sessionId, 'hermes');
      const { message } = getHermesEnforcement(projectPath);
      sendHermesContext(combineContext(sessionBlock, message));
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