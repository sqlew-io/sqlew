/**
 * Batch operation types (FR-005)
 */

import type { SetDecisionParams } from './params.js';

export interface SetDecisionBatchParams {
  decisions: SetDecisionParams[];
  atomic?: boolean;  // Default: true (all succeed or all fail)
}

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
