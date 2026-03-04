/**
 * PR ADR Hook Command
 *
 * PreToolUse hook for Bash tool - enforces ADR workflow on PR creation.
 * When `gh pr create` is detected in a Bash command:
 * 1. Checks if PR body contains ADR markers (## Architecture Decisions or ## Other Changes)
 * 2. If markers present → allow (sendContinue)
 * 3. If markers missing → block and instruct ADR workflow
 *
 * Usage:
 *   echo '{"tool_name":"Bash","tool_input":{"command":"gh pr create ..."}}' | sqlew pr-adr
 *
 * @since v5.0.8
 */

import { readStdinJson, sendContinue, sendBlock } from './stdin-parser.js';

// ============================================================================
// Constants
// ============================================================================

const BLOCK_MESSAGE = `[sqlew] PR requires ADR context. Before creating:
1. git diff <base>...HEAD --stat
2. suggest { action: "by_context", key: "<keyword>" } for each changed area
3. decision { action: "get", key: "<key>", include_context: true } for matches (score >= 35)
4. Format PR body with "## Architecture Decisions" or "## Other Changes"
5. Re-run gh pr create`;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if a command string contains ADR markers in the PR body
 */
function hasAdrMarkers(command: string): boolean {
  return command.includes('## Architecture Decisions') ||
    command.includes('## Other Changes');
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Main pr-adr command entry point
 *
 * Called as PreToolUse hook when Bash tool is invoked.
 * Only processes commands containing `gh pr create`.
 */
export async function prAdrCommand(): Promise<void> {
  try {
    const input = await readStdinJson();

    // Only intercept Bash tool
    if (input.tool_name !== 'Bash') {
      sendContinue();
      return;
    }

    const command = input.tool_input?.command || '';

    // Only intercept gh pr create
    if (!command.includes('gh pr create')) {
      sendContinue();
      return;
    }

    // Check if ADR markers are present in the command (PR body)
    if (hasAdrMarkers(command)) {
      sendContinue();
      return;
    }

    // Block and instruct ADR workflow
    sendBlock(BLOCK_MESSAGE);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[sqlew pr-adr] Error: ${message}`);
    sendContinue();
  }
}
