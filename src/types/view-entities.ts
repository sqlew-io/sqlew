/**
 * View/query result entity interfaces
 */

import type { StatusString } from './enums.js';

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
  readonly reason?: string | null;
  readonly priority: 'critical' | 'high' | 'medium' | 'low';
  readonly tags: string | null;  // Comma-separated
  readonly created_by: string | null;
  readonly created_at: string;  // ISO 8601 datetime
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
