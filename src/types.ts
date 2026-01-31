/**
 * Type definitions for MCP Shared Context Server
 * Database entity interfaces and enum types
 */

import { Database } from 'better-sqlite3';

// ============================================================================
// Enums (matching schema integer values)
// ============================================================================

/**
 * Decision status enumeration
 * 1 = active, 2 = deprecated, 3 = draft, 4 = in_progress, 5 = in_review, 6 = implemented
 */
export enum Status {
  ACTIVE = 1,
  DEPRECATED = 2,
  DRAFT = 3,
  IN_PROGRESS = 4,
  IN_REVIEW = 5,
  IMPLEMENTED = 6,
}

/**
 * Valid status string values for API parameters
 * Matches STRING_TO_STATUS keys in constants.ts
 */
export type StatusString = 'active' | 'deprecated' | 'draft' | 'in_progress' | 'in_review' | 'implemented';

/**
 * Message type enumeration
 * 1 = decision, 2 = warning, 3 = request, 4 = info
 */
export enum MessageType {
  DECISION = 1,
  WARNING = 2,
  REQUEST = 3,
  INFO = 4,
}

/**
 * Priority level enumeration
 * 1 = low, 2 = medium, 3 = high, 4 = critical
 */
export enum Priority {
  LOW = 1,
  MEDIUM = 2,
  HIGH = 3,
  CRITICAL = 4,
}

// ============================================================================
// Parameter Validation Types
// ============================================================================

/**
 * Concise validation error for MCP tool parameter validation
 * Designed for token efficiency - references examples via ID instead of embedding full objects
 *
 * Example output: "Missing: key, value. See: decision.set"
 */
export interface ValidationError {
  error: string;                   // Concise error message (e.g., "Missing: key, value")
  action: string;                  // Action name (e.g., "set")
  reference: string;               // Reference ID for full docs (e.g., "decision.set")
  missing?: string[];              // Missing required params (only if present)
  typos?: Record<string, string>;  // Typo suggestions: provided → correct (only if detected)
  hint?: string;                   // Short actionable hint from spec
}

// ============================================================================
// Master Table Entities
// ============================================================================

export interface Agent {
  readonly id: number;
  readonly name: string;
}

export interface ContextKey {
  readonly id: number;
  readonly key: string;
}

export interface ConstraintCategory {
  readonly id: number;
  readonly name: string;
}

export interface Layer {
  readonly id: number;
  readonly name: string;
}

export interface Tag {
  readonly id: number;
  readonly name: string;
}

export interface Scope {
  readonly id: number;
  readonly name: string;
}

// ============================================================================
// Transaction Table Entities
// ============================================================================

export interface Decision {
  readonly key_id: number;
  readonly value: string;
  readonly agent_id: number | null;
  readonly layer_id: number | null;
  readonly version: string;
  readonly status: Status;
  readonly ts: number;
}

export interface DecisionNumeric {
  readonly key_id: number;
  readonly value: number;
  readonly agent_id: number | null;
  readonly layer_id: number | null;
  readonly version: string;
  readonly status: Status;
  readonly ts: number;
}

export interface DecisionHistory {
  readonly id: number;
  readonly key_id: number;
  readonly version: string;
  readonly value: string;
  readonly agent_id: number | null;
  readonly ts: number;
}

export interface DecisionTag {
  readonly decision_key_id: number;
  readonly tag_id: number;
}

export interface DecisionScope {
  readonly decision_key_id: number;
  readonly scope_id: number;
}

export interface AgentMessage {
  readonly id: number;
  readonly from_agent_id: number;
  readonly to_agent_id: number | null;  // NULL = broadcast
  readonly msg_type: MessageType;
  readonly priority: Priority;
  readonly payload: string | null;  // JSON string
  readonly ts: number;
  readonly read: number;  // SQLite boolean: 0 or 1
}

export interface Constraint {
  readonly id: number;
  readonly category_id: number;
  readonly layer_id: number | null;
  readonly constraint_text: string;
  readonly priority: Priority;
  readonly active: number;  // SQLite boolean: 0 or 1
  readonly created_by: number | null;
  readonly ts: number;
}

export interface ConstraintTag {
  readonly constraint_id: number;
  readonly tag_id: number;
}

export interface ActivityLog {
  readonly id: number;
  readonly ts: number;
  readonly agent_id: number;
  readonly action_type: string;  // 'decision_set', 'decision_update', 'message_send', 'file_record'
  readonly target: string;
  readonly layer_id: number | null;
  readonly details: string | null;  // JSON string
}

export interface DecisionTemplate {
  readonly id: number;
  readonly name: string;
  readonly defaults: string;  // JSON string: {layer, status, tags, priority}
  readonly required_fields: string | null;  // JSON array: ["cve_id", "severity"]
  readonly created_by: number | null;
  readonly ts: number;
}

// ============================================================================
// View Result Types
// ============================================================================

export interface TaggedDecision {
  readonly key: string;
  readonly value: string;
  readonly version: string;
  readonly status: StatusString;
  readonly layer: string | null;
  readonly tags: string | null;  // Comma-separated
  readonly scopes: string | null;  // Comma-separated
  readonly decided_by: string | null;
  readonly updated: string;  // ISO 8601 datetime
  readonly project_id: number;  // Multi-project support (v3.7.0)
}

export interface ActiveContext {
  readonly key: string;
  readonly value: string;
  readonly version: string;
  readonly layer: string | null;
  readonly decided_by: string | null;
  readonly updated: string;  // ISO 8601 datetime
}

export interface LayerSummary {
  readonly layer: string;
  readonly decisions_count: number;
  readonly constraints_count: number;
}

export interface UnreadMessagesByPriority {
  readonly agent: string;
  readonly priority: 'critical' | 'high' | 'medium' | 'low';
  readonly count: number;
}

export interface TaggedConstraint {
  readonly id: number | string;  // number for SQLite, UUID string for SaaS (v5.0.0)
  readonly category: string;
  readonly layer: string | null;
  readonly constraint_text: string;
  readonly priority: 'critical' | 'high' | 'medium' | 'low';
  readonly tags: string | null;  // Comma-separated
  readonly created_by: string | null;
  readonly created_at: string;  // ISO 8601 datetime
}

// ============================================================================
// MCP Tool Parameter Types
// ============================================================================

export interface SetDecisionParams {
  key: string;
  value: string | number;
  agent?: string;
  layer?: string;
  version?: string;
  auto_increment?: 'major' | 'minor' | 'patch';
  status?: StatusString;
  tags?: string[];
  scopes?: string[];
  // Policy validation context (v3.9.0)
  rationale?: string;
  alternatives?: any[];
  tradeoffs?: any;
  policy_name?: string;  // Explicit policy to validate against
  // Constraint suggestion (v4.1.0)
  suggest_constraints?: boolean;  // If true, suggest related constraints after decision creation
}

export interface QuickSetDecisionParams {
  key: string;
  value: string | number;
  agent?: string;
  layer?: string;
  version?: string;
  status?: StatusString;
  tags?: string[];
  scopes?: string[];
}

export interface GetContextParams {
  tags?: string[];
  layer?: string;
  status?: StatusString;
  scope?: string;
  tag_match?: 'AND' | 'OR';
  full_value?: boolean;  // Return full value without truncation (default: false = 30 chars)
  _reference_project?: string;  // Cross-project query: project name to query instead of current project
}

export interface GetDecisionParams {
  key: string;
}

export interface HardDeleteDecisionParams {
  key: string;
}

export interface SearchByTagsParams {
  tags: string[];
  match_mode?: 'AND' | 'OR';
  status?: StatusString;
  layer?: string;
  full_value?: boolean;  // Return full value without truncation (default: false = 30 chars)
}

export interface GetVersionsParams {
  key: string;
}

export interface SearchByLayerParams {
  layer: string;
  status?: StatusString;
  include_tags?: boolean;
  full_value?: boolean;  // Return full value without truncation (default: false = 30 chars)
  _reference_project?: string;  // Cross-project query: project name to query instead of current project
}

export interface SearchAdvancedParams {
  layers?: string[];  // OR relationship - match any
  tags_all?: string[];  // AND relationship - must have ALL
  tags_any?: string[];  // OR relationship - must have ANY
  exclude_tags?: string[];  // Exclude these tags
  scopes?: string[];  // Wildcard support (e.g., "api/instruments/*")
  updated_after?: string;  // ISO timestamp or relative time ("7d")
  updated_before?: string;  // ISO timestamp or relative time
  decided_by?: string[];  // Array of agent names
  statuses?: StatusString[];  // Multiple statuses
  search_text?: string;  // Full-text search in value field
  sort_by?: 'updated' | 'key' | 'version';
  sort_order?: 'asc' | 'desc';
  limit?: number;  // Max results (default: 20)
  offset?: number;  // For pagination (default: 0)
  full_value?: boolean;  // Return full value without truncation (default: false = 30 chars)
}

export interface HasUpdatesParams {
  agent_name?: string;  // Optional since v4.1.2 (legacy sub-agent system removed)
  since_timestamp: string;  // ISO 8601 timestamp
}

// ============================================================================
// Export Types (v5.0.0 - SaaS-only document export)
// ============================================================================

/**
 * Output format for decision/constraint export
 */
export type ExportFormat = 'blocks' | 'markdown' | 'adr' | 'notion' | 'confluence';

/**
 * Parameters for decision:export action
 * SaaS-only feature for document generation
 */
export interface ExportDecisionParams {
  // Filter options (processed by SaaS)
  tags?: string[];          // Filter by tags (AND logic)
  layers?: string[];        // Filter by layers
  since?: string;           // ISO timestamp - decisions updated after this
  status?: StatusString[];  // Filter by status (active, draft, etc.)

  // Grouping (processed by SaaS)
  group_by?: 'layer' | 'tag' | 'none';

  // Output format
  format: ExportFormat;

  // Format-specific options
  include_metadata?: boolean;   // Include timestamps, versions in output
  include_context?: boolean;    // Include rationale/alternatives/tradeoffs
}

/**
 * Individual item in export blocks
 */
export interface ExportBlockItem {
  key: string;
  value: string;
  layer?: string;
  tags?: string[];
  version?: string;
  updated?: string;
  // Optional context
  rationale?: string;
  alternatives?: string[];
  tradeoffs?: string;
}

/**
 * Section block in export response
 */
export interface ExportBlockSection {
  type: 'section';
  title: string;
  items: ExportBlockItem[];
}

/**
 * Constraint in export response
 */
export interface ExportBlockConstraint {
  category: string;
  rule: string;
  priority: string;
  tags?: string[];
}

/**
 * Structured blocks response from SaaS
 */
export interface ExportBlocks {
  metadata: {
    exported_at: string;      // ISO timestamp
    total_decisions: number;
    total_constraints: number;
    filters_applied: Record<string, unknown>;
  };
  blocks: ExportBlockSection[];
  constraints?: ExportBlockConstraint[];
}

export interface AddConstraintParams {
  category: string;
  constraint_text: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  layer?: string;
  tags?: string[];
  created_by?: string;
  /** @since v4.2.1 - Set to false to create inactive constraint (for plan-based workflow) */
  active?: boolean;
}

export interface GetConstraintsParams {
  category?: string;
  layer?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  tags?: string[];
  include_inactive?: boolean;
  limit?: number;
}

export interface DeactivateConstraintParams {
  id: number | string;  // number for SQLite, UUID string for SaaS
}

// ============================================================================
// Batch Operation Parameter Types (FR-005)
// ============================================================================

export interface SetDecisionBatchParams {
  decisions: SetDecisionParams[];
  atomic?: boolean;  // Default: true (all succeed or all fail)
}

// ============================================================================
// Decision Template Parameter Types (FR-006)
// ============================================================================

export interface SetFromTemplateParams {
  template: string;  // Template name
  key: string;
  value: string | number;
  agent?: string;
  // Override template defaults if needed
  layer?: string;
  version?: string;
  status?: StatusString;
  tags?: string[];
  scopes?: string[];
  // Required fields (template-specific)
  [key: string]: any;
}

export interface CreateTemplateParams {
  name: string;
  defaults: {
    layer?: string;
    status?: StatusString;
    tags?: string[];
    priority?: 'low' | 'medium' | 'high' | 'critical';
  };
  required_fields?: string[];
  created_by?: string;
}

export interface ListTemplatesParams {
  // No parameters - returns all templates
}

// ============================================================================
// MCP Tool Response Types
// ============================================================================

export interface SetDecisionResponse {
  success: boolean;
  key: string;
  key_id: number;
  version: string;
  version_action?: 'initial' | 'explicit' | 'auto_increment_major' | 'auto_increment_minor' | 'auto_increment_patch';
  message?: string;
  value?: string | number; // Added for auto-update responses
  policy_validation?: {
    matched_policy?: string;
    violations?: string[];
  };
  suggestions?: {
    triggered_by: string;
    reason: string;
    suggestions: Array<{
      key: string;
      value: string;
      score: number;
      reason: string;
    }>;
  };
  // Auto-update metadata (v3.9.1 Tier 3)
  auto_updated?: boolean;
  requested_key?: string;
  actual_key?: string;
  similarity_score?: number;
  duplicate_reason?: {
    similarity: string;
    matched_tags: string[];
    layer?: string;
    key_pattern?: string;
  };
  // Related constraints (v4.1.0)
  related_constraints?: Array<{
    id: number;
    constraint_text: string;
    category: string;
    score: number;
    reason: string;
    layer?: string;
    tags?: string[];
  }>;
  // Human-readable warnings from SaaS backend (v5.0.0)
  warnings?: string[];
}

export interface QuickSetDecisionResponse {
  success: boolean;
  key: string;
  key_id: number;
  version: string;
  inferred: {
    layer?: string;
    tags?: string[];
    scope?: string;
  };
  message?: string;
  // Human-readable warnings from SaaS backend (v5.0.0)
  warnings?: string[];
}

export interface GetContextResponse {
  decisions: TaggedDecision[];
  count: number;
}

export interface GetDecisionResponse {
  found: boolean;
  decision?: TaggedDecision;
  context?: Array<{
    id: number;
    rationale: string;
    alternatives_considered: any;
    tradeoffs: any;
    decided_by: string | null;
    decision_date: string;
    related_task_id: number | null;
    related_constraint_id: number | null;
  }>;
  // Human-readable warnings from SaaS backend (v5.0.0)
  warnings?: string[];
}

export interface HardDeleteDecisionResponse {
  success: boolean;
  key: string;
  message?: string;
}

export interface SearchByTagsResponse {
  decisions: TaggedDecision[];
  count: number;
}

export interface GetVersionsResponse {
  key: string;
  history: Array<{
    version: string;
    value: string;
    // Note: agent field removed in v4.0 (agent tracking eliminated)
    timestamp: string;
  }>;
  count: number;
}

export interface SearchByLayerResponse {
  layer: string;
  decisions: TaggedDecision[];
  count: number;
}

export interface SearchAdvancedResponse {
  decisions: TaggedDecision[];
  count: number;
  total_count: number;  // Total matching records (for pagination)
}

export interface HasUpdatesResponse {
  has_updates: boolean;
  counts: {
    decisions: number;
  };
}

/**
 * Response for decision:export action
 * SaaS-only feature for document generation (v5.0.0)
 */
export interface ExportDecisionResponse {
  success: boolean;
  format: ExportFormat;
  content: string | ExportBlocks;  // blocks format returns object, others return string
  metadata: {
    total_decisions: number;
    total_constraints: number;
    exported_at: string;
  };
  // Human-readable warnings from SaaS backend
  warnings?: string[];
}

export interface AddConstraintResponse {
  success: boolean;
  constraint_id: number | string;  // number for SQLite, UUID string for SaaS
  already_exists?: boolean;
  // Human-readable warnings from SaaS backend (v5.0.0)
  warnings?: string[];
}

export interface GetConstraintsResponse {
  constraints: TaggedConstraint[];
  count: number;
  // Human-readable warnings from SaaS backend (v5.0.0)
  warnings?: string[];
}

export interface DeactivateConstraintResponse {
  success: boolean;
}

export interface GetStatsResponse {
  agents: number;
  context_keys: number;
  active_decisions: number;
  total_decisions: number;
  active_constraints: number;
  total_constraints: number;
  tags: number;
  scopes: number;
  layers: number;
}

export interface FlushWALResponse {
  success: boolean;
  mode: string;  // 'TRUNCATE'
  pages_flushed: number;
  message: string;
}

export interface ActivityLogEntry {
  id: number;
  timestamp: string;  // ISO 8601
  agent: string;
  action: string;
  target: string;
  layer: string | null;
  details: any;  // Parsed JSON
}

// ============================================================================
// Batch Operation Response Types (FR-005)
// ============================================================================

export interface SetDecisionBatchResponse {
  success: boolean;
  inserted: number;
  failed: number;
  results: Array<{
    key: string;
    key_id?: number;
    version?: string;
    success: boolean;
    error?: string;
  }>;
}

// ============================================================================
// Decision Template Response Types (FR-006)
// ============================================================================

export interface SetFromTemplateResponse {
  success: boolean;
  key: string;
  key_id: number;
  version: string;
  template_used: string;
  applied_defaults: {
    layer?: string;
    tags?: string[];
    status?: string;
  };
  message?: string;
}

export interface CreateTemplateResponse {
  success: boolean;
  template_id: number;
  template_name: string;
  message?: string;
}

export interface ListTemplatesResponse {
  templates: Array<{
    id: number;
    name: string;
    defaults: any;  // Parsed JSON
    required_fields: string[] | null;  // Parsed JSON array
    // Note: created_by field removed in v4.0 (agent tracking eliminated)
    created_at: string;
  }>;
  count: number;
}

// ============================================================================
// Parameter Validation Error Types (MCP Tool Usability Enhancement)
// ============================================================================

// Note: ValidationError interface is defined at the top of this file (lines 58-71)

/**
 * Action not found error
 * Thrown when an invalid action is specified
 */
export interface ActionNotFoundError {
  error: string;
  tool: string;
  action_provided: string;
  available_actions: string[];
  did_you_mean?: string[];  // Similar action suggestions
}

// ============================================================================
// MCP Tool Action Types (String Literal Unions for Compile-Time Safety)
// ============================================================================

/**
 * Decision tool actions
 * Provides compile-time type checking for action parameters without breaking MCP wire protocol
 */
export type DecisionAction =
  | 'set' | 'get' | 'list' | 'search_tags' | 'search_layer'
  | 'versions' | 'quick_set' | 'search_advanced' | 'set_batch'
  | 'has_updates' | 'set_from_template' | 'create_template'
  | 'list_templates' | 'hard_delete' | 'add_decision_context'
  | 'list_decision_contexts'
  | 'create_policy' | 'list_policies' | 'set_from_policy'  // v3.9.0 policy actions
  | 'analytics'  // v3.9.0 analytics action
  | 'export'  // v5.0.0 SaaS-only document export
  | 'help' | 'example' | 'use_case';

/**
 * Constraint tool actions
 * Provides compile-time type checking for action parameters
 */
export type ConstraintAction =
  | 'add' | 'get' | 'activate' | 'deactivate' | 'suggest_pending'
  | 'help' | 'example' | 'use_case';

/**
 * Config tool actions
 * Provides compile-time type checking for action parameters
 */
export type ConfigAction =
  | 'get' | 'update'
  | 'help' | 'example' | 'use_case';

/**
 * Example tool actions
 * Provides compile-time type checking for action parameters
 */
export type ExampleAction =
  | 'get' | 'search' | 'list_all'
  | 'help' | 'example';

// ============================================================================
// JSON Import System Types (v3.7.3)
// ============================================================================

/**
 * Options for JSON import operation
 */
export interface JsonImportOptions {
  /** Optional: Target project name (if not provided, uses name from JSON) */
  targetProjectName?: string;
  /** Optional: Skip import if project already exists (default: true) */
  skipIfExists?: boolean;
  /** Optional: Dry run mode - validate only, don't import (default: false) */
  dryRun?: boolean;
}

/**
 * JSON import validation result
 */
export interface ImportValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  schema_version?: number;
  sqlew_version?: string;
  export_mode?: 'single_project' | 'all_projects';
}

/**
 * ID mapping for a single master table
 * Maps old IDs (from export) to new IDs (in target database)
 */
export interface IdMapping extends Map<number, number> {}

/**
 * Complete ID mapping context for all master tables
 * Note: agents removed in v4.0, files/tasks removed in v5.0
 */
export interface ImportIdMappings {
  projects: IdMapping;
  context_keys: IdMapping;
  tags: IdMapping;
  scopes: IdMapping;
  constraint_categories: IdMapping;
  layers: IdMapping;
  decision_policies: IdMapping;  // v4.0+ table
}

/**
 * Import context - holds all state during import operation
 */
export interface ImportContext {
  /** Knex instance for database operations */
  knex: any;
  /** ID mappings for all tables */
  mappings: ImportIdMappings;
  /** Target project ID (created during import) */
  projectId: number;
  /** Source JSON data */
  jsonData: any;
  /** Import options */
  options: JsonImportOptions;
  /** Statistics (updated during import) */
  stats: ImportStats;
}

/**
 * Import statistics
 * Note: agents_created, activity_log_created removed in v4.0
 * Note: files/tasks related stats removed in v5.0
 */
export interface ImportStats {
  project_created: boolean;
  master_tables: {
    context_keys_created: number;
    tags_created: number;
    tags_reused: number;
    scopes_created: number;
    scopes_reused: number;
  };
  transaction_tables: {
    decisions_created: number;
    decisions_numeric_created: number;
    decision_history_created: number;
    decision_context_created: number;
    constraints_created: number;
    decision_policies_created: number;  // v4.0+ table
    tag_index_created: number;  // v4.0+ table
  };
  junction_tables: {
    decision_tags_created: number;
    decision_scopes_created: number;
    constraint_tags_created: number;
  };
}

/**
 * JSON import result
 */
export interface JsonImportResult {
  success: boolean;
  project_id?: number;
  project_name?: string;
  stats?: ImportStats;
  error?: string;
  skipped?: boolean;
  skip_reason?: string;
}

// ============================================================================
// Database Connection Type
// ============================================================================

export type { Database };
