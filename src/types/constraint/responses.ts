/**
 * Constraint tool response types
 */

import type { TaggedConstraint } from '../view-entities.js';

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
