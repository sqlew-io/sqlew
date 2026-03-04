/**
 * Export types (v5.0.0 - SaaS-only document export)
 */

import type { StatusString } from '../enums.js';

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
