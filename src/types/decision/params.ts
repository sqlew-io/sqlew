/**
 * Decision tool parameter types
 */

import type { StatusString } from '../enums.js';

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
