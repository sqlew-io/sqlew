/**
 * MCP Server - Tool Schemas (Zod)
 * Source of truth for tool input validation and JSON Schema generation.
 *
 * Each schema corresponds to one MCP tool. The Zod schema is used by:
 * 1. registerTool() for automatic input validation
 * 2. toJSONSchema() for ListTools response generation
 *
 * additionalProperties strategy:
 * - decision, constraint: .passthrough() — action-specific params vary per action
 * - help, example, use_case: default (strip) — all params explicitly defined
 * - suggest, queue: .strict() — closed set, unknown params rejected
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared: per-call project scope (desktop AI agents / multi-project)
// Reserved parameter `_sqlew_project` targets a specific project for this call,
// overriding the startup-detected project. Resolved by root path, name, or ref.
// ---------------------------------------------------------------------------
export const projectContextSchema = z.object({
  _sqlew_project: z.object({
    root: z.string().describe('Absolute path to the project root (repo directory)').optional(),
    name: z.string().describe('Project name registered in m_projects').optional(),
    ref: z.string().describe('Stable project ref from the "project" tool (e.g. "sqlew_proj_3")').optional(),
    allow_create: z.boolean().describe('Allow creating a new project when resolving by name').optional(),
  }).describe('Per-call project target (overrides startup detection). Use the "project" tool to obtain a ref.').optional(),
});

// ---------------------------------------------------------------------------
// decision: action enum + passthrough (additionalProperties: true)
// ---------------------------------------------------------------------------
export const decisionSchema = z.object({
  action: z.enum([
    'set', 'get', 'list', 'search_tags', 'search_layer', 'versions',
    'quick_set', 'search_advanced', 'set_batch', 'has_updates',
    'set_from_template', 'create_template', 'list_templates', 'hard_delete',
    'add_decision_context', 'list_decision_contexts', 'analytics',
    'create_policy', 'list_policies', 'set_from_policy',
    'help', 'example', 'use_case',
  ]).describe('Action'),
}).merge(projectContextSchema).passthrough();

// ---------------------------------------------------------------------------
// constraint: action enum + passthrough (additionalProperties: true)
// ---------------------------------------------------------------------------
export const constraintSchema = z.object({
  action: z.enum([
    'add', 'get', 'deactivate', 'suggest_pending',
    'help', 'example', 'use_case',
  ]).describe('Action'),
}).merge(projectContextSchema).passthrough();

// ---------------------------------------------------------------------------
// help: all params explicitly defined (additionalProperties: false by default)
// ---------------------------------------------------------------------------
export const helpSchema = z.object({
  action: z.enum([
    'query_action', 'query_params', 'query_tool', 'workflow_hints',
    'batch_guide', 'error_recovery', 'help', 'example',
  ]).describe('Help action to perform'),
  tool: z.string().describe('Target tool name (for query_action, query_params, query_tool, workflow_hints)').optional(),
  target_action: z.string().describe('Target action name (for query_action, query_params)').optional(),
  current_action: z.string().describe('Current action name (for workflow_hints)').optional(),
  operation: z.string().describe('Batch operation name in format "tool.action" (for batch_guide)').optional(),
  error_message: z.string().describe('Error message to analyze (for error_recovery)').optional(),
});

// ---------------------------------------------------------------------------
// example: all params explicitly defined (additionalProperties: false by default)
// ---------------------------------------------------------------------------
export const exampleSchema = z.object({
  action: z.enum([
    'get', 'search', 'list_all', 'help', 'example',
  ]).describe('Example action to perform'),
  tool: z.string().describe('Filter by tool name (for get, search, list_all)').optional(),
  action_name: z.string().describe('Filter by action name (for get, search)').optional(),
  topic: z.string().describe('Search by topic in title or explanation (for get)').optional(),
  keyword: z.string().describe('Keyword to search (for search)').optional(),
  complexity: z.string().describe('Filter by complexity: basic|intermediate|advanced (for search, list_all)').optional(),
  limit: z.number().describe('Maximum results to return (default: 20, for list_all)').optional(),
  offset: z.number().describe('Result offset for pagination (default: 0, for list_all)').optional(),
});

// ---------------------------------------------------------------------------
// use_case: all params explicitly defined (additionalProperties: false by default)
// ---------------------------------------------------------------------------
export const useCaseSchema = z.object({
  action: z.enum([
    'get', 'search', 'list_all', 'help', 'example',
  ]).describe('Use case action to perform'),
  use_case_id: z.number().describe('Use case ID to retrieve (for get)').optional(),
  keyword: z.string().describe('Search keyword - searches title and description (for search)').optional(),
  category: z.string().describe('Filter by category (optional for search, list_all)').optional(),
  complexity: z.enum(['basic', 'intermediate', 'advanced']).describe('Filter by complexity level').optional(),
  limit: z.number().describe('Maximum results to return (default: 20, for list_all)').optional(),
  offset: z.number().describe('Result offset for pagination (default: 0, for list_all)').optional(),
});

// ---------------------------------------------------------------------------
// suggest: strict (additionalProperties: false)
// ---------------------------------------------------------------------------
export const suggestSchema = z.object({
  action: z.enum([
    'by_key', 'by_tags', 'by_context', 'check_duplicate', 'help',
  ]).describe('Suggestion action to perform'),
  target: z.enum(['decision', 'constraint']).describe('Target type for suggestions (default: decision)').optional(),
  key: z.string().describe('Decision key (for by_key, by_context, check_duplicate when target=decision)').optional(),
  text: z.string().describe('Constraint text to search (for by_key, by_context, check_duplicate when target=constraint)').optional(),
  constraint_text: z.string().describe('Alias for text parameter (constraint text to search)').optional(),
  category: z.string().describe('Constraint category filter (optional, when target=constraint)').optional(),
  tags: z.array(z.string()).describe('Tags array (for by_tags, by_context)').optional(),
  layer: z.string().describe('Layer filter (optional)').optional(),
  priority: z.number().describe('Priority level (optional)').optional(),
  limit: z.number().describe('Max suggestions (default: 5)').optional(),
  min_score: z.number().describe('Minimum relevance score (default: 30)').optional(),
}).merge(projectContextSchema).strict();

// ---------------------------------------------------------------------------
// queue: strict (additionalProperties: false)
// ---------------------------------------------------------------------------
export const queueSchema = z.object({
  action: z.enum([
    'list', 'clear', 'remove', 'help', 'example',
  ]).describe('Queue action to perform'),
  index: z.number().describe('Item index for remove action (0-based)').optional(),
}).merge(projectContextSchema).strict();

// ---------------------------------------------------------------------------
// project: per-call project resolution for desktop AI agents (strict)
// ---------------------------------------------------------------------------
export const projectSchema = z.object({
  action: z.enum([
    'current', 'resolve', 'list', 'validate', 'help', 'example',
  ]).describe('Project action to perform'),
  root: z.string().describe('Absolute path to the project root (for resolve, validate)').optional(),
  name: z.string().describe('Project name (for resolve, validate)').optional(),
  ref: z.string().describe('Stable project ref, e.g. "sqlew_proj_3" (for resolve, validate)').optional(),
  allow_create: z.boolean().describe('Allow creating a new project when resolving by name').optional(),
}).strict();

// ---------------------------------------------------------------------------
// Aggregated exports
// ---------------------------------------------------------------------------

/** Tool name → Zod schema mapping */
export const TOOL_SCHEMAS: Record<string, z.ZodType> = {
  decision: decisionSchema,
  constraint: constraintSchema,
  project: projectSchema,
  help: helpSchema,
  example: exampleSchema,
  use_case: useCaseSchema,
  suggest: suggestSchema,
  queue: queueSchema,
};

/** Tool name → description mapping */
export const TOOL_DESCRIPTIONS: Record<string, string> = {
  decision: 'Context Management - Store decisions with versioning and metadata. Use action: "help" for documentation.',
  constraint: 'Architectural Rules - Define and manage project constraints with priorities. Use action: "help" for documentation.',
  project: `Project Resolution - Target a specific project per tool call (desktop AI agents / multi-project).

Actions:
- current: Show the active project (or unbound status)
- resolve: Resolve/register a project by root path or name; returns a stable ref
- list: List all registered projects
- validate: Check whether a root/name/ref resolves cleanly (read-only)

Desktop flow: call project.resolve { root } once, then pass _sqlew_project: { ref } on subsequent decision/constraint calls. Use action: "help" for documentation.`,
  help: `**REQUIRED PARAMETER**: action (must be specified in ALL calls)

Help System - Query action documentation, parameters, and workflow guidance

Actions:
- query_action: Get action documentation with parameters and examples
- query_params: Get parameter list only (quick reference)
- query_tool: Get tool overview and all actions
- workflow_hints: Get common next actions after current action
- batch_guide: Get guidance for batch operations
- error_recovery: Analyze errors and suggest fixes

Use this tool to understand how to use other sqlew tools. Returns only requested information (80-95% token reduction vs legacy help).`,
  example: `**REQUIRED PARAMETER**: action (must be specified in ALL calls)

Example System - Browse and search code examples for sqlew tools

Actions:
- get: Get examples by tool, action, or topic
- search: Search examples by keyword
- list_all: List all available examples with filtering

Use this tool to find working code snippets. Returns only requested examples (token-efficient).`,
  use_case: `**REQUIRED PARAMETER**: action (must be specified in ALL calls)

Use Case Catalog - Browse and search complete workflow scenarios

Actions:
- get: Get complete use case workflow by ID
- search: Search use cases by keyword/category
- list_all: List all use cases with filtering and pagination

Use this tool to learn end-to-end workflows and multi-step operations. Returns workflow steps with executable code examples.`,
  suggest: 'Intelligent decision/constraint suggestion system. Find related decisions by key pattern, tags, or full context. Prevents duplicates and ensures consistency.',
  queue: 'Hook queue management - list, clear, remove pending items from .sqlew/queue/pending.json. Use action: "help" for documentation.',
};
