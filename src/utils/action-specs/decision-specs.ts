/**
 * Decision Tool Action Specifications
 *
 * Parameter requirements and examples for all decision tool actions (16 actions).
 * Used for context management with metadata, version history, and rich context.
 */

import { ActionSpec } from './types.js';

export const DECISION_ACTION_SPECS: Record<string, ActionSpec> = {
  set: {
    required: ['key', 'value'],
    optional: ['agent', 'layer', 'tags', 'status', 'version', 'scopes', 'ignore_suggest', 'ignore_reason'],
    example: {
      action: 'set',
      key: 'database/postgresql-choice',
      value: 'Selected PostgreSQL over MongoDB because of complex relational queries and ACID compliance requirements',
      layer: 'data',
      tags: ['database', 'architecture'],
      status: 'active',
      version: '1.0.0'
    },
    hint: "Use 'quick_set' for simpler usage with auto-inferred metadata"
  },

  get: {
    required: ['key'],
    optional: ['include_context'],
    example: {
      action: 'get',
      key: 'database/postgresql-choice',
      include_context: true
    },
    hint: "Set include_context=true to get attached rationale and alternatives"
  },

  list: {
    required: [],
    optional: ['status', 'layer', 'tags', 'scope', 'tag_match', 'limit', 'offset', 'full_value', '_reference_project'],
    example: {
      action: 'list',
      status: 'active',
      layer: 'business',
      limit: 20
    },
    hint: "Values are truncated to 30 chars by default. Use full_value=true for complete text."
  },

  search_tags: {
    required: ['tags'],
    optional: ['match_mode', 'status', 'layer', 'full_value'],
    example: {
      action: 'search_tags',
      tags: ['security', 'authentication'],
      match_mode: 'AND',
      status: 'active'
    },
    hint: "Use match_mode='AND' to find decisions with ALL tags, 'OR' for ANY tag. Values truncated to 30 chars; use full_value=true for complete text."
  },

  search_layer: {
    required: ['layer'],
    optional: ['status', 'include_tags', 'full_value', '_reference_project'],
    example: {
      action: 'search_layer',
      layer: 'business',
      status: 'active',
      include_tags: true
    },
    hint: "Valid layers: presentation, business, data, infrastructure, cross-cutting, planning, documentation, coordination, review. Values truncated to 30 chars; use full_value=true for complete text."
  },

  versions: {
    required: ['key'],
    optional: [],
    example: {
      action: 'versions',
      key: 'database/postgresql-choice'
    },
    hint: "Returns version history with timestamps and who made changes"
  },

  quick_set: {
    required: ['key', 'value'],
    optional: ['agent', 'layer', 'version', 'status', 'tags', 'scopes'],
    example: {
      action: 'quick_set',
      key: 'api/instruments/oscillator-refactor',
      value: 'Moved oscillator_type to MonophonicSynthConfig for better separation'
    },
    hint: "Auto-infers layer from key prefix (api/*→presentation, db/*→data, service/*→business). Reduces required parameters from 7 to 2."
  },

  search_advanced: {
    required: [],
    optional: [
      'layers', 'tags_all', 'tags_any', 'exclude_tags', 'scopes',
      'updated_after', 'updated_before', 'decided_by', 'statuses',
      'search_text', 'sort_by', 'sort_order', 'limit', 'offset', 'full_value'
    ],
    example: {
      action: 'search_advanced',
      layers: ['business', 'data'],
      tags_all: ['breaking'],
      updated_after: '2025-01-01',
      sort_by: 'updated',
      sort_order: 'desc',
      limit: 20
    },
    hint: "Use tags_all for AND logic, tags_any for OR logic. Values truncated to 30 chars; use full_value=true for complete text. Aliases: after→updated_after, before→updated_before"
  },

  set_batch: {
    required: ['decisions'],
    optional: ['atomic'],
    example: {
      action: 'set_batch',
      decisions: [
        { key: 'cache/redis-choice', value: 'Using Redis for session storage', layer: 'infrastructure' },
        { key: 'cache/ttl', value: '3600', layer: 'infrastructure' }
      ],
      atomic: false
    },
    hint: "Use atomic:false for best-effort batch operations (recommended for AI agents). Set atomic:true only when all-or-nothing is required. Max 50 decisions per batch."
  },

  has_updates: {
    required: ['since_timestamp'],
    optional: ['agent_name'],  // Legacy parameter, not used in v4
    example: {
      action: 'has_updates',
      since_timestamp: '2025-10-14T08:00:00Z'
    },
    hint: "Lightweight polling mechanism (~5-10 tokens per check). Use ISO 8601 timestamp format."
  },

  set_from_template: {
    required: ['template', 'key', 'value'],
    optional: ['agent', 'layer', 'version', 'status', 'tags', 'scopes'],
    example: {
      action: 'set_from_template',
      template: 'breaking_change',
      key: 'api/remove-legacy-endpoint',
      value: 'Removed /v1/users endpoint - migrate to /v2/users'
    },
    hint: "Built-in templates: breaking_change, security_vulnerability, performance_optimization, deprecation, architecture_decision"
  },

  create_template: {
    required: ['name', 'defaults'],
    optional: ['required_fields', 'created_by'],
    example: {
      action: 'create_template',
      name: 'bug_fix',
      defaults: {
        layer: 'business',
        tags: ['bug', 'fix'],
        status: 'active'
      },
      created_by: 'team-lead'
    },
    hint: "Templates enable reusable decision patterns with consistent metadata"
  },

  list_templates: {
    required: [],
    optional: [],
    example: {
      action: 'list_templates'
    },
    hint: "Returns both built-in and custom templates"
  },

  hard_delete: {
    required: ['key'],
    optional: [],
    example: {
      action: 'hard_delete',
      key: 'old-test-decision'
    },
    hint: "⚠️ IRREVERSIBLE! Permanently deletes decision and all history. Use for cleanup after migration or removing sensitive data."
  },

  add_decision_context: {
    required: ['key', 'rationale'],
    optional: ['alternatives_considered', 'tradeoffs', 'decided_by', 'related_task_id', 'related_constraint_id'],
    example: {
      action: 'add_decision_context',
      key: 'database/postgresql-choice',
      rationale: 'PostgreSQL chosen for ACID compliance and complex query support',
      alternatives_considered: ['MongoDB', 'MySQL', 'SQLite'],
      tradeoffs: {
        pros: ['Strong ACID compliance', 'Advanced query features'],
        cons: ['Slightly higher resource usage', 'Steeper learning curve']
      },
      decided_by: 'architecture-team'
    },
    hint: "Add rich context explaining WHY decisions were made. Aliases: alternatives→alternatives_considered, task_id→related_task_id, constraint_id→related_constraint_id"
  },

  list_decision_contexts: {
    required: [],
    optional: ['decision_key', 'related_task_id', 'related_constraint_id', 'decided_by', 'limit', 'offset'],
    example: {
      action: 'list_decision_contexts',
      decision_key: 'database/postgresql-choice',
      limit: 50
    },
    hint: "Query decision contexts with optional filters for traceability. Alias: key→decision_key"
  },

  analytics: {
    required: ['key_pattern', 'aggregation'],
    optional: ['layer', 'time_series', 'percentiles'],
    example: {
      action: 'analytics',
      key_pattern: 'metric/api-latency/%',
      aggregation: 'avg',
      layer: 'infrastructure'
    },
    hint: "Aggregates numeric decisions only. Valid aggregation values: avg, sum, max, min, count."
  }
};
