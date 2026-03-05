/**
 * Transaction table entity interfaces (t_ prefix tables)
 */

import { MessageType, Priority, Status } from './enums.js';

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
