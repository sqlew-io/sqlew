/**
 * Suggestion scoring algorithm for Decision Intelligence System
 *
 * Scores suggestions based on:
 * - Tag overlap (40 points max, 10 per matching tag, discounted by the
 *   Jaccard coefficient so tag-heavy candidates don't outrank precise matches)
 * - Layer match (25 points)
 * - Key pattern similarity (20 points)
 * - Recency (10 points)
 * - Priority (5 points)
 *
 * Total: 100 points max
 */

import { Knex } from 'knex';
import { levenshteinDistance } from './levenshtein.js';

export interface SuggestionContext {
  key: string;
  tags: string[];
  layer?: string;
  priority?: number;
}

export interface ScoredSuggestion {
  key_id: number;
  key: string;
  value: string;
  score: number;
  score_breakdown: {
    tag_overlap: number;
    layer_match: number;
    key_similarity: number;
    recency: number;
    priority: number;
  };
  reason: string;
  tags: string[];  // For match detail analysis
  layer?: string;  // For match detail analysis
  updated_ts: number;  // For version info
}

/**
 * Find common prefix between two strings
 */
function commonPrefix(a: string, b: string): string {
  // Guard against undefined/null values
  if (!a || !b) return '';
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) {
    i++;
  }
  return a.substring(0, i);
}

/**
 * Calculate key similarity score (0-20 points)
 * Based on Levenshtein distance and common prefix/suffix
 */
function calculateKeySimilarity(key1: string, key2: string): number {
  // Guard against undefined/null values
  if (!key1 || !key2) return 0;

  // Exact match
  if (key1 === key2) return 20;

  // Hierarchical prefix match (e.g., "yurika" matches "yurika/xxx")
  // Important for category-style searches where users search by namespace
  if (key2.startsWith(key1 + '/') || key1.startsWith(key2 + '/')) {
    return 20; // Strong match - treat as near-exact match
  }

  // Common prefix (e.g., "security/jwt" vs "security/oauth")
  const prefix = commonPrefix(key1, key2);
  const prefixScore = Math.min(prefix.length * 2, 10);

  // Levenshtein distance
  const distance = levenshteinDistance(key1, key2);
  const maxLength = Math.max(key1.length, key2.length);
  const similarity = 1 - distance / maxLength;
  const distanceScore = Math.floor(similarity * 10);

  return prefixScore + distanceScore;
}

/**
 * Calculate tag overlap score (0-40 points)
 *
 * The count-based score (10 per matching tag, capped at 40) is discounted
 * by the Jaccard coefficient (|intersection| / |union|), so candidates
 * carrying many unrelated tags no longer outrank precise matches.
 * Identical tag sets keep the previous count-based score.
 */
function calculateTagOverlap(
  contextTags: string[],
  decisionTags: string[]
): { score: number; matches: number } {
  if (!contextTags?.length || !decisionTags?.length) {
    return { score: 0, matches: 0 };
  }

  const decisionSet = new Set(decisionTags);
  const matches = contextTags.filter(t => decisionSet.has(t)).length;
  if (matches === 0) {
    return { score: 0, matches: 0 };
  }

  const union = new Set([...contextTags, ...decisionTags]).size;
  const jaccard = matches / union;
  return { score: Math.round(Math.min(matches * 10, 40) * jaccard), matches };
}

/**
 * Calculate layer match score (0 or 25 points)
 */
function calculateLayerMatch(contextLayer: string | undefined, decisionLayer: string): number {
  if (!contextLayer) return 0;
  return contextLayer === decisionLayer ? 25 : 0;
}

/**
 * Calculate recency score (0-10 points)
 * Decisions updated in last 30 days get full points, older ones decay
 */
function calculateRecencyScore(updatedTs: number): number {
  const now = Math.floor(Date.now() / 1000);
  const ageSeconds = now - updatedTs;
  const ageDays = ageSeconds / 86400;

  if (ageDays <= 30) return 10;
  if (ageDays <= 90) return 5;
  if (ageDays <= 180) return 2;
  return 0;
}

/**
 * Calculate priority score (0-5 points)
 * Critical: 5, High: 4, Medium: 3, Low: 2
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
 * Main scoring function
 *
 * @param context - Decision context (key, tags, layer, priority)
 * @param candidates - Candidate decisions from database
 * @returns Scored and ranked suggestions
 */
export function scoreAndRankSuggestions(
  context: SuggestionContext,
  candidates: Array<{
    key_id: number;
    key: string;
    value: string;
    tags: string[];
    layer: string;
    priority: number;
    updated_ts: number;
  }>
): ScoredSuggestion[] {
  const scored = candidates.map(candidate => {
    const { score: tagOverlap, matches: matchingTags } = calculateTagOverlap(context.tags, candidate.tags);
    const layerMatch = calculateLayerMatch(context.layer, candidate.layer);
    const keySimilarity = calculateKeySimilarity(context.key, candidate.key);
    const recency = calculateRecencyScore(candidate.updated_ts);
    const priority = calculatePriorityScore(candidate.priority);

    const totalScore = tagOverlap + layerMatch + keySimilarity + recency + priority;

    // Generate human-readable reason
    const reasons: string[] = [];
    if (matchingTags >= 2) reasons.push(`${matchingTags} matching tags`);
    if (layerMatch > 0) reasons.push('same layer');
    if (keySimilarity >= 15) reasons.push('similar key pattern');
    if (recency >= 5) reasons.push('recently updated');

    return {
      key_id: candidate.key_id,
      key: candidate.key,
      value: candidate.value,
      score: totalScore,
      score_breakdown: {
        tag_overlap: tagOverlap,
        layer_match: layerMatch,
        key_similarity: keySimilarity,
        recency,
        priority,
      },
      reason: reasons.length > 0 ? reasons.join(', ') : 'low similarity',
      tags: candidate.tags,
      layer: candidate.layer,
      updated_ts: candidate.updated_ts,
    };
  });

  // Sort by score descending
  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Filter suggestions by minimum score threshold
 * Default: 30 points (moderate relevance)
 */
export function filterByThreshold(
  suggestions: ScoredSuggestion[],
  minScore: number = 30
): ScoredSuggestion[] {
  return suggestions.filter(s => s.score >= minScore);
}

/**
 * Limit number of suggestions
 * Default: 5 suggestions
 */
export function limitSuggestions(
  suggestions: ScoredSuggestion[],
  limit: number = 5
): ScoredSuggestion[] {
  return suggestions.slice(0, limit);
}
