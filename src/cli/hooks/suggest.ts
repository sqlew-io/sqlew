/**
 * Suggest Hook Command
 *
 * PreToolUse hook for Task tool - manages Plan agent sessions.
 * Clears stale caches when a new Plan agent starts.
 *
 * PostToolUse / research inject: when stdin carries `client` and optional
 * `additionalContext` / `additional_context` text (plugin or harness adapter),
 * emit the harness-correct Post context shape via sendPostToolUseContext.
 * Prefer Post-only inject (no Pre dual-inject).
 *
 * Usage:
 *   echo '{"tool_input": {"subagent_type": "Plan"}}' | sqlew suggest
 *   echo '{"hook_event_name":"PostToolUse","client":"cursor","additional_context":"..."}' | sqlew suggest
 *
 * @since v4.1.0
 * @modified v4.2.2 - Removed template injection, simplified to cache management
 * @modified v5.4.x - Post-only client-correct context emission when inject text present
 */

import {
  readStdinJson,
  sendContinue,
  sendPostToolUseContext,
  isPlanAgent,
  getProjectPath,
  type HookInput,
} from './stdin-parser.js';
import { clearPlanCache, clearCurrentPlan } from '../../config/global-config.js';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract inject text from stdin for suggest-on-Post.
 * Accepts either camelCase or Cursor snake_case keys; does not log the text.
 */
function extractPostInjectText(input: HookInput): string | undefined {
  const camel = input.additionalContext;
  if (typeof camel === 'string' && camel.trim()) {
    return camel;
  }
  const snake = input.additional_context;
  if (typeof snake === 'string' && snake.trim()) {
    return snake;
  }
  return undefined;
}

function isPostToolUseEvent(input: HookInput): boolean {
  return input.hook_event_name === 'PostToolUse';
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Main suggest command entry point
 *
 * - PreToolUse + Task: clears stale caches for Plan agents.
 * - PostToolUse + inject text + known client: emit client-correct context JSON.
 */
export async function suggestCommand(): Promise<void> {
  try {
    const input = await readStdinJson();

    // Suggest-on-Post: emit harness-correct additional context when provided.
    if (isPostToolUseEvent(input)) {
      const inject = extractPostInjectText(input);
      if (inject) {
        sendPostToolUseContext(inject, input.client);
        return;
      }
      sendContinue();
      return;
    }

    // Only process Task tool (PreToolUse hook)
    if (input.tool_name !== 'Task') {
      sendContinue();
      return;
    }

    // Check if this is a Plan agent - clear stale caches
    if (isPlanAgent(input)) {
      const projectPath = getProjectPath(input);
      if (projectPath) {
        // Clear stale caches from previous sessions (v4.2.0+)
        // This prevents false positives in on-subagent-stop hook
        clearCurrentPlan(projectPath);
        clearPlanCache(projectPath);
      }
    }

    // Continue without modification
    sendContinue();
  } catch (error) {
    // On error, log to stderr but continue execution
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[sqlew suggest] Error: ${message}`);
    sendContinue();
  }
}
