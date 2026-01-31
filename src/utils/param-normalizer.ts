/**
 * Parameter Alias Normalizer
 *
 * Converts short aliases to canonical parameter names before validation.
 * This enables user-friendly shorter parameter names while maintaining
 * consistent internal naming conventions.
 *
 * @example
 * // Single alias
 * normalizeParams(params, { path: 'file_path' });
 *
 * // Multiple aliases
 * normalizeParams(params, {
 *   path: 'file_path',
 *   type: 'change_type'
 * });
 */

/**
 * Normalize parameter aliases to canonical names.
 *
 * Only converts alias to canonical if:
 * 1. The alias parameter exists
 * 2. The canonical parameter does NOT exist (avoid overwrite)
 *
 * @param params - Original parameters object
 * @param aliases - Mapping of alias names to canonical names { alias: canonical }
 * @returns New object with normalized parameter names
 */
export function normalizeParams<T extends object>(
  params: T,
  aliases: Record<string, string>
): T {
  const normalized = { ...params } as any;

  for (const [alias, canonical] of Object.entries(aliases)) {
    if (normalized[alias] !== undefined && normalized[canonical] === undefined) {
      normalized[canonical] = normalized[alias];
      delete normalized[alias];
    }
  }

  return normalized as T;
}

/**
 * Pre-defined alias mappings for each tool.
 * Centralized definitions for consistency and documentation.
 */
export const DECISION_ALIASES = {
  // add_decision_context
  alternatives: 'alternatives_considered',
  task_id: 'related_task_id',
  constraint_id: 'related_constraint_id',
  // search_advanced
  after: 'updated_after',
  before: 'updated_before',
  // list_decision_contexts
  key: 'decision_key'
} as const;

export const FILE_ALIASES = {
  // record, get, check_lock
  path: 'file_path',
  // record
  type: 'change_type',
  // record_batch
  changes: 'file_changes',
  // check_lock
  duration: 'lock_duration'
} as const;

export const CONSTRAINT_ALIASES = {
  // add
  text: 'constraint_text'
} as const;
