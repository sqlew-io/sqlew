/**
 * Constraint Suggest by Text Pattern
 *
 * Uses Levenshtein distance to find similar constraints
 * based on constraint_text similarity.
 */

import { getAdapter } from '../../../database/index.js';
import {
  buildConstraintQuery,
  type ConstraintCandidate as QueryConstraintCandidate,
} from '../internal/constraint-queries.js';
import { getProjectContext } from '../../../utils/project-context.js';
import { ftsSearchConstraintIds } from '../../../utils/fts.js';
import { transformAndScoreConstraints } from '../../../utils/suggest-helpers.js';
import type {
  ConstraintScoringContext,
  ScoreBreakdown,
  ScoredConstraint,
} from '../../../utils/constraint-scorer.js';

/**
 * Parameters for constraint by text search
 */
export interface ConstraintByTextParams {
  text: string;
  layer?: string;
  limit?: number;
  min_score?: number;
}

/**
 * Constraint suggestion structure
 */
export interface ConstraintSuggestion {
  id: number;
  constraint_text: string;
  category: string;
  score: number;
  reason: string;
  score_breakdown: ScoreBreakdown;
  layer?: string;
  tags?: string[];
}

/**
 * Response structure for constraint suggestions
 */
export interface ConstraintSuggestResponse {
  query_text: string;
  count: number;
  suggestions: ConstraintSuggestion[];
}

/**
 * Suggest constraints by text pattern similarity
 *
 * Uses Levenshtein distance to score constraint text similarity.
 *
 * @param params - Parameters with text pattern to search
 * @returns Suggestions ranked by text similarity score
 */
export async function constraintByText(
  params: ConstraintByTextParams
): Promise<ConstraintSuggestResponse> {
  if (!params.text) {
    throw new Error('Missing required parameter: text');
  }

  const adapter = getAdapter();
  const knex = adapter.getKnex();

  // FTS candidate narrowing (SQLite only): the top bm25-ranked ids are
  // loaded and re-ranked by the existing scorer, so result order matches
  // the full-scan path. null = FTS unavailable -> full scan as before.
  const projectId = getProjectContext().getProjectId();
  const ftsIds = await ftsSearchConstraintIds(knex, params.text, projectId);

  if (ftsIds !== null && ftsIds.length === 0) {
    // FTS is authoritative here: no candidate shares any text fragment,
    // so nothing could reach a meaningful similarity score
    return {
      query_text: params.text,
      count: 0,
      suggestions: [],
    };
  }

  // Build and execute constraint query
  let query = buildConstraintQuery(knex, { distinct: true });

  if (ftsIds !== null) {
    query = query.whereIn('c.id', ftsIds);
  }

  // Filter by layer if specified
  if (params.layer) {
    query = query.where('l.name', params.layer);
  }

  const candidates = (await query) as QueryConstraintCandidate[];

  // Score constraints based on text similarity
  const context: ConstraintScoringContext = {
    text: params.text,
    tags: [],
    layer: params.layer,
  };

  const suggestions = transformAndScoreConstraints(candidates, context, {
    minScore: params.min_score,
    limit: params.limit,
  });

  return {
    query_text: params.text,
    count: suggestions.length,
    suggestions: suggestions.map((s: ScoredConstraint) => ({
      id: s.id,
      constraint_text: s.constraint_text,
      category: s.category,
      score: s.score,
      reason: s.reason,
      score_breakdown: s.score_breakdown,
      layer: s.layer,
      tags: s.tags,
    })),
  };
}
