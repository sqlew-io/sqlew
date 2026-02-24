/**
 * Claude Code Hooks stdin parser
 *
 * Parses JSON input from Claude Code Hooks.
 * Hooks receive data via stdin in JSON format.
 *
 * @since v4.1.0
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Tool input for various Claude Code tools
 */
export interface ToolInput {
  /** File path (Edit, Write tools) */
  file_path?: string;
  /** Command (Bash tool) */
  command?: string;
  /** Description (Task tool) */
  description?: string;
  /** Prompt (Task tool) */
  prompt?: string;
  /** Subagent type (Task tool) */
  subagent_type?: string;
  /** Todos (TodoWrite tool) */
  todos?: TodoItem[];
  /** Generic key-value pairs */
  [key: string]: unknown;
}

/**
 * Todo item from TodoWrite tool
 */
export interface TodoItem {
  /** Todo content */
  content: string;
  /** Todo status: pending, in_progress, completed */
  status: 'pending' | 'in_progress' | 'completed';
  /** Active form description */
  activeForm: string;
}

/**
 * Tool response from PostToolUse
 */
export interface ToolResponse {
  /** Whether the tool completed successfully */
  completed?: boolean;
  /** Summary of what was done */
  summary?: string;
  /** Output content */
  output?: string;
  /** Generic key-value pairs */
  [key: string]: unknown;
}

/**
 * Hook input from Claude Code
 */
export interface HookInput {
  /** Session ID (changes on resume) */
  session_id?: string;
  /** Current working directory */
  cwd?: string;
  /** Hook event name */
  hook_event_name?: 'PreToolUse' | 'PostToolUse' | 'SessionStart' | 'SessionEnd' | 'Stop' | 'SubagentStop' | 'Notification' | 'PreCompact' | 'UserPromptSubmit';
  /** Tool name being called */
  tool_name?: string;
  /** Tool input parameters */
  tool_input?: ToolInput;
  /** Tool response (PostToolUse only) */
  tool_response?: ToolResponse;
  /** Transcript path */
  transcript_path?: string;
  /** Permission mode */
  permission_mode?: string;
  /** Stop hook active flag (for Stop/SubagentStop - prevents infinite loops) */
  stop_hook_active?: boolean;
  /** SessionStart source: startup | resume | clear | compact */
  source?: 'startup' | 'resume' | 'clear' | 'compact';
  /** SessionEnd reason: clear | logout | prompt_input_exit | other */
  reason?: 'clear' | 'logout' | 'prompt_input_exit' | 'other';
}

/**
 * Hook-specific output for PreToolUse (v4.2.0+)
 * Used for permission decisions and input modification
 */
export interface PreToolUseHookOutput {
  /** Hook event name */
  hookEventName: 'PreToolUse';
  /** Permission decision */
  permissionDecision?: 'allow' | 'deny' | 'ask';
  /** Reason for the decision */
  permissionDecisionReason?: string;
  /** Updated tool input - modifies the tool's input before execution */
  updatedInput?: ToolInput;
}

/**
 * Hook-specific output for PostToolUse (v4.2.0+)
 * Used for injecting context after tool execution
 */
export interface PostToolUseHookOutput {
  /** Hook event name */
  hookEventName: 'PostToolUse';
  /** Additional context to inject into Claude's context */
  additionalContext?: string;
}

/**
 * Hook output to Claude Code
 */
export interface HookOutput {
  /** Whether to continue execution */
  continue?: boolean;
  /** Reason for stopping (if continue=false) */
  stopReason?: string;
  /** Additional context to inject (PostToolUse, UserPromptSubmit, SessionStart only) */
  additionalContext?: string;
  /** System message to add */
  systemMessage?: string;
  /** Whether to suppress output */
  suppressOutput?: boolean;
  /** Hook-specific output (PreToolUse, PostToolUse) - v4.2.0+ */
  hookSpecificOutput?: PreToolUseHookOutput | PostToolUseHookOutput;
  /** @deprecated Use hookSpecificOutput.updatedInput instead */
  updatedInput?: ToolInput;
}

// ============================================================================
// Parsing
// ============================================================================

/**
 * Read and parse JSON from stdin
 *
 * Claude Code Hooks send data via stdin in JSON format.
 * This function reads all stdin and parses it as JSON.
 *
 * @returns Parsed hook input
 * @throws Error if stdin is empty or invalid JSON
 */
export async function readStdinJson(): Promise<HookInput> {
  return new Promise((resolve, reject) => {
    let data = '';

    // Set encoding for text input
    process.stdin.setEncoding('utf8');

    // Read all data from stdin
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });

    // Parse when stdin closes
    process.stdin.on('end', () => {
      if (!data.trim()) {
        // Empty stdin - return empty object
        resolve({});
        return;
      }

      try {
        const parsed = JSON.parse(data) as HookInput;
        resolve(parsed);
      } catch (error) {
        reject(new Error(`Invalid JSON input: ${error instanceof Error ? error.message : String(error)}`));
      }
    });

    // Handle errors
    process.stdin.on('error', (error) => {
      reject(new Error(`Failed to read stdin: ${error.message}`));
    });

    // Resume stdin (it might be paused)
    process.stdin.resume();
  });
}

/**
 * Write hook output to stdout
 *
 * @param output - Hook output to send
 */
export function writeHookOutput(output: HookOutput): void {
  console.log(JSON.stringify(output));
}

/**
 * Send a continue response
 *
 * @param additionalContext - Optional context to inject
 * @param systemMessage - Optional system message
 */
export function sendContinue(additionalContext?: string, systemMessage?: string): void {
  const output: HookOutput = { continue: true };
  if (additionalContext) {
    output.additionalContext = additionalContext;
  }
  if (systemMessage) {
    output.systemMessage = systemMessage;
  }
  writeHookOutput(output);
}

/**
 * Send a continue response with context for PostToolUse
 *
 * Uses hookSpecificOutput format which is required for PostToolUse hooks
 * to properly inject context into Claude's conversation.
 *
 * @param additionalContext - Context to inject after tool execution
 */
export function sendPostToolUseContext(additionalContext: string): void {
  const output: HookOutput = {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext,
    },
  };
  writeHookOutput(output);
}

/**
 * Send a block response (exit code 2)
 *
 * @param reason - Reason for blocking
 */
export function sendBlock(reason: string): void {
  console.error(reason);
  process.exit(2);
}

/**
 * Send an updatedInput response (PreToolUse only)
 *
 * Modifies the tool's input before execution.
 * Use this to inject context into Task tool prompts.
 *
 * NOTE: Uses root-level updatedInput format (not hookSpecificOutput) because
 * that's what Claude Code actually processes. Verified in debug logs from
 * 2025-12-26 where TOML template injection worked correctly.
 *
 * @param originalInput - Original tool input
 * @param modifications - Fields to modify/add
 */
export function sendUpdatedInput(originalInput: ToolInput, modifications: Partial<ToolInput>): void {
  const updatedInput = { ...originalInput, ...modifications };
  const output: HookOutput = {
    continue: true,
    updatedInput,
  };
  writeHookOutput(output);
}

// ============================================================================
// Plan Mode Detection
// ============================================================================

/**
 * Plan mode detection - single source of truth for all hooks
 *
 * Centralizes the plan mode check so that when future environments
 * (Codex, Cursor, etc.) support equivalent functionality,
 * only this function needs to change.
 *
 * @param input - Hook input from Claude Code
 * @returns true if the current session is in plan mode
 */
export function isPlanMode(input: HookInput): boolean {
  // Claude Code
  if (input.permission_mode === 'plan') return true;
  // Future: Codex, Cursor, etc.
  return false;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if the hook input is for a plan file
 *
 * Plan files can be in:
 * - Global: ~/.claude/plans/*.md (e.g., C:/Users/xxx/.claude/plans/my-plan.md)
 * - Project: .claude/plans/*.md (relative path)
 *
 * @param input - Hook input
 * @returns true if the tool is operating on a plan file
 */
export function isPlanFile(input: HookInput): boolean {
  const filePath = input.tool_input?.file_path;
  if (!filePath) {
    return false;
  }

  // Normalize path separators for cross-platform support
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Match both global and project-local plan paths:
  // - Global: /Users/xxx/.claude/plans/foo.md, C:/Users/xxx/.claude/plans/foo.md
  // - Project: .claude/plans/foo.md
  return /[/\\]?\.claude\/plans\/[^/]+\.md$/.test(normalizedPath);
}

/**
 * Check if all todos are completed
 *
 * @param input - Hook input
 * @returns true if all todos have status "completed"
 */
export function areAllTodosCompleted(input: HookInput): boolean {
  const todos = input.tool_input?.todos;
  if (!todos || !Array.isArray(todos) || todos.length === 0) {
    return false;
  }

  return todos.every((todo) => todo.status === 'completed');
}

/**
 * Get project path from hook input
 * Uses cwd from input or falls back to CLAUDE_PROJECT_DIR
 *
 * @param input - Hook input
 * @returns Project path or undefined
 */
export function getProjectPath(input: HookInput): string | undefined {
  return input.cwd || process.env.CLAUDE_PROJECT_DIR;
}

/**
 * Check if the hook input is for a Plan agent
 *
 * @param input - Hook input
 * @returns true if subagent_type is 'Plan'
 */
export function isPlanAgent(input: HookInput): boolean {
  return input.tool_input?.subagent_type === 'Plan';
}
