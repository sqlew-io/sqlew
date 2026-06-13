/**
 * Plan Processor - Shared logic for plan pattern extraction and queue registration
 *
 * Consolidates duplicate logic from on-exit-plan.ts and on-subagent-stop.ts.
 * Single source of truth for:
 * - Pattern extraction from plan files
 * - Queue registration of decisions/constraints
 * - Plan state management (recorded flag)
 *
 * @since v4.2.5
 */

import { readFileSync, existsSync } from 'fs';
import { loadCurrentPlan, saveCurrentPlan, type CurrentPlanInfo } from '../../config/global-config.js';
import { enqueueDecisionCreate, enqueueConstraintCreate, enqueueDecisionContextCreate } from '../../utils/hook-queue.js';
import { debugLog } from '../../utils/debug-logger.js';
import {
  extractPatternsFromPlan,
  hasPatterns,
  resolvePlanPath,
  buildConfirmationMessage,
  type ExtractionResult,
} from './plan-pattern-extractor.js';

// ============================================================================
// Types
// ============================================================================

/** Result of processing plan patterns */
export interface ProcessPlanResult {
  /** Whether processing was performed */
  processed: boolean;
  /** Reason for skipping (if not processed) */
  skipReason?: string;
  /** Extracted patterns (if processed) */
  extracted?: ExtractionResult;
  /** Confirmation message for user (if processed) */
  confirmationMessage?: string;
}

// ============================================================================
// Main Processing Function
// ============================================================================

/**
 * Process plan patterns and enqueue decisions/constraints
 *
 * This is the single entry point for plan pattern processing.
 * Both on-exit-plan and on-subagent-stop should call this function.
 *
 * Flow:
 * 1. Load current plan info
 * 2. Check if already recorded (skip if true)
 * 3. Read plan file content
 * 4. Extract patterns (decisions/constraints)
 * 5. Enqueue items for registration
 * 6. Mark plan as recorded
 * 7. Return confirmation message
 *
 * @param projectPath - Project root path
 * @returns Processing result with status and message
 */
export function processPlanPatterns(projectPath: string): ProcessPlanResult {
  // Load current plan info
  const planInfo = loadCurrentPlan(projectPath);
  if (!planInfo?.plan_file) {
    debugLog('DEBUG', '[plan-processor] Skip: no_active_plan', { projectPath });
    return { processed: false, skipReason: 'no_active_plan' };
  }

  // DUPLICATE PREVENTION: Skip if already processed
  if (planInfo.recorded) {
    return { processed: false, skipReason: 'already_recorded' };
  }

  // Resolve plan file path
  // Prefer explicit plan_path (Grok Build + future envs) over legacy plan_file + GLOBAL_PLANS_DIR resolution (Claude)
  let planPath: string | null = null;
  if (planInfo.plan_path && existsSync(planInfo.plan_path)) {
    planPath = planInfo.plan_path;
  } else {
    planPath = resolvePlanPath(planInfo.plan_file);
  }
  if (!planPath) {
    debugLog('DEBUG', '[plan-processor] Skip: plan_file_not_found', {
      projectPath,
      plan_path: planInfo.plan_path,
      plan_file: planInfo.plan_file,
    });
    return { processed: false, skipReason: 'plan_file_not_found' };
  }

  // Read plan content
  let content: string;
  try {
    content = readFileSync(planPath, 'utf-8');
  } catch {
    return { processed: false, skipReason: 'read_error' };
  }

  // Check for patterns (quick check)
  if (!hasPatterns(content)) {
    return { processed: false, skipReason: 'no_patterns' };
  }

  // Extract patterns
  const extracted = extractPatternsFromPlan(content);

  if (extracted.decisions.length === 0 && extracted.constraints.length === 0) {
    return { processed: false, skipReason: 'no_valid_patterns' };
  }

  // Enqueue items
  const planIdTag = planInfo.plan_id.slice(0, 8);

  for (const decision of extracted.decisions) {
    const extractedTags = decision.tags
      ? decision.tags.split(',').map(t => t.trim()).filter(t => t)
      : [];
    const allTags = ['plan', 'auto-extracted', planIdTag, ...extractedTags];

    enqueueDecisionCreate(projectPath, {
      key: decision.key,
      value: decision.value,
      status: 'active',  // Use active for suggest/duplicate detection
      layer: decision.layer || 'cross-cutting',
      tags: allTags,
    });

    // Enqueue decision context if rationale exists (after DecisionCreate for ordering)
    if (decision.rationale) {
      enqueueDecisionContextCreate(projectPath, {
        key: decision.key,
        rationale: decision.rationale,
        alternatives: decision.alternatives,
        tradeoffs: decision.tradeoffs,
      });
    }
  }

  for (const constraint of extracted.constraints) {
    const extractedTags = constraint.tags
      ? constraint.tags.split(',').map(t => t.trim()).filter(t => t)
      : [];
    const allTags = ['plan', 'auto-extracted', planIdTag, ...extractedTags];

    enqueueConstraintCreate(projectPath, {
      text: constraint.rule,
      category: constraint.category,
      priority: constraint.priority || 'medium',
      layer: 'cross-cutting',
      tags: allTags,
      reason: constraint.reason,
      active: true,
      plan_id: planInfo.plan_id,
    });
  }

  // Mark plan as recorded (CRITICAL: prevents duplicate processing)
  const updatedInfo: CurrentPlanInfo = {
    ...planInfo,
    recorded: true,
    decision_pending: false,
    plan_updated_at: new Date().toISOString(),
  };
  saveCurrentPlan(projectPath, updatedInfo);

  // Build confirmation message
  const confirmationMessage = buildConfirmationMessage(extracted, planInfo.plan_file);

  return {
    processed: true,
    extracted,
    confirmationMessage,
  };
}
