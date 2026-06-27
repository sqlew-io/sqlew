/**
 * Claude Code Hooks stdin parser
 *
 * Parses JSON input from Claude Code Hooks.
 * Hooks receive data via stdin in JSON format.
 *
 * @since v4.1.0
 */

import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { loadCurrentPlan } from '../../config/global-config.js';
import { resolvePlanPath } from './plan-pattern-extractor.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Tool input for various Claude Code tools
 */
export interface ToolInput {
  /** File path (Edit, Write tools) */
  file_path?: string;
  /** File path used by Hermes file tools (write_file/read_file/patch) */
  path?: string;
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
  /** Codex collaboration mode (e.g. plan, default). */
  collaboration_mode?: string;
  /** Originating client, set by normalizeHookInput() (e.g., 'grok', 'codex', 'hermes'). undefined = Claude/native. */
  client?: 'grok' | 'codex' | 'claude' | 'hermes';
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
// Cross-agent normalization (Claude / Grok Build / future)
// ============================================================================

/**
 * Grok Build event names (snake_case) → Claude canonical event names (PascalCase).
 * Grok sends e.g. "pre_tool_use"; Claude sends "PreToolUse".
 */
const GROK_EVENT_MAP: Record<string, HookInput['hook_event_name']> = {
  pre_tool_use: 'PreToolUse',
  post_tool_use: 'PostToolUse',
  post_tool_use_failure: 'PostToolUse',
  user_prompt_submit: 'UserPromptSubmit',
  session_start: 'SessionStart',
  session_end: 'SessionEnd',
  stop: 'Stop',
  notification: 'Notification',
  pre_compact: 'PreCompact',
};

/**
 * Grok Build tool names → Claude canonical tool names.
 * Only the names sqlew's hook handlers branch on need mapping; unknown names pass through.
 */
const GROK_TOOL_MAP: Record<string, string> = {
  enter_plan_mode: 'EnterPlanMode',
  exit_plan_mode: 'ExitPlanMode',
  search_replace: 'Edit',
  run_terminal_cmd: 'Bash',
  read_file: 'Read',
};

/** Codex CLI tool names mapped to Claude-shaped names used by sqlew hook handlers. */
const CODEX_TOOL_MAP: Record<string, string> = {
  shell_command: 'Bash',
  shell: 'Bash',
  exec_command: 'Bash',
  apply_patch: 'Edit',
  enter_plan_mode: 'EnterPlanMode',
  exit_plan_mode: 'ExitPlanMode',
};

const CODEX_NATIVE_TOOLS = new Set(Object.keys(CODEX_TOOL_MAP));

/**
 * Hermes (Claude Code / Nous) shell-hook event names (snake_case) →
 * sqlew canonical (Claude PascalCase) event names.
 *
 * Hermes has no dedicated UserPromptSubmit event; pre_llm_call fires at the
 * same point and is the only context-injection hook, so we map it to
 * UserPromptSubmit. post_llm_call is the closest analog to Claude's Stop.
 */
const HERMES_EVENT_MAP: Record<string, HookInput['hook_event_name']> = {
  pre_tool_call: 'PreToolUse',
  post_tool_call: 'PostToolUse',
  pre_llm_call: 'UserPromptSubmit',
  post_llm_call: 'Stop',
  on_session_start: 'SessionStart',
  on_session_end: 'SessionEnd',
  on_session_finalize: 'SessionEnd',
  subagent_stop: 'SubagentStop',
  subagent_start: 'PreToolUse',
};

/**
 * Hermes built-in tool names → sqlew canonical (Claude) tool names.
 * Only the names sqlew's hook handlers branch on need mapping; unknown
 * names pass through unchanged.
 */
const HERMES_TOOL_MAP: Record<string, string> = {
  terminal: 'Bash',
  write_file: 'Write',
  patch: 'Edit',
  read_file: 'Read',
  todo: 'TodoWrite',
  delegate_task: 'Task',
};

const HERMES_NATIVE_TOOLS = new Set(Object.keys(HERMES_TOOL_MAP));
const HERMES_NATIVE_EVENTS = new Set(Object.keys(HERMES_EVENT_MAP));

function isHermesPayload(raw: Record<string, unknown>): boolean {
  const event = raw.hook_event_name as string | undefined;
  if (event && HERMES_NATIVE_EVENTS.has(event)) {
    return true;
  }

  const tool = raw.tool_name as string | undefined;
  if (tool && HERMES_NATIVE_TOOLS.has(tool)) {
    return true;
  }

  // Claude/Codex use PascalCase event names; do not classify as Hermes even when
  // HERMES_* env vars are set in the parent shell (common on dev machines).
  if (event && /^[A-Z]/.test(event)) {
    return false;
  }

  const hasHermesEnv = !!(
    process.env.HERMES_SESSION_ID ||
    process.env.HERMES_HOME ||
    process.env._HERMES_GATEWAY
  );

  if (raw.extra && typeof raw.extra === 'object' && hasHermesEnv) {
    return true;
  }

  // Env-only fallback for empty or lifecycle payloads spawned by Hermes hooks.
  if (hasHermesEnv && !event && !tool) {
    // Empty stdin is ambiguous — prefer Codex/Grok env when those clients spawned the hook.
    if (process.env.CODEX_SESSION_ID || process.env.CODEX_CWD || process.env.CODEX_HOME) {
      return false;
    }
    if (process.env.GROK_HOOK_EVENT || process.env.GROK_WORKSPACE_ROOT) {
      return false;
    }
    return true;
  }

  return false;
}

function normalizeHermesPayload(raw: Record<string, unknown>): HookInput {
  const rawEvent = raw.hook_event_name as string | undefined;
  const rawTool = raw.tool_name as string | undefined;
  const toolInput = (raw.tool_input as ToolInput | undefined) ?? undefined;

  const normalizedToolInput: ToolInput | undefined = toolInput
    ? {
        ...toolInput,
        file_path:
          (toolInput.file_path as string | undefined) ??
          (toolInput.path as string | undefined),
      }
    : undefined;

  return {
    ...(raw as HookInput),
    client: 'hermes',
    hook_event_name: rawEvent
      ? HERMES_EVENT_MAP[rawEvent] || (rawEvent as HookInput['hook_event_name'])
      : (raw.hook_event_name as HookInput['hook_event_name']),
    tool_name: rawTool ? HERMES_TOOL_MAP[rawTool] || rawTool : (raw.tool_name as string | undefined),
    tool_input: normalizedToolInput,
    session_id: (raw.session_id || process.env.HERMES_SESSION_ID) as string | undefined,
    cwd: (raw.cwd || process.env.TERMINAL_CWD) as string | undefined,
  };
}

function extractCollaborationMode(raw: Record<string, unknown>): string | undefined {
  const direct = raw.collaboration_mode ?? raw.collaborationMode;
  if (typeof direct === 'string') {
    return direct;
  }
  if (direct && typeof direct === 'object') {
    const record = direct as Record<string, unknown>;
    if (typeof record.mode === 'string') {
      return record.mode;
    }
    if (typeof record.kind === 'string') {
      return record.kind;
    }
  }
  const kind = raw.collaboration_mode_kind ?? raw.collaborationModeKind;
  return typeof kind === 'string' ? kind : undefined;
}

function isCodexPayload(raw: Record<string, unknown>): boolean {
  const tool = (raw.tool_name || raw.toolName) as string | undefined;
  if (tool && CODEX_NATIVE_TOOLS.has(tool)) {
    return true;
  }
  if (extractCollaborationMode(raw)) {
    return true;
  }
  if (process.env.CODEX_SESSION_ID || process.env.CODEX_CWD || process.env.CODEX_HOME) {
    return true;
  }
  return false;
}

function normalizeCodexPayload(raw: Record<string, unknown>): HookInput {
  const rawTool = (raw.tool_name || raw.toolName) as string | undefined;
  const collaborationMode = extractCollaborationMode(raw);

  return {
    ...(raw as HookInput),
    client: 'codex',
    tool_name: rawTool ? CODEX_TOOL_MAP[rawTool] || rawTool : (raw.tool_name as string | undefined),
    tool_input: (raw.tool_input || raw.toolInput) as ToolInput | undefined,
    session_id: (raw.session_id || raw.sessionId || process.env.CODEX_SESSION_ID) as string | undefined,
    cwd: (raw.cwd || process.env.CODEX_CWD || process.env.CLAUDE_PROJECT_DIR) as string | undefined,
    transcript_path: (raw.transcript_path || raw.transcriptPath) as string | undefined,
    collaboration_mode: collaborationMode,
    permission_mode:
      (raw.permission_mode as string | undefined) ||
      (collaborationMode?.toLowerCase() === 'plan' ? 'plan' : (raw.permission_mode as string | undefined)),
  };
}

/**
 * Normalize a raw hook payload into the canonical (Claude-shaped) HookInput.
 *
 * Claude Code payloads already use snake_case keys + PascalCase event/tool names,
 * so they pass through unchanged (backward compatible). Grok Build payloads use
 * camelCase keys (`hookEventName`/`toolName`/`toolInput`/`sessionId`) and snake_case
 * event/tool values, which are translated here so every downstream handler keeps
 * working without modification.
 *
 * @param raw - Parsed JSON from stdin (any shape)
 * @returns Canonical HookInput
 */
export function normalizeHookInput(raw: unknown): HookInput {
  if (!raw || typeof raw !== 'object') {
    raw = {};
  }
  const r = raw as Record<string, unknown>;

  const isGrok = !!(
    r.hookEventName ||
    r.toolName ||
    r.toolInput ||
    r.workspaceRoot ||
    r.sessionId ||
    process.env.GROK_HOOK_EVENT ||
    process.env.GROK_WORKSPACE_ROOT
  );

  if (isGrok) {
    // Grok branch below
  } else if (isHermesPayload(r)) {
    return normalizeHermesPayload(r);
  } else if (isCodexPayload(r)) {
    return normalizeCodexPayload(r);
  } else {
    // Claude / native: pass through unchanged
    return r as HookInput;
  }

  const rawEvent = (r.hookEventName || r.hook_event_name || process.env.GROK_HOOK_EVENT) as
    | string
    | undefined;
  const rawTool = (r.toolName || r.tool_name) as string | undefined;

  return {
    ...(r as HookInput),
    client: 'grok',
    hook_event_name: rawEvent
      ? GROK_EVENT_MAP[rawEvent] || (rawEvent as HookInput['hook_event_name'])
      : (r.hook_event_name as HookInput['hook_event_name']),
    tool_name: rawTool ? GROK_TOOL_MAP[rawTool] || rawTool : (r.tool_name as string | undefined),
    tool_input: (r.toolInput || r.tool_input) as ToolInput | undefined,
    session_id: (r.sessionId || r.session_id || process.env.GROK_SESSION_ID) as string | undefined,
    // Grok provides cwd + workspaceRoot (equal); fall back to env for empty-stdin events.
    cwd: (r.cwd || r.workspaceRoot || process.env.GROK_WORKSPACE_ROOT) as string | undefined,
  };
}

/**
 * Build the absolute path to a Grok Build session plan file.
 *
 * Grok stores per-session plans at:
 *   ~/.grok/sessions/<encodeURIComponent(workspaceRoot)>/<sessionId>/plan.md
 *
 * IMPORTANT: encodeURIComponent is applied to the RAW workspace path string
 * (backslashes included on Windows → `C:\...` becomes `C%3A%5C...`), matching
 * the directory names Grok actually creates. Do not slash-normalize beforehand.
 *
 * @param workspaceRoot - Grok workspace root (cwd / workspaceRoot)
 * @param sessionId - Grok session id (UUID-like; sanitized to prevent path traversal)
 * @returns Absolute path to the session's plan.md, or null if sessionId is invalid
 */
export function computeGrokPlanPath(workspaceRoot: string, sessionId: string): string | null {
  // Sanitize sessionId: it is interpolated into a filesystem path, so restrict it to
  // the characters a real Grok session id uses (UUID: hex + hyphen). This blocks any
  // path-traversal payload (`..`, separators) from escaping ~/.grok/sessions/.
  if (!sessionId || !/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    return null;
  }
  // encodeURIComponent encodes every path separator in workspaceRoot, so it collapses
  // to a single safe path segment (no traversal possible from the workspace part), and
  // sessionId is allowlisted above — both inputs are validated before this join.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  return join(homedir(), '.grok', 'sessions', encodeURIComponent(workspaceRoot), sessionId, 'plan.md');
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
        // Empty stdin - still normalize so env-based context (Grok GROK_* vars) is picked up
        resolve(normalizeHookInput({}));
        return;
      }

      try {
        const parsed = JSON.parse(data);
        resolve(normalizeHookInput(parsed));
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
  // Grok Build: PreToolUse hooks deliver reason via stdout deny JSON (stderr is not shown).
  if (process.env.GROK_HOOK_EVENT || process.env.GROK_WORKSPACE_ROOT) {
    console.log(JSON.stringify({ decision: 'deny', reason }));
  }
  // Hermes: pre_tool_call block is read from stdout JSON (decision/block shape).
  if (process.env.HERMES_SESSION_ID || process.env.HERMES_HOME || process.env._HERMES_GATEWAY) {
    console.log(JSON.stringify({ decision: 'block', reason }));
  }
  console.error(reason);
  process.exit(2);
}

/**
 * Emit a Hermes shell-hook context-injection response.
 * Hermes honors {"context": "..."} only on pre_llm_call.
 */
export function sendHermesContext(context: string): void {
  console.log(JSON.stringify({ context }));
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
  // Claude Code / Codex collaboration Plan mode
  if (input.permission_mode === 'plan') return true;
  if (input.collaboration_mode?.toLowerCase() === 'plan') return true;

  // Grok Build: plan mode is signaled via the enter_plan_mode / exit_plan_mode tools
  // (no permission_mode field). normalizeHookInput() maps these to the Claude-shaped
  // EnterPlanMode / ExitPlanMode before any detection runs, so match the normalized
  // names. Raw snake_case names are also accepted defensively for callers that
  // bypass normalization.
  const tool = input.tool_name;
  if (
    tool === 'EnterPlanMode' ||
    tool === 'ExitPlanMode' ||
    tool === 'enter_plan_mode' ||
    tool === 'exit_plan_mode'
  ) {
    return true;
  }

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
 * - Project: .claude/plans/*.md or .hermes/plans/*.md (relative path)
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

  // Match global + project-local plan paths for Claude (.claude/plans/) and
  // Hermes (.hermes/plans/).
  return /[/\\]?\.(claude|hermes)\/plans\/[^/]+\.md$/.test(normalizedPath);
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
  return (
    input.cwd ||
    process.env.CLAUDE_PROJECT_DIR ||
    process.env.CODEX_CWD ||
    process.env.GROK_WORKSPACE_ROOT ||
    process.env.TERMINAL_CWD
  );
}

/**
 * Returns the best available absolute path to the currently tracked plan file.
 *
 * Priority:
 * 1. Explicit plan_path stored in CurrentPlanInfo (Grok Build, future envs)
 * 2. Resolved via legacy plan_file + environment-specific resolver (Claude)
 *
 * This is the function external adapters (sqlew-grok etc.) should prefer over
 * manually calling resolvePlanPath.
 */
export function getActivePlanFilePath(projectPath: string): string | null {
  const info = loadCurrentPlan(projectPath);
  if (!info) return null;

  if (info.plan_path && existsSync(info.plan_path)) {
    return info.plan_path;
  }

  // Fallback to legacy resolution (Claude global plans dir)
  return resolvePlanPath(info.plan_file);
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
