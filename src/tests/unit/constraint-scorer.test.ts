/**
 * Constraint Scorer Unit Tests
 *
 * Tests scoring pipeline: Levenshtein distance, recency scoring,
 * constraint scoring, filtering, and result limiting.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  levenshteinDistance,
  calculateRecencyScore,
  scoreConstraint,
  scoreConstraints,
  filterByThreshold,
  limitSuggestions,
  type ConstraintCandidate,
  type ConstraintScoringContext,
  type ScoredConstraint,
} from '../../utils/constraint-scorer.js';

describe('Constraint Scorer', () => {
  describe('levenshteinDistance()', () => {
    it('should return 0 for identical strings', () => {
      assert.strictEqual(levenshteinDistance('hello', 'hello'), 0);
      assert.strictEqual(levenshteinDistance('API response time', 'API response time'), 0);
    });

    it('should return string length for empty comparisons', () => {
      assert.strictEqual(levenshteinDistance('hello', ''), 5);
      assert.strictEqual(levenshteinDistance('', 'world'), 5);
      assert.strictEqual(levenshteinDistance('', ''), 0);
    });

    it('should handle null/undefined values', () => {
      // Guard against undefined/null
      assert.strictEqual(levenshteinDistance(null as any, 'test'), 4);
      assert.strictEqual(levenshteinDistance('test', null as any), 4);
      assert.strictEqual(levenshteinDistance(undefined as any, 'test'), 4);
    });

    it('should calculate single character operations', () => {
      // Insertion: 'cat' -> 'cart' (1 insertion)
      assert.strictEqual(levenshteinDistance('cat', 'cart'), 1);

      // Deletion: 'cart' -> 'cat' (1 deletion)
      assert.strictEqual(levenshteinDistance('cart', 'cat'), 1);

      // Substitution: 'cat' -> 'bat' (1 substitution)
      assert.strictEqual(levenshteinDistance('cat', 'bat'), 1);
    });

    it('should calculate multiple operations', () => {
      // 'kitten' -> 'sitting' (k->s, e->i, +g = 3 operations)
      assert.strictEqual(levenshteinDistance('kitten', 'sitting'), 3);

      // 'saturday' -> 'sunday' (4 operations)
      assert.strictEqual(levenshteinDistance('saturday', 'sunday'), 3);
    });

    it('should be case-sensitive', () => {
      assert.strictEqual(levenshteinDistance('Hello', 'hello'), 1);
      assert.strictEqual(levenshteinDistance('API', 'api'), 3);
    });

    it('should handle similar constraint texts', () => {
      // Similar constraint texts should have low distance
      const dist = levenshteinDistance(
        'API response time must be under 100ms',
        'API response time must be under 200ms'
      );
      assert.strictEqual(dist, 1); // Only '1' -> '2' changed
    });
  });

  describe('calculateRecencyScore()', () => {
    it('should return 10 points for constraints <= 30 days old', () => {
      const now = Math.floor(Date.now() / 1000);
      const tenDaysAgo = now - 10 * 86400;
      const thirtyDaysAgo = now - 30 * 86400;

      assert.strictEqual(calculateRecencyScore(now), 10);
      assert.strictEqual(calculateRecencyScore(tenDaysAgo), 10);
      assert.strictEqual(calculateRecencyScore(thirtyDaysAgo), 10);
    });

    it('should return 5 points for constraints 31-90 days old', () => {
      const now = Math.floor(Date.now() / 1000);
      const fortyDaysAgo = now - 40 * 86400;
      const ninetyDaysAgo = now - 90 * 86400;

      assert.strictEqual(calculateRecencyScore(fortyDaysAgo), 5);
      assert.strictEqual(calculateRecencyScore(ninetyDaysAgo), 5);
    });

    it('should return 2 points for constraints 91-180 days old', () => {
      const now = Math.floor(Date.now() / 1000);
      const hundredDaysAgo = now - 100 * 86400;
      const oneEightyDaysAgo = now - 180 * 86400;

      assert.strictEqual(calculateRecencyScore(hundredDaysAgo), 2);
      assert.strictEqual(calculateRecencyScore(oneEightyDaysAgo), 2);
    });

    it('should return 0 points for constraints > 180 days old', () => {
      const now = Math.floor(Date.now() / 1000);
      const twoHundredDaysAgo = now - 200 * 86400;
      const yearAgo = now - 365 * 86400;

      assert.strictEqual(calculateRecencyScore(twoHundredDaysAgo), 0);
      assert.strictEqual(calculateRecencyScore(yearAgo), 0);
    });
  });

  describe('scoreConstraint()', () => {
    const now = Math.floor(Date.now() / 1000);

    const createCandidate = (overrides: Partial<ConstraintCandidate> = {}): ConstraintCandidate => ({
      id: 1,
      constraint_text: 'API response time must be under 100ms',
      category: 'performance',
      tags: ['api', 'performance'],
      layer: 'business',
      priority: 3,
      ts: now,
      ...overrides,
    });

    const createContext = (overrides: Partial<ConstraintScoringContext> = {}): ConstraintScoringContext => ({
      text: 'API response time',
      tags: ['api'],
      layer: 'business',
      priority: 3,
      ...overrides,
    });

    it('should calculate tag overlap score (10 per tag, Jaccard-discounted, max 40)', () => {
      const candidate = createCandidate({ tags: ['api', 'performance', 'latency', 'sla'] });
      const context = createContext({ tags: ['api', 'performance', 'latency', 'sla'] });

      const result = scoreConstraint(candidate, context);
      assert.strictEqual(result.score_breakdown.tag_overlap, 40); // identical sets: 4 * 10 * 1.0 = 40

      // Partial overlap is discounted by Jaccard (1 match / union of 4)
      const context2 = createContext({ tags: ['api'] });
      const result2 = scoreConstraint(candidate, context2);
      assert.strictEqual(result2.score_breakdown.tag_overlap, 3); // round(10 * 1/4) = 3
    });

    it('should cap tag overlap at 40 points', () => {
      const candidate = createCandidate({ tags: ['a', 'b', 'c', 'd', 'e', 'f'] });
      const context = createContext({ tags: ['a', 'b', 'c', 'd', 'e', 'f'] });

      const result = scoreConstraint(candidate, context);
      assert.strictEqual(result.score_breakdown.tag_overlap, 40); // Capped at 40
    });

    it('should discount tag-heavy candidates (Jaccard normalization)', () => {
      // Same 2 matching tags, but the noisy candidate carries 6 extra tags
      const context = createContext({ tags: ['api', 'performance'] });
      const precise = scoreConstraint(
        createCandidate({ tags: ['api', 'performance'] }),
        context
      );
      const noisy = scoreConstraint(
        createCandidate({ tags: ['api', 'performance', 'x1', 'x2', 'x3', 'x4', 'x5', 'x6'] }),
        context
      );

      assert.strictEqual(precise.score_breakdown.tag_overlap, 20); // round(20 * 2/2)
      assert.strictEqual(noisy.score_breakdown.tag_overlap, 5);    // round(20 * 2/8)
      assert.ok(precise.score_breakdown.tag_overlap > noisy.score_breakdown.tag_overlap);
    });

    it('should calculate layer match score (25 points)', () => {
      const candidate = createCandidate({ layer: 'business' });
      const context = createContext({ layer: 'business' });

      const result = scoreConstraint(candidate, context);
      assert.strictEqual(result.score_breakdown.layer_match, 25);

      // No match
      const context2 = createContext({ layer: 'data' });
      const result2 = scoreConstraint(candidate, context2);
      assert.strictEqual(result2.score_breakdown.layer_match, 0);
    });

    it('should calculate text similarity score (max 20)', () => {
      // Exact match
      const candidate = createCandidate({ constraint_text: 'API response time' });
      const context = createContext({ text: 'API response time' });

      const result = scoreConstraint(candidate, context);
      assert.strictEqual(result.score_breakdown.text_similarity, 20);

      // Partial match
      const candidate2 = createCandidate({ constraint_text: 'API response' });
      const result2 = scoreConstraint(candidate2, context);
      assert.ok(result2.score_breakdown.text_similarity > 0);
      assert.ok(result2.score_breakdown.text_similarity < 20);
    });

    it('should calculate recency score (max 10)', () => {
      const result = scoreConstraint(createCandidate({ ts: now }), createContext());
      assert.strictEqual(result.score_breakdown.recency, 10);

      const oldTs = now - 200 * 86400;
      const result2 = scoreConstraint(createCandidate({ ts: oldTs }), createContext());
      assert.strictEqual(result2.score_breakdown.recency, 0);
    });

    it('should calculate priority score (max 5)', () => {
      const result = scoreConstraint(createCandidate({ priority: 4 }), createContext());
      assert.strictEqual(result.score_breakdown.priority, 5); // Critical = 5

      const result2 = scoreConstraint(createCandidate({ priority: 1 }), createContext());
      assert.strictEqual(result2.score_breakdown.priority, 2); // Low = 2
    });

    it('should calculate total score as sum of components', () => {
      const candidate = createCandidate();
      const context = createContext();

      const result = scoreConstraint(candidate, context);
      const expectedTotal =
        result.score_breakdown.tag_overlap +
        result.score_breakdown.layer_match +
        result.score_breakdown.text_similarity +
        result.score_breakdown.recency +
        result.score_breakdown.priority;

      assert.strictEqual(result.score, expectedTotal);
    });

    it('should generate human-readable reason', () => {
      const candidate = createCandidate({
        tags: ['api', 'performance'],
        layer: 'business',
        priority: 4,
      });
      const context = createContext({
        tags: ['api', 'performance'],
        layer: 'business',
      });

      const result = scoreConstraint(candidate, context);
      assert.ok(result.reason.includes('matching tags'));
      assert.ok(result.reason.includes('same layer'));
    });

    it('should return "low similarity" for low scores', () => {
      const oldTs = now - 365 * 86400; // Very old constraint (0 recency points)
      const candidate = createCandidate({
        tags: [],
        layer: null,
        priority: 1,
        ts: oldTs, // Override to old timestamp
      });
      const context = createContext({
        text: 'completely different text that has no overlap',
        tags: ['different'],
        layer: 'data',
      });

      const result = scoreConstraint(candidate, context);
      // With no meaningful matches and old timestamp, reason should be 'low similarity'
      assert.strictEqual(result.score_breakdown.tag_overlap, 0);
      assert.strictEqual(result.score_breakdown.layer_match, 0);
      assert.strictEqual(result.score_breakdown.recency, 0);
      assert.ok(result.score_breakdown.text_similarity < 15);
      assert.strictEqual(result.reason, 'low similarity');
    });

    it('should handle null/empty context values', () => {
      const candidate = createCandidate();
      const context: ConstraintScoringContext = {
        text: '',
        tags: [],
        layer: undefined,
        priority: undefined,
      };

      // Should not throw
      const result = scoreConstraint(candidate, context);
      assert.ok(result);
      assert.strictEqual(result.score_breakdown.tag_overlap, 0);
      assert.strictEqual(result.score_breakdown.layer_match, 0);
    });
  });

  describe('scoreConstraints()', () => {
    const now = Math.floor(Date.now() / 1000);

    it('should score multiple constraints and sort by score descending', () => {
      const candidates: ConstraintCandidate[] = [
        { id: 1, constraint_text: 'Low match', category: 'other', tags: [], layer: null, priority: 1, ts: now - 200 * 86400 },
        { id: 2, constraint_text: 'API response time', category: 'performance', tags: ['api'], layer: 'business', priority: 4, ts: now },
        { id: 3, constraint_text: 'Medium match', category: 'performance', tags: ['api'], layer: null, priority: 2, ts: now - 100 * 86400 },
      ];

      const context: ConstraintScoringContext = {
        text: 'API response time',
        tags: ['api'],
        layer: 'business',
      };

      const results = scoreConstraints(candidates, context);

      assert.strictEqual(results.length, 3);
      // Should be sorted by score descending
      assert.ok(results[0].score >= results[1].score);
      assert.ok(results[1].score >= results[2].score);
      // Highest score should be id=2 (best match)
      assert.strictEqual(results[0].id, 2);
    });

    it('should handle empty candidates array', () => {
      const results = scoreConstraints([], { text: 'test', tags: [] });
      assert.deepStrictEqual(results, []);
    });
  });

  describe('filterByThreshold()', () => {
    const createScoredConstraint = (score: number, id: number = 1): ScoredConstraint => ({
      id,
      constraint_text: `Constraint ${id}`,
      category: 'test',
      score,
      score_breakdown: { tag_overlap: 0, layer_match: 0, text_similarity: 0, recency: 0, priority: 0 },
      reason: 'test',
      tags: [],
    });

    it('should filter constraints below threshold', () => {
      const scored = [
        createScoredConstraint(50, 1),
        createScoredConstraint(20, 2),
        createScoredConstraint(35, 3),
        createScoredConstraint(10, 4),
      ];

      const results = filterByThreshold(scored, 30);
      assert.strictEqual(results.length, 2);
      assert.ok(results.every(r => r.score >= 30));
    });

    it('should use default threshold of 30', () => {
      const scored = [
        createScoredConstraint(40, 1),
        createScoredConstraint(25, 2),
        createScoredConstraint(30, 3),
      ];

      const results = filterByThreshold(scored);
      assert.strictEqual(results.length, 2); // 40 and 30 pass
    });

    it('should return empty array when no constraints meet threshold', () => {
      const scored = [
        createScoredConstraint(10, 1),
        createScoredConstraint(20, 2),
      ];

      const results = filterByThreshold(scored, 50);
      assert.strictEqual(results.length, 0);
    });

    it('should include constraints exactly at threshold', () => {
      const scored = [createScoredConstraint(30, 1)];
      const results = filterByThreshold(scored, 30);
      assert.strictEqual(results.length, 1);
    });
  });

  describe('limitSuggestions()', () => {
    const createScoredConstraint = (id: number): ScoredConstraint => ({
      id,
      constraint_text: `Constraint ${id}`,
      category: 'test',
      score: 50,
      score_breakdown: { tag_overlap: 0, layer_match: 0, text_similarity: 0, recency: 0, priority: 0 },
      reason: 'test',
      tags: [],
    });

    it('should limit results to specified count', () => {
      const scored = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(createScoredConstraint);

      const results = limitSuggestions(scored, 5);
      assert.strictEqual(results.length, 5);
      // Should keep first 5 (already sorted by score)
      assert.deepStrictEqual(results.map(r => r.id), [1, 2, 3, 4, 5]);
    });

    it('should use default limit of 5', () => {
      const scored = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(createScoredConstraint);

      const results = limitSuggestions(scored);
      assert.strictEqual(results.length, 5);
    });

    it('should return all if count is less than limit', () => {
      const scored = [1, 2, 3].map(createScoredConstraint);

      const results = limitSuggestions(scored, 5);
      assert.strictEqual(results.length, 3);
    });

    it('should handle empty array', () => {
      const results = limitSuggestions([], 5);
      assert.strictEqual(results.length, 0);
    });

    it('should handle limit of 0', () => {
      const scored = [1, 2, 3].map(createScoredConstraint);
      const results = limitSuggestions(scored, 0);
      assert.strictEqual(results.length, 0);
    });
  });

  describe('Scoring Pipeline Integration', () => {
    const now = Math.floor(Date.now() / 1000);

    it('should complete full scoring pipeline: score -> filter -> limit', () => {
      const candidates: ConstraintCandidate[] = [
        { id: 1, constraint_text: 'API must be fast', category: 'performance', tags: ['api'], layer: 'business', priority: 4, ts: now },
        { id: 2, constraint_text: 'Database query optimization', category: 'performance', tags: ['database'], layer: 'data', priority: 3, ts: now },
        { id: 3, constraint_text: 'API response time < 100ms', category: 'performance', tags: ['api', 'latency'], layer: 'business', priority: 4, ts: now },
        { id: 4, constraint_text: 'Security headers required', category: 'security', tags: ['security'], layer: 'infrastructure', priority: 2, ts: now - 200 * 86400 },
        { id: 5, constraint_text: 'API versioning mandatory', category: 'architecture', tags: ['api', 'versioning'], layer: 'business', priority: 3, ts: now },
      ];

      const context: ConstraintScoringContext = {
        text: 'API response time',
        tags: ['api', 'performance'],
        layer: 'business',
        priority: 4,
      };

      // Full pipeline
      let results = scoreConstraints(candidates, context);
      results = filterByThreshold(results, 30);
      results = limitSuggestions(results, 3);

      // Assertions
      assert.ok(results.length <= 3, 'Should be limited to 3');
      assert.ok(results.every(r => r.score >= 30), 'All should meet threshold');
      // Results should be sorted by score
      for (let i = 1; i < results.length; i++) {
        assert.ok(results[i - 1].score >= results[i].score, 'Should be sorted descending');
      }
    });

    it('should handle edge case: all constraints filtered out', () => {
      const candidates: ConstraintCandidate[] = [
        { id: 1, constraint_text: 'Unrelated constraint', category: 'other', tags: [], layer: null, priority: 1, ts: now - 365 * 86400 },
      ];

      const context: ConstraintScoringContext = {
        text: 'API response time',
        tags: ['api', 'performance'],
        layer: 'business',
      };

      let results = scoreConstraints(candidates, context);
      results = filterByThreshold(results, 50);
      results = limitSuggestions(results, 5);

      assert.strictEqual(results.length, 0);
    });
  });
});
