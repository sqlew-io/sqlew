/**
 * Constraint scoring algorithm for Constraint Intelligence System
 *
 * Scores constraints based on:
 * - Tag overlap (40 points max, 10 per matching tag)
 * - Layer match (25 points)
 * - Text similarity (20 points, Levenshtein distance)
 * - Recency (10 points)
 * - Priority (5 points)
 *
 * Total: 100 points max
 */

/**
 * Candidate constraint from database query
 */
export interface ConstraintCandidate {
  id: number;
  constraint_text: string;
  category: string;
  tags: string[];
  layer: string | null;
  priority: number;
  ts: number;
}

/**
 * Score breakdown for transparency and debugging
 */
export interface ScoreBreakdown {
  tag_overlap: number;
  layer_match: number;
  text_similarity: number;
  recency: number;
  priority: number;
}

/**
 * Scored constraint with full metadata
 */
export interface ScoredConstraint {
  id: number;
  constraint_text: string;
  category: string;
  score: number;
  score_breakdown: ScoreBreakdown;
  reason: string;
  tags: string[];
  layer?: string;
}

/**
 * Context for scoring constraints
 */
export interface ConstraintScoringContext {
  text: string;
  tags: string[];
  layer?: string;
  priority?: number;
}

// Shared implementation; re-exported because external callers and tests
// import levenshteinDistance from this module
import { levenshteinDistance } from './levenshtein.js';
export { levenshteinDistance };

/**
 * Calculate text similarity score (0-20 points)
 * Based on Levenshtein distance normalized to text length
 *
 * @param text1 - First text to compare
 * @param text2 - Second text to compare
 * @returns Similarity score (0-20)
 */
function calculateTextSimilarity(text1: string, text2: string): number {
  // Guard against undefined/null values
  if (!text1 || !text2) return 0;

  // Normalize texts for comparison (lowercase, trim)
  const normalized1 = text1.toLowerCase().trim();
  const normalized2 = text2.toLowerCase().trim();

  // Exact match
  if (normalized1 === normalized2) return 20;

  // Calculate Levenshtein distance
  const distance = levenshteinDistance(normalized1, normalized2);
  const maxLength = Math.max(normalized1.length, normalized2.length);

  // Prevent division by zero
  if (maxLength === 0) return 0;

  // Calculate similarity ratio (0-1)
  const similarity = 1 - distance / maxLength;

  // Scale to 0-20 points
  return Math.floor(similarity * 20);
}

/**
 * Calculate tag overlap score (0-40 points, 10 per tag, max 4)
 *
 * @param contextTags - Tags from the scoring context
 * @param constraintTags - Tags from the constraint candidate
 * @returns Tag overlap score (0-40)
 */
function calculateTagOverlap(contextTags: string[], constraintTags: string[]): number {
  if (!contextTags || !constraintTags) return 0;
  const overlap = contextTags.filter(t => constraintTags.includes(t)).length;
  return Math.min(overlap * 10, 40);
}

/**
 * Calculate layer match score (0 or 25 points)
 *
 * @param contextLayer - Layer from the scoring context
 * @param constraintLayer - Layer from the constraint candidate
 * @returns Layer match score (0 or 25)
 */
function calculateLayerMatch(
  contextLayer: string | undefined,
  constraintLayer: string | null
): number {
  if (!contextLayer || !constraintLayer) return 0;
  return contextLayer === constraintLayer ? 25 : 0;
}

/**
 * Calculate recency score (0-10 points)
 * Constraints updated recently score higher
 *
 * Scoring tiers:
 * - <= 30 days: 10 points
 * - <= 90 days: 5 points
 * - <= 180 days: 2 points
 * - > 180 days: 0 points
 *
 * @param ts - Unix timestamp of constraint update
 * @returns Recency score (0-10)
 */
export function calculateRecencyScore(ts: number): number {
  const now = Math.floor(Date.now() / 1000);
  const ageSeconds = now - ts;
  const ageDays = ageSeconds / 86400;

  if (ageDays <= 30) return 10;
  if (ageDays <= 90) return 5;
  if (ageDays <= 180) return 2;
  return 0;
}

/**
 * Calculate priority score (0-5 points)
 *
 * Priority mapping:
 * - Critical (4): 5 points
 * - High (3): 4 points
 * - Medium (2): 3 points
 * - Low (1): 2 points
 *
 * @param priority - Priority level (1-4)
 * @returns Priority score (0-5)
 */
function calculatePriorityScore(priority: number): number {
  const scoreMap: Record<number, number> = {
    4: 5, // Critical
    3: 4, // High
    2: 3, // Medium
    1: 2, // Low
  };
  return scoreMap[priority] ?? 0;
}

/**
 * Score a single constraint against context
 *
 * @param candidate - Constraint candidate to score
 * @param context - Scoring context (text, tags, layer, priority)
 * @returns Scored constraint with breakdown
 */
export function scoreConstraint(
  candidate: ConstraintCandidate,
  context: ConstraintScoringContext
): ScoredConstraint {
  const tagOverlap = calculateTagOverlap(context.tags, candidate.tags);
  const layerMatch = calculateLayerMatch(context.layer, candidate.layer);
  const textSimilarity = calculateTextSimilarity(context.text, candidate.constraint_text);
  const recency = calculateRecencyScore(candidate.ts);
  const priority = calculatePriorityScore(candidate.priority);

  const totalScore = tagOverlap + layerMatch + textSimilarity + recency + priority;

  // Generate human-readable reason
  const reasons: string[] = [];
  if (tagOverlap >= 20) reasons.push(`${tagOverlap / 10} matching tags`);
  if (layerMatch > 0) reasons.push('same layer');
  if (textSimilarity >= 15) reasons.push('similar constraint text');
  if (recency >= 5) reasons.push('recently updated');
  if (priority >= 4) reasons.push('high priority');

  return {
    id: candidate.id,
    constraint_text: candidate.constraint_text,
    category: candidate.category,
    score: totalScore,
    score_breakdown: {
      tag_overlap: tagOverlap,
      layer_match: layerMatch,
      text_similarity: textSimilarity,
      recency,
      priority,
    },
    reason: reasons.length > 0 ? reasons.join(', ') : 'low similarity',
    tags: candidate.tags,
    layer: candidate.layer ?? undefined,
  };
}

/**
 * Score multiple constraints against context
 * Returns scored constraints sorted by score descending
 *
 * @param candidates - Array of constraint candidates
 * @param context - Scoring context (text, tags, layer, priority)
 * @returns Array of scored constraints, sorted by score descending
 */
export function scoreConstraints(
  candidates: ConstraintCandidate[],
  context: ConstraintScoringContext
): ScoredConstraint[] {
  const scored = candidates.map(candidate => scoreConstraint(candidate, context));

  // Sort by score descending
  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Filter scored constraints by minimum score threshold
 *
 * @param scored - Array of scored constraints
 * @param minScore - Minimum score threshold (default: 30)
 * @returns Filtered array of constraints meeting threshold
 */
export function filterByThreshold(
  scored: ScoredConstraint[],
  minScore: number = 30
): ScoredConstraint[] {
  return scored.filter(s => s.score >= minScore);
}

/**
 * Limit number of constraint suggestions
 *
 * @param scored - Array of scored constraints
 * @param limit - Maximum number to return (default: 5)
 * @returns Limited array of constraints
 */
export function limitSuggestions(
  scored: ScoredConstraint[],
  limit: number = 5
): ScoredConstraint[] {
  return scored.slice(0, limit);
}
