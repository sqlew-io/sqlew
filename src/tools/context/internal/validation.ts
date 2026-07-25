/**
 * Parameter validation utilities for context/decision operations
 */

import { validateRequired, validateStatus, validateLayer } from '../../../utils/validators.js';
import { validateActionParams, validateBatchParams } from '../../../utils/parameter-validator.js';
import { STANDARD_LAYERS, STRING_TO_STATUS } from '../../../constants.js';
import { parseStringArray } from '../../../utils/param-parser.js';
import type { DatabaseAdapter } from '../../../adapters/types.js';
import {
  BatchValidationError,
  validateRequiredField,
  validateEnum,
  validateType,
} from '../../../utils/batch-validation.js';

/**
 * Validate required decision parameters
 */
export function validateDecisionParams(params: any): void {
  if (!params.key || params.key.trim() === '') {
    throw new Error('Parameter "key" is required and cannot be empty');
  }

  if (params.value === undefined || params.value === null) {
    throw new Error('Parameter "value" is required');
  }
}

/**
 * Validate status parameter
 */
export function validateStatusParam(status?: string): void {
  if (status && !STRING_TO_STATUS[status]) {
    throw new Error(`Invalid status: ${status}. Must be 'active', 'deprecated', or 'draft'`);
  }
}

/**
 * Validate layer parameter
 */
export function validateLayerParam(layer?: string): void {
  if (layer && !STANDARD_LAYERS.includes(layer as any)) {
    throw new Error(`Invalid layer. Must be one of: ${STANDARD_LAYERS.join(', ')}`);
  }
}

/**
 * Validate auto_increment parameter
 */
export function validateAutoIncrementParam(autoIncrement?: string): void {
  if (autoIncrement && !['major', 'minor', 'patch'].includes(autoIncrement)) {
    throw new Error(`Invalid auto_increment level: ${autoIncrement}. Expected: major, minor, or patch`);
  }
}

/**
 * Validate pagination parameters
 */
export function validatePaginationParams(limit?: number, offset?: number): void {
  if (limit !== undefined && (limit < 0 || limit > 1000)) {
    throw new Error('Parameter "limit" must be between 0 and 1000');
  }
  if (offset !== undefined && offset < 0) {
    throw new Error('Parameter "offset" must be non-negative');
  }
}

/**
 * Validate sort parameters
 */
export function validateSortParams(sortBy?: string, sortOrder?: string): void {
  if (sortBy && !['updated', 'key', 'version'].includes(sortBy)) {
    throw new Error(`Invalid sort_by: ${sortBy}. Must be 'updated', 'key', or 'version'`);
  }
  if (sortOrder && !['asc', 'desc'].includes(sortOrder)) {
    throw new Error(`Invalid sort_order: ${sortOrder}. Must be 'asc' or 'desc'`);
  }
}

/**
 * Parse relative time to Unix timestamp
 */
export function parseRelativeTime(relativeTime: string): number | null {
  const match = relativeTime.match(/^(\d+)(m|h|d)$/);
  if (!match) {
    // Try parsing as ISO timestamp
    const date = new Date(relativeTime);
    if (isNaN(date.getTime())) {
      return null;
    }
    return Math.floor(date.getTime() / 1000);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const now = Math.floor(Date.now() / 1000);

  switch (unit) {
    case 'm': return now - (value * 60);
    case 'h': return now - (value * 3600);
    case 'd': return now - (value * 86400);
    default: return null;
  }
}

// ============================================================================
// Batch Validation for Decision Items
// ============================================================================

const VALID_DECISION_STATUSES = ['active', 'deprecated', 'draft'] as const;
const VALID_DECISION_LAYERS = STANDARD_LAYERS;
const VALID_AUTO_INCREMENT_LEVELS = ['major', 'minor', 'patch'] as const;

/**
 * Validate single decision item in batch operation
 * Pre-validates all fields before database transaction
 */
export async function validateDecisionItem(
  item: any,
  index: number,
  adapter: DatabaseAdapter,
  errors: BatchValidationError[]
): Promise<void> {
  const identifier = item.key || `Item ${index + 1}`;

  // Required: key
  validateRequiredField(item.key, 'key', index, identifier, errors);

  // Required: value
  validateRequiredField(item.value, 'value', index, identifier, errors);

  // Optional but must be valid: status
  if (item.status !== undefined) {
    validateEnum(item.status, 'status', VALID_DECISION_STATUSES, index, identifier, errors);
  }

  // Optional but must be valid: layer
  if (item.layer !== undefined) {
    validateEnum(item.layer, 'layer', VALID_DECISION_LAYERS, index, identifier, errors);
  }

  // Optional but must be valid: auto_increment
  if (item.auto_increment !== undefined) {
    validateEnum(item.auto_increment, 'auto_increment', VALID_AUTO_INCREMENT_LEVELS, index, identifier, errors);
  }

  // Optional but must be array: tags
  if (item.tags !== undefined) {
    validateType(item.tags, 'tags', 'array', index, identifier, errors);
  }

  // Optional but must be array: scopes
  if (item.scopes !== undefined) {
    validateType(item.scopes, 'scopes', 'array', index, identifier, errors);
  }
}

// Re-export common validators
export { validateRequired, validateStatus, validateLayer, validateActionParams, validateBatchParams, parseStringArray };
