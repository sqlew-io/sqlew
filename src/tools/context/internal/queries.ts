/**
 * Shared database queries for context/decision operations
 */

import { DatabaseAdapter } from '../../../adapters/index.js';
import { Knex } from 'knex';
import {
  getOrCreateContextKey,
  getOrCreateTag,
  getOrCreateScope,
  getLayerId
} from '../../../database.js';
import { STRING_TO_STATUS, DEFAULT_VERSION, DEFAULT_STATUS, SUGGEST_THRESHOLDS, SUGGEST_LIMITS, VALID_STATUSES, STANDARD_LAYERS } from '../../../constants.js';
import { parseStringArray } from '../../../utils/param-parser.js';
import { incrementSemver, isValidSemver } from '../../../utils/semver.js';
import { validateAgainstPolicies } from '../../../utils/policy-validator.js';
import { ftsUpsertDecision } from '../../../utils/fts.js';
import { scheduleSnapshotRefresh } from '../../../utils/session-snapshot.js';
import { handleSuggestAction } from '../../suggest/index.js';
import { constraintByContext } from '../../suggest/actions/constraint-by-context.js';
import type { SetDecisionParams, SetDecisionResponse } from '../types.js';

// ============================================================================
// Helper Functions for Hybrid Similarity Detection (v3.9.0)
// ============================================================================

/**
 * Calculate confidence scores for duplicate detection
 * @param suggestions - Similarity suggestions from suggest engine
 * @returns Confidence scores (0-1 scale)
 */
function calculateConfidence(suggestions: any[]): { is_duplicate: number; should_update: number } {
  if (suggestions.length === 0) {
    return { is_duplicate: 0, should_update: 0 };
  }

  const maxScore = suggestions[0]?.score || 0;

  return {
    // Scale: 50 score = 0.50, 85 score = 0.85, cap at 0.95
    is_duplicate: Math.min(maxScore / 100, 0.95),
    // Higher confidence for action (+20 points bias)
    should_update: Math.min((maxScore + 20) / 100, 0.95)
  };
}

/**
 * Format timestamp as human-readable relative time
 * @param timestamp - Unix timestamp in seconds
 * @returns Human-readable string (e.g., "2h ago", "3d ago")
 */
function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000) - timestamp;

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Increment semantic version (patch level)
 * @param version - Current version (e.g., "1.2.3")
 * @returns Next patch version (e.g., "1.2.4")
 */
function incrementVersion(version: string): string {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    return '1.0.1'; // Default if invalid
  }
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

/**
 * Detect key pattern similarity
 * @param key1 - First key
 * @param key2 - Second key
 * @returns Pattern description if similar, undefined otherwise
 */
function detectKeyPattern(key1: string, key2: string): string | undefined {
  // Guard against undefined/null values
  if (!key1 || !key2) return undefined;

  // CVE pattern: CVE-YYYY-NNNNN
  const cvePattern = /^CVE-\d{4}-\d+$/;
  if (cvePattern.test(key1) && cvePattern.test(key2)) {
    return 'CVE-YYYY-NNNNN';
  }

  // Path pattern: api/v1/resource
  const pathPattern = /^[a-z]+\/[^/]+\/[^/]+$/;
  if (pathPattern.test(key1) && pathPattern.test(key2)) {
    return 'path/based/structure';
  }

  // Versioned key: feature-v1, feature-v2
  const versionPattern = /^(.+)-v\d+$/;
  const match1 = key1.match(versionPattern);
  const match2 = key2.match(versionPattern);
  if (match1 && match2 && match1[1] === match2[1]) {
    return 'versioned-key';
  }

  return undefined;
}

/**
 * Build match details showing what's similar and different
 * @param suggestion - Suggestion from suggest engine
 * @param params - Decision parameters
 * @param knex - Knex instance
 * @returns Match details object
 */
async function buildMatchDetails(
  suggestion: any,
  params: SetDecisionParams,
  knex: Knex
): Promise<{
  matches: { tags: string[]; layer?: string; key_pattern?: string };
  differs?: { tags?: string };
}> {
  // Get existing decision's tags from suggestion object (already populated by suggest engine)
  const existingTags = suggestion.tags || [];

  const paramTags = params.tags ? (Array.isArray(params.tags) ? params.tags : parseStringArray(params.tags)) : [];

  // Calculate overlaps and differences
  const matchingTags = paramTags.filter((t: string) => existingTags.includes(t));
  const differentTags = {
    existing: existingTags.filter((t: string) => !paramTags.includes(t)),
    proposed: paramTags.filter((t: string) => !existingTags.includes(t))
  };

  const result: any = {
    matches: {
      tags: matchingTags
    }
  };

  // Add layer match if same
  if (suggestion.layer && suggestion.layer === params.layer) {
    result.matches.layer = params.layer;
  }

  // Add key pattern if detected
  const pattern = detectKeyPattern(suggestion.key, params.key);
  if (pattern) {
    result.matches.key_pattern = pattern;
  }

  // Add differences if any exist
  if (differentTags.existing.length > 0 || differentTags.proposed.length > 0) {
    result.differs = {
      tags: `[${differentTags.existing.join(', ')}] vs [${differentTags.proposed.join(', ')}]`
    };
  }

  return result;
}

/**
 * Get version history preview for a decision
 * @param key - Decision key
 * @param knex - Knex instance
 * @param limit - Number of recent versions to fetch
 * @returns Array of version strings with timestamps
 */
async function getVersionHistory(
  key: string,
  knex: Knex,
  limit: number = SUGGEST_LIMITS.VERSION_HISTORY_COUNT
): Promise<string[]> {
  // Guard against undefined/null key
  if (!key) {
    return [];
  }

  // Get key_id from key name
  const keyRecord = await knex('m_context_keys')
    .where({ key_name: key })
    .select('id')
    .first();

  if (!keyRecord) {
    return []; // No history if key doesn't exist
  }

  const history = await knex('t_decision_history')
    .where({ key_id: keyRecord.id })
    .orderBy('ts', 'desc')
    .limit(limit)
    .select('version', 'ts');

  return history.map(h => {
    const timeAgo = formatTimeAgo(h.ts);
    return `${h.version} (${timeAgo})`;
  });
}

/**
 * Generate reasoning text for why a suggestion is relevant
 * @param suggestion - Suggestion object
 * @param matchDetails - Match details
 * @param isTopMatch - Whether this is the best match
 * @returns Reasoning string
 */
function generateReasoning(suggestion: any, matchDetails: any, isTopMatch: boolean): string {
  const reasons: string[] = [];

  if (matchDetails.matches.tags.length > 0) {
    reasons.push(`${matchDetails.matches.tags.length} matching tags`);
  }

  if (matchDetails.matches.layer) {
    reasons.push('same layer');
  }

  if (matchDetails.matches.key_pattern) {
    reasons.push('similar key pattern');
  }

  if (isTopMatch && reasons.length > 0) {
    return `Best match: ${reasons.join(', ')}`;
  }

  return reasons.join(', ') || 'Related decision';
}

/**
 * Build token-efficient similarity breakdown (keyword format for AI consumers)
 * @param matchDetails - Match details object
 * @returns Compact similarity breakdown string (e.g., "3_tags+layer:business+key:api/*")
 */
function buildSimilarityBreakdown(matchDetails: any): string {
  const parts: string[] = [];

  // Tags (count + keyword)
  if (matchDetails.matches.tags && matchDetails.matches.tags.length > 0) {
    parts.push(`${matchDetails.matches.tags.length}_tags`);
  }

  // Layer (keyword + value)
  if (matchDetails.matches.layer) {
    parts.push(`layer:${matchDetails.matches.layer}`);
  }

  // Key pattern (keyword + pattern)
  if (matchDetails.matches.key_pattern) {
    parts.push(`key:${matchDetails.matches.key_pattern}`);
  }

  // Value similarity indicator (if no other matches but score is high)
  if (parts.length === 0) {
    parts.push('value_similar');
  }

  return parts.join('+');
}

/**
 * Determine recommended action based on confidence scores
 * @param confidence - Confidence scores
 * @returns Recommended action
 */
function determineAction(confidence: { is_duplicate: number; should_update: number }): 'UPDATE_EXISTING' | 'REVIEW_MANUALLY' | 'CREATE_NEW' {
  if (confidence.should_update >= 0.75) {
    return 'UPDATE_EXISTING';
  } else if (confidence.is_duplicate >= 0.60) {
    return 'REVIEW_MANUALLY';
  } else {
    return 'CREATE_NEW';
  }
}

/**
 * Build complete duplicate risk warning structure
 * @param suggestions - Suggestions from suggest engine
 * @param params - Decision parameters
 * @param knex - Knex instance
 * @returns Duplicate risk warning object
 */
async function buildDuplicateRiskWarning(
  suggestions: any[],
  params: SetDecisionParams,
  knex: Knex
): Promise<any> {
  const topSuggestion = suggestions[0];
  const confidence = calculateConfidence(suggestions);

  // Enrich top N suggestions
  const enrichedSuggestions = await Promise.all(
    suggestions.slice(0, SUGGEST_LIMITS.MAX_SUGGESTIONS_NUDGE).map(async (s, idx) => {
      const matchDetails = await buildMatchDetails(s, params, knex);
      const versionHistory = await getVersionHistory(s.key, knex);
      const currentVersion = versionHistory[0]?.split(' ')[0] || '1.0.0';
      const nextVersion = incrementVersion(currentVersion);

      return {
        key: s.key,
        value: s.value,
        score: s.score,
        recommended: idx === 0, // First is best match
        ...matchDetails,
        similarity_breakdown: buildSimilarityBreakdown(matchDetails),
        last_updated: formatTimeAgo(s.ts || Math.floor(Date.now() / 1000)),
        version_info: {
          current: currentVersion,
          next_suggested: nextVersion,
          recent_changes: versionHistory
        },
        reasoning: generateReasoning(s, matchDetails, idx === 0),
        update_command: {
          key: s.key,
          value: params.value,
          version: nextVersion,
          layer: params.layer,
          tags: params.tags
        }
      };
    })
  );

  return {
    severity: 'MODERATE' as const,
    max_score: topSuggestion.score,
    recommended_action: determineAction(confidence),
    confidence,
    suggestions: enrichedSuggestions
  };
}

/**
 * Format blocking error message for high-similarity duplicates
 * @param match - Top matching suggestion (enriched)
 * @returns Formatted error message
 */
function formatBlockingError(match: any): string {
  const similarityParts: string[] = [];

  if (match.matches.tags.length > 0) {
    similarityParts.push(`${match.matches.tags.length} matching tags`);
  }
  if (match.matches.layer) {
    similarityParts.push(`same layer (${match.matches.layer})`);
  }
  if (match.matches.key_pattern) {
    similarityParts.push(`similar key pattern (${match.matches.key_pattern})`);
  }

  return `
HIGH-SIMILARITY DUPLICATE DETECTED (score: ${match.score})

Extremely similar decision exists:
  Key: "${match.key}"
  Value: "${match.value}"
  Score: ${match.score}
  Similarity: ${similarityParts.join(' + ')}
  Current Version: ${match.version_info.current}

RECOMMENDED: Update existing decision
  decision.set({
    key: "${match.key}",
    value: "YOUR_NEW_VALUE",
    version: "${match.version_info.next_suggested}"
  })

ALTERNATIVE: Force creation if truly distinct
  decision.set({
    key: "YOUR_KEY",
    value: "YOUR_VALUE",
    ignore_suggest: true,
    ignore_reason: "Explain why this is not a duplicate"
  })

This check prevents accidental duplicate decisions.
`.trim();
}

// ============================================================================
// Main Decision Operations
// ============================================================================

/**
 * Internal helper: Set decision without wrapping in transaction
 * Used by setDecision (with transaction) and setDecisionBatch (manages its own transaction)
 *
 * @param params - Decision parameters
 * @param adapter - Database adapter instance
 * @param projectId - Project ID
 * @param trx - Optional transaction
 * @returns Response with success status and metadata
 */
export async function setDecisionInternal(
  params: SetDecisionParams,
  adapter: DatabaseAdapter,
  projectId: number,
  trx?: Knex.Transaction
): Promise<SetDecisionResponse> {
  const knex = trx || adapter.getKnex();

  // Validate required parameters
  if (!params.key || params.key.trim() === '') {
    throw new Error('Parameter "key" is required and cannot be empty');
  }

  if (params.value === undefined || params.value === null) {
    throw new Error('Parameter "value" is required');
  }

  // Determine if value is numeric
  const isNumeric = typeof params.value === 'number';
  const value = params.value;

  // Validate and set status
  if (params.status && !STRING_TO_STATUS[params.status]) {
    throw new Error(`Invalid status: "${params.status}". Valid values: ${VALID_STATUSES.join(', ')}`);
  }
  const status = params.status ? STRING_TO_STATUS[params.status] : DEFAULT_STATUS;
  // Note: Agent tracking removed in v4.0 (agent param kept for API compatibility but not stored)

  // Scope validation warning (v3.8.0)
  // if (!params.scopes || params.scopes.length === 0) {
  //   console.warn(`⚠️  Decision "${params.key}" has no scope specified. Defaulting to GLOBAL scope.`);
  //   console.warn(`   💡 Consider using scopes for better organization:`);
  //   console.warn(`      - "FEATURE:<name>" for feature-specific decisions`);
  //   console.warn(`      - "COMPONENT:<name>" for component-level decisions`);
  //   console.warn(`      - "MODULE:<name>" for module-scoped decisions`);
  //   console.warn(`      - "GLOBAL" for project-wide decisions (current default)`);
  // }

  // Get or create master records
  const keyId = await getOrCreateContextKey(adapter, params.key, trx);

  // Current timestamp
  const ts = Math.floor(Date.now() / 1000);

  // Check if decision already exists for activity logging and version management
  // Always check t_decisions since all decisions now have a row there
  const existingDecision = await knex('t_decisions')
    .where({ key_id: keyId, project_id: projectId })
    .first();

  // v3.9.1: Three-tier duplicate detection (auto-trigger BEFORE decision creation)
  // Only applies to CREATE operations
  const isCreate = !existingDecision;
  const ignoreCheck = (params as any).ignore_suggest === true;

  if (isCreate && !ignoreCheck) {
    try {
      // Validate decision against policies to check if suggest_similar is enabled
      const validationResult = await validateAgainstPolicies(
        adapter,
        params.key,
        value,
        {
          rationale: (params as any).rationale,
          alternatives: (params as any).alternatives,
          tradeoffs: (params as any).tradeoffs,
          ...params
        },
        trx  // Pass transaction context
      );

      if (validationResult.matchedPolicy && validationResult.valid) {
        // Query policy to check suggest_similar flag
        const policy = await (trx || knex)('t_decision_policies')
          .where({ id: validationResult.matchedPolicy.id })
          .select('suggest_similar')
          .first();

        if (policy && policy.suggest_similar === 1) {
          // Run suggestions for duplicate detection
          const tags = params.tags ? parseStringArray(params.tags) : [];
          const suggestions = await handleSuggestAction({
            action: 'by_context',
            key: params.key,
            tags,
            layer: params.layer,
            limit: 5,
            min_score: SUGGEST_THRESHOLDS.GENTLE_NUDGE,
            knex: trx || knex
          });

          if (suggestions.count > 0) {
            const topScore = suggestions.suggestions[0].score;

            // Tier 3: Auto-update (score >= 60, v3.9.1)
            if (topScore >= SUGGEST_THRESHOLDS.AUTO_UPDATE) {
              const topSuggestion = suggestions.suggestions[0];
              const enriched = await buildDuplicateRiskWarning(
                [topSuggestion],
                params,
                trx || knex
              );

              const match = enriched.suggestions[0];

              // Auto-update existing decision instead of creating new one
              const updateParams: any = {
                key: match.key,
                value: params.value,
                version: match.version_info.next_suggested,
                layer: params.layer,
                tags: params.tags,
                rationale: params.rationale,
                alternatives: params.alternatives,
                tradeoffs: params.tradeoffs,
                agent: params.agent,
                scopes: params.scopes,
                status: params.status,
                ignore_suggest: true  // Prevent recursive duplicate detection
              };

              // Recursively call setDecisionInternal to update existing decision
              const updateResponse = await setDecisionInternal(
                updateParams,
                adapter,
                projectId,
                trx
              );

              // Return success response with auto_updated metadata
              return {
                success: true,
                auto_updated: true,
                requested_key: params.key,
                actual_key: match.key,
                similarity_score: topScore,
                version: updateResponse.version,
                duplicate_reason: {
                  similarity: match.reasoning,
                  matched_tags: match.matches.tags,
                  layer: match.matches.layer,
                  key_pattern: match.matches.key_pattern
                },
                key: updateResponse.key,
                key_id: updateResponse.key_id!,
                value: params.value,
                message: `Auto-updated existing decision "${match.key}" (similarity: ${topScore})`
              } as SetDecisionResponse;
            }

            // Tier 2: Hard block (45 <= score < 60, v3.9.1)
            if (topScore >= SUGGEST_THRESHOLDS.HARD_BLOCK) {
              const topSuggestion = suggestions.suggestions[0];
              const enriched = await buildDuplicateRiskWarning(
                [topSuggestion],
                params,
                trx || knex
              );

              // Throw blocking error
              const errorMessage = formatBlockingError(enriched.suggestions[0]);
              throw new Error(errorMessage);
            }
          }
        }
      }
    } catch (error) {
      // Hard block errors must propagate
      if (error instanceof Error && error.message.includes('DUPLICATE DETECTED')) {
        throw error;
      }
      // Other errors are non-critical - log but don't fail operation
      console.warn('[Auto-trigger] Non-blocking error (ignored):', error);
    }
  }

  // Validate layer if provided; preserve existing layer if not provided on update
  let layerId: number | null = null;
  if (params.layer) {
    if (!STANDARD_LAYERS.includes(params.layer as any)) {
      throw new Error(`Invalid layer. Must be one of: ${STANDARD_LAYERS.join(', ')}`);
    }
    layerId = await getLayerId(adapter, params.layer, trx);
    if (layerId === null) {
      throw new Error(`Layer not found in database: ${params.layer}`);
    }
  } else if (existingDecision) {
    // Preserve existing layer when updating decision without specifying layer
    layerId = existingDecision.layer_id;
  }

  // Auto-versioning logic (Task 409)
  let version: string;
  let versionAction: 'initial' | 'explicit' | 'auto_increment_major' | 'auto_increment_minor' | 'auto_increment_patch';

  if (existingDecision) {
    // Update existing decision

    if (params.version) {
      // Explicit version provided - validate and use it
      if (!isValidSemver(params.version)) {
        throw new Error(`Invalid semver format: ${params.version}. Expected MAJOR.MINOR.PATCH (e.g., "1.2.3")`);
      }
      version = params.version;
      versionAction = 'explicit';
    } else if (params.auto_increment) {
      // Auto-increment with specified level
      if (!['major', 'minor', 'patch'].includes(params.auto_increment)) {
        throw new Error(`Invalid auto_increment level: ${params.auto_increment}. Expected: major, minor, or patch`);
      }
      version = incrementSemver(existingDecision.version, params.auto_increment);
      versionAction = `auto_increment_${params.auto_increment}` as 'auto_increment_major' | 'auto_increment_minor' | 'auto_increment_patch';
    } else {
      // Default: auto-increment patch version
      version = incrementSemver(existingDecision.version, 'patch');
      versionAction = 'auto_increment_patch';
    }
  } else {
    // New decision
    if (params.version) {
      if (!isValidSemver(params.version)) {
        throw new Error(`Invalid semver format: ${params.version}. Expected MAJOR.MINOR.PATCH (e.g., "1.2.3")`);
      }
      version = params.version;
    } else {
      version = DEFAULT_VERSION;
    }
    versionAction = 'initial';
  }

  // Record history BEFORE update (only for existing decisions)
  // This preserves the previous version before it gets overwritten
  if (existingDecision) {
    await knex('t_decision_history').insert({
      key_id: keyId,
      project_id: projectId,
      version: existingDecision.version,
      value: existingDecision.value,
      ts: existingDecision.ts,
    });
  }

  // Insert or update decision
  // For ALL decisions (text and numeric), create a row in t_decisions
  // For numeric decisions, ALSO create a row in t_decisions_numeric
  // Note: agent_id removed in v4.0
  const textDecisionData = {
    key_id: keyId,
    project_id: projectId,
    value: isNumeric ? '' : String(value),  // Empty string for numeric decisions (value column is NOT NULL)
    layer_id: layerId,
    version: version,
    status: status,
    ts: ts
  };

  // Use transaction-aware upsert for t_decisions
  const conflictColumns = ['key_id', 'project_id'];
  const updateColumns = Object.keys(textDecisionData).filter(
    key => !conflictColumns.includes(key)
  );
  const updateData = updateColumns.reduce((acc, col) => {
    acc[col] = textDecisionData[col as keyof typeof textDecisionData];
    return acc;
  }, {} as Record<string, any>);

  await knex('t_decisions')
    .insert(textDecisionData)
    .onConflict(conflictColumns)
    .merge(updateData);

  // For numeric decisions, ALSO insert into t_decisions_numeric
  // Note: agent_id removed in v4.0
  if (isNumeric) {
    const numericDecisionData = {
      key_id: keyId,
      project_id: projectId,
      value: value as number,
      layer_id: layerId,
      version: version,
      status: status,
      ts: ts
    };

    const numericUpdateData = updateColumns.reduce((acc, col) => {
      acc[col] = numericDecisionData[col as keyof typeof numericDecisionData];
      return acc;
    }, {} as Record<string, any>);

    await knex('t_decisions_numeric')
      .insert(numericDecisionData)
      .onConflict(conflictColumns)
      .merge(numericUpdateData);
  }

  // Handle m_tags (many-to-many) and t_tag_index (for search optimization)
  if (params.tags && params.tags.length > 0) {
    const tags = parseStringArray(params.tags);

    // Clear existing tags for this project
    await knex('t_decision_tags')
      .where({ decision_key_id: keyId, project_id: projectId })
      .delete();

    // Clear existing tag index entries for this decision
    await knex('t_tag_index')
      .where({ source_type: 'decision', source_id: keyId, project_id: projectId })
      .delete();

    // Insert new tags
    for (const tagName of tags) {
      const tagId = await getOrCreateTag(adapter, projectId, tagName, trx);
      await knex('t_decision_tags').insert({
        decision_key_id: keyId,
        tag_id: tagId,
        project_id: projectId
      });

      // Also insert into t_tag_index for search optimization
      await knex('t_tag_index')
        .insert({
          tag: tagName,
          source_type: 'decision',
          source_id: keyId,
          project_id: projectId,
          created_ts: ts
        })
        .onConflict(['tag', 'source_type', 'source_id', 'project_id'])
        .ignore();
    }
  }

  // Handle m_scopes (many-to-many)
  if (params.scopes && params.scopes.length > 0) {
    const scopes = parseStringArray(params.scopes);

    // Clear existing scopes for this project
    await knex('t_decision_scopes')
      .where({ decision_key_id: keyId, project_id: projectId })
      .delete();

    // Insert new scopes
    for (const scopeName of scopes) {
      const scopeId = await getOrCreateScope(adapter, projectId, scopeName, trx);
      await knex('t_decision_scopes').insert({
        decision_key_id: keyId,
        scope_id: scopeId,
        project_id: projectId
      });
    }
  }

  // Keep the FTS search index in sync (SQLite only; failures are logged, never thrown)
  await ftsUpsertDecision(knex, {
    keyId,
    projectId,
    keyName: params.key,
    value: String(value),
  });
  scheduleSnapshotRefresh();

  // Build response object
  const response: SetDecisionResponse = {
    success: true,
    key: params.key,
    key_id: keyId,
    version: version,
    version_action: versionAction,
    message: existingDecision
      ? `Decision "${params.key}" updated to version ${version}`
      : `Decision "${params.key}" created at version ${version}`
  };

  // v3.9.1: Tier 1 gentle nudge (post-creation warning for CREATE operations)
  // Tier 2 (hard block) and Tier 3 (auto-update) already handled before decision creation
  if (isCreate && !ignoreCheck) {
    try {
      const validationResult = await validateAgainstPolicies(
        adapter,
        params.key,
        value,
        {
          rationale: (params as any).rationale,
          alternatives: (params as any).alternatives,
          tradeoffs: (params as any).tradeoffs,
          ...params
        },
        trx
      );

      // Add policy validation result to response
      if (validationResult.matchedPolicy) {
        response.policy_validation = {
          matched_policy: validationResult.matchedPolicy.name,
          violations: validationResult.violations
        };
      }

      if (validationResult.matchedPolicy && validationResult.valid) {
        const policy2 = await (trx || knex)('t_decision_policies')
          .where({ id: validationResult.matchedPolicy.id })
          .select('suggest_similar')
          .first();

        if (policy2 && policy2.suggest_similar === 1) {
          // Run suggestions for gentle nudge warning
          const tags = params.tags ? parseStringArray(params.tags) : [];
          const suggestions = await handleSuggestAction({
            action: 'by_context',
            key: params.key,
            tags,
            layer: params.layer,
            limit: 5,
            min_score: SUGGEST_THRESHOLDS.GENTLE_NUDGE,
            knex: trx || knex
          });

          if (suggestions.count > 0) {
            const topScore = suggestions.suggestions[0].score;

            // Tier 1: Gentle nudge (35 <= score < 45, v3.9.1)
            // Note: Tier 2/3 already handled before decision creation
            if (topScore >= SUGGEST_THRESHOLDS.GENTLE_NUDGE && topScore < SUGGEST_THRESHOLDS.HARD_BLOCK) {
              const topSuggestions = suggestions.suggestions.slice(0, SUGGEST_LIMITS.MAX_SUGGESTIONS_NUDGE);
              const duplicateRisk = await buildDuplicateRiskWarning(
                topSuggestions,
                params,
                trx || knex
              );

              // Add duplicate_risk to response (non-blocking)
              (response as any).duplicate_risk = duplicateRisk;
            }
          }
        }
      }
    } catch (error) {
      // Errors in post-creation warning are non-critical
      console.warn('[Gentle nudge warning] Non-blocking error (ignored):', error);
    }
  }

  // v4.1.0: Decision-Constraint Integration
  // Automatically suggest related constraints when creating/updating decisions
  if (params.suggest_constraints !== false) {
    try {
      const tags = params.tags ? parseStringArray(params.tags) : [];
      const relatedConstraints = await constraintByContext({
        text: typeof value === 'string' ? value : String(value),
        tags,
        layer: params.layer,
        limit: 3,
        min_score: 35,
        knex: trx || knex
      });

      if (relatedConstraints.count > 0) {
        response.related_constraints = relatedConstraints.suggestions.map(s => ({
          id: s.id,
          constraint_text: s.constraint_text,
          category: s.category,
          score: s.score,
          reason: s.reason,
          layer: s.layer,
          tags: s.tags
        }));
      }
    } catch (err) {
      // Don't fail the decision creation if constraint suggestion fails
      console.error('[Decision-Constraint Integration] Failed to suggest constraints:', err);
    }
  }

  return response;
}
