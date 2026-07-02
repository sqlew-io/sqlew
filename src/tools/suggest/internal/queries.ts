/**
 * Suggest Tool - Internal Query Builders
 *
 * Common decision query patterns used across suggest actions.
 * Handles multi-project support, numeric/string values, and tag aggregation.
 */

import type { Knex } from 'knex';
import { getProjectContext } from '../../../utils/project-context.js';
import { formatGroupConcatTags } from '../../../utils/tag-parser.js';
import type { DecisionCandidate } from '../types.js';

/**
 * Build base decision query with all necessary JOINs
 *
 * Returns a query builder for t_decisions with:
 * - m_context_keys (for key names)
 * - m_layers (for layer names)
 * - t_decision_tags + m_tags (for tags with GROUP_CONCAT)
 * - t_decisions_numeric (for numeric values with COALESCE)
 *
 * Includes multi-project support (v3.7.0+)
 *
 * @param knex - Knex instance (or transaction context)
 * @param options - Query options
 * @returns Knex query builder
 */
export function buildDecisionQuery(
  knex: Knex,
  options: {
    distinct?: boolean;
    includeTagCount?: boolean;
  } = {}
): Knex.QueryBuilder {
  const projectId = getProjectContext().getProjectId();
  const { distinct = false, includeTagCount = false } = options;

  const selectFields = [
    'd.key_id',
    'ck.key_name as key',  // Alias to match DecisionCandidate.key
    knex.raw('COALESCE(NULLIF(d.value, \'\'), dn.value) as value'),  // NULLIF converts empty string to NULL
    'l.name as layer',
    'd.ts',
    formatGroupConcatTags(knex, distinct),
  ];

  if (includeTagCount) {
    selectFields.push(knex.raw('COUNT(DISTINCT ti.tag_name) as tag_count'));
  }

  // Use LEFT JOIN for m_layers to include decisions without layer
  return knex('t_decisions as d')
    .select(...selectFields)
    .join('m_context_keys as ck', 'd.key_id', 'ck.id')
    .leftJoin('m_layers as l', 'd.layer_id', 'l.id')
    .leftJoin('t_decision_tags as dt', function() {
      this.on('dt.decision_key_id', '=', 'd.key_id')
          .andOn('dt.project_id', '=', knex.raw('?', [projectId]));
    })
    .leftJoin('m_tags as t', 'dt.tag_id', 't.id')
    .leftJoin('t_decisions_numeric as dn', function() {
      this.on('dn.key_id', '=', 'd.key_id')
          .andOn('dn.project_id', '=', knex.raw('?', [projectId]));
    })
    .where('d.project_id', projectId)
    .where('d.status', 1)
    .groupBy('d.key_id', 'ck.key_name', 'l.name', 'd.ts', 'd.value', 'dn.value');
}

/**
 * Build decision query for tag-based suggestions (optimized with t_tag_index)
 *
 * Uses denormalized t_tag_index table for faster tag lookups.
 *
 * @param knex - Knex instance (or transaction context)
 * @param tags - Array of tag names to match
 * @param layer - Optional layer filter
 * @returns Knex query builder
 */
export function buildTagIndexQuery(
  knex: Knex,
  tags: string[],
  layer?: string
): Knex.QueryBuilder {
  const projectId = getProjectContext().getProjectId();

  let query = knex('t_tag_index as ti')
    .select(
      'd.key_id',
      'ck.key_name as key',  // Alias to match DecisionCandidate.key
      knex.raw('COALESCE(NULLIF(d.value, \'\'), dn.value) as value'),  // NULLIF converts empty string to NULL
      'l.name as layer',
      'd.ts',
      formatGroupConcatTags(knex, true),  // DISTINCT for t_tag_index queries
      knex.raw('COUNT(DISTINCT ti.tag) as tag_count')
    )
    // key_id is shared across projects (m_context_keys has no project_id),
    // so every join on key_id must also be scoped by project_id
    .join('t_decisions as d', function() {
      this.on('ti.source_id', '=', 'd.key_id')
          .andOn('ti.source_type', '=', knex.raw('?', ['decision']))
          .andOn('d.project_id', '=', knex.raw('?', [projectId]));
    })
    .join('m_context_keys as ck', 'd.key_id', 'ck.id')
    // Use LEFT JOIN for m_layers to include decisions without layer
    .leftJoin('m_layers as l', 'd.layer_id', 'l.id')
    .leftJoin('t_decision_tags as dt', function() {
      this.on('dt.decision_key_id', '=', 'd.key_id')
          .andOn('dt.project_id', '=', knex.raw('?', [projectId]));
    })
    .leftJoin('m_tags as t', 'dt.tag_id', 't.id')
    .leftJoin('t_decisions_numeric as dn', function() {
      this.on('dn.key_id', '=', 'd.key_id')
          .andOn('dn.project_id', '=', knex.raw('?', [projectId]));
    })
    .whereIn('ti.tag', tags)
    .where('ti.project_id', projectId)
    .where('d.status', 1);

  if (layer) {
    query = query.where('l.name', layer);
  }

  return query
    .groupBy('d.key_id', 'ck.key_name', 'l.name', 'd.ts', 'd.value', 'dn.value')
    .orderBy('tag_count', 'desc');
}

/**
 * Build decision query with optional tag filtering
 *
 * Used by by_context action for hybrid suggestions.
 *
 * @param knex - Knex instance (or transaction context)
 * @param tags - Optional array of tags to filter by
 * @returns Knex query builder
 */
export function buildContextQuery(
  knex: Knex,
  tags?: string[],
  excludeKey?: string
): Knex.QueryBuilder {
  const projectId = getProjectContext().getProjectId();

  let query = buildDecisionQuery(knex, { distinct: true });

  // If tags provided, filter to only tag matches using t_tag_index
  if (tags && tags.length > 0) {
    query = query.whereExists(function(this: any) {
      this.select(knex.raw('1'))
        .from('t_tag_index as ti')
        .whereRaw('ti.source_id = d.key_id')
        .where('ti.source_type', 'decision')
        .where('ti.project_id', projectId)
        .whereIn('ti.tag', tags);
    });
  }

  // Exclude specific key (v3.9.0: prevent suggesting decision to itself)
  if (excludeKey) {
    query = query.whereNot('ck.key_name', excludeKey);
  }

  return query;
}

/**
 * Check if decision key exists (exact match)
 *
 * @param knex - Knex instance (or transaction context)
 * @param key - Decision key to check
 * @returns Existing decision or null
 */
export async function checkExactMatch(
  knex: Knex,
  key: string
): Promise<{ key: string; value: string | number; version: string } | null> {
  const projectId = getProjectContext().getProjectId();

  // Check string decisions (t_decisions)
  const stringDecision = await knex('t_decisions as d')
    .select(
      'd.key_id',
      'ck.key_name',
      'd.value',
      'd.version'
    )
    .join('m_context_keys as ck', 'd.key_id', 'ck.id')
    .where('ck.key_name', key)
    .where('d.project_id', projectId)
    .where('d.status', 1)
    .first();

  if (stringDecision) {
    return {
      key: stringDecision.key_name,
      value: stringDecision.value,
      version: stringDecision.version,
    };
  }

  // Check numeric decisions (t_decisions_numeric)
  const numericDecision = await knex('t_decisions_numeric as dn')
    .select(
      'dn.key_id',
      'ck.key_name',
      'dn.value',
      'dn.version'
    )
    .join('m_context_keys as ck', 'dn.key_id', 'ck.id')
    .where('ck.key_name', key)
    .where('dn.project_id', projectId)
    .where('dn.status', 1)
    .first();

  if (numericDecision) {
    return {
      key: numericDecision.key_name,
      value: numericDecision.value,
      version: numericDecision.version,
    };
  }

  return null;
}
