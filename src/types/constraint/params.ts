/**
 * Constraint tool parameter types
 */

export interface AddConstraintParams {
  category: string;
  constraint_text: string;
  priority?: 'low' | 'medium' | 'high' | 'critical' | number;
  layer?: string;
  tags?: string[];
  created_by?: string;
  /** @since v4.2.1 - Set to false to create inactive constraint (for plan-based workflow) */
  active?: boolean;
  /** @since v5.3.0 - Why this constraint exists (stored in t_constraints.reason) */
  reason?: string;
}

export interface GetConstraintsParams {
  category?: string;
  layer?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical' | number;
  tags?: string[];
  include_inactive?: boolean;
  limit?: number;
}

export interface DeactivateConstraintParams {
  id: number | string;  // number for SQLite, UUID string for SaaS
}
