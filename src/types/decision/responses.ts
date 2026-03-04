/**
 * Decision tool response types
 */

import type { TaggedDecision } from '../view-entities.js';
import type { ExportBlocks, ExportFormat } from './export.js';

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
