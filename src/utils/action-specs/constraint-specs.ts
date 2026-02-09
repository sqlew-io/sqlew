/**
 * Constraint Tool Action Specifications
 *
 * Parameter requirements and examples for all constraint tool actions (5 actions).
 * Used for architectural rules with priority and metadata.
 */

import { ActionSpec } from './types.js';

export const CONSTRAINT_ACTION_SPECS: Record<string, ActionSpec> = {
  add: {
    required: ['category', 'constraint_text', 'priority'],
    optional: ['layer', 'tags', 'created_by', 'active'],
    example: {
      action: 'add',
      category: 'performance',
      constraint_text: 'API response time must be <100ms for 95th percentile',
      priority: 'high',
      layer: 'business',
      tags: ['api', 'latency']
    },
    hint: "Valid categories: performance, architecture, security, code-style. Valid priorities: low, medium, high, critical (or 1-4). Set active=false for draft constraints. NOTE: rationale is NOT supported - include it in tags or constraint_text if needed."
  },

  get: {
    required: [],
    optional: ['category', 'layer', 'priority', 'tags', 'limit', 'include_inactive'],
    example: {
      action: 'get',
      category: 'performance',
      priority: 'high',
      limit: 50
    },
    hint: "Returns only active constraints by default. Set include_inactive=true to show all."
  },

  activate: {
    required: ['id'],
    optional: [],
    example: {
      action: 'activate',
      id: 5
    },
    hint: "Activate an inactive constraint by ID (constraint_id also accepted for backward compatibility)"
  },

  deactivate: {
    required: ['id'],
    optional: [],
    example: {
      action: 'deactivate',
      id: 'fbb982cc-764f-4427-b34a-7e758e31c457'  // UUID for SaaS, number for SQLite
    },
    hint: "Soft delete - constraint remains in database but marked inactive. Use number for SQLite, UUID string for SaaS. constraint_id also accepted for backward compatibility."
  },

  suggest_pending: {
    required: [],
    optional: ['project_path'],
    example: {
      action: 'suggest_pending'
    },
    hint: "Returns pending constraint candidates from plan TOML cache. No DB access - reads from session cache only."
  }
};
