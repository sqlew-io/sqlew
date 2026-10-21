/**
 * Save Hook Command
 *
 * PostToolUse hook for Edit|Write:
 * - With a tracked plan: promote decisions/constraints when implementation starts
 * - Plan-less: enqueue a draft decision create from the file path (NO DB)
 *
 * Usage:
 *   echo '{"tool_name": "Write", "tool_input": {"file_path": "src/foo.ts"}}' | sqlew save
 *
 * @since v4.1.0
 * @updated v5.4.x - Plan-less Write path enqueues draft to pending.json (no DB)
 */

import { resolve as pathResolve, relative as pathRelative, basename } from 'path';
import { readStdinJson, sendContinue, sendPostToolUseContext, getProjectPath, type HookClient } from './stdin-parser.js';
import { loadCurrentPlan, saveCurrentPlan, type CurrentPlanInfo } from '../../config/global-config.js';
import { enqueueDecisionCreate, enqueueDecisionUpdate, enqueueConstraintActivate } from '../../utils/hook-queue.js';

// ============================================================================
// Constants
// ============================================================================

/** Status for in-progress decisions (plan promote) */
const IN_PROGRESS_STATUS = 'in_progress' as const;

/** Status for plan-less auto drafts */
const DRAFT_STATUS = 'draft' as const;

/** Lockfile / package noise basenames */
const NOISE_BASENAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'composer.lock',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
]);

// ============================================================================
// Helpers (exported for unit tests)
// ============================================================================

/**
 * Check if a file path is an implementation file (not docs/config/noise)
 */
export function isImplementationFile(filePath: string | undefined): boolean {
  if (!filePath) return false;

  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const base = basename(normalized);

  if (NOISE_BASENAMES.has(base)) return false;

  // Exclude markdown files
  if (normalized.endsWith('.md')) return false;

  // Exclude plan files explicitly
  if (
    normalized.includes('.claude/plans/') ||
    normalized.includes('.hermes/plans/') ||
    normalized.includes('.sqlew/plans/')
  ) {
    return false;
  }

  // Exclude documentation directories
  if (normalized.includes('/docs/') || normalized.startsWith('docs/')) return false;

  // Exclude sqlew runtime / queue / snapshots
  if (
    normalized.includes('/.sqlew/') ||
    normalized.startsWith('.sqlew/')
  ) {
    return false;
  }

  // Exclude node_modules / vendor
  if (
    normalized.includes('/node_modules/') ||
    normalized.startsWith('node_modules/') ||
    normalized.includes('/vendor/') ||
    normalized.startsWith('vendor/')
  ) {
    return false;
  }

  // Exclude config files that aren't really implementation (allow under src/)
  const underSrc =
    normalized.includes('/src/') || normalized.startsWith('src/');
  if (normalized.endsWith('.json') && !underSrc) return false;

  return true;
}

/**
 * Relativize an absolute or project-relative file path to project root.
 */
export function toProjectRelativePath(projectPath: string, filePath: string): string {
  const root = pathResolve(projectPath);
  const abs = pathResolve(filePath);
  let rel = pathRelative(root, abs).replace(/\\/g, '/');
  if (rel.startsWith('../') || rel === '..') {
    // Outside project — keep basename-ish path without leading slashes
    rel = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  }
  return rel.replace(/^\.\//, '');
}

/**
 * Build draft decision key: `{client}/auto/{rel}` or `auto/{rel}`.
 * Matches Cursor plugin convention `cursor/auto/<rel-path>` when client=cursor.
 */
export function buildDraftDecisionKey(
  relPath: string,
  client?: HookClient | string | null
): string {
  const safe = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const prefix =
    typeof client === 'string' && client.trim() !== ''
      ? `${client.trim().toLowerCase()}/auto`
      : 'auto';
  return `${prefix}/${safe}`;
}

/**
 * Enqueue a plan-less draft decision create (NO DB).
 * Dedupes by key inside enqueueDecisionCreate.
 *
 * @returns true if enqueued (or already queued), false if skipped by gate
 */
export function enqueueDraftFromWrite(
  projectPath: string,
  filePath: string,
  options?: {
    client?: HookClient | string | null;
    summary?: string;
  }
): { enqueued: boolean; key: string; relPath: string } {
  const relPath = toProjectRelativePath(projectPath, filePath);
  const key = buildDraftDecisionKey(relPath, options?.client);
  const value =
    options?.summary?.trim() ||
    `Draft from Write: ${relPath}`;

  enqueueDecisionCreate(projectPath, {
    key,
    value,
    status: DRAFT_STATUS,
    layer: 'cross-cutting',
    tags: ['auto-draft', 'from-write'],
  });

  return { enqueued: true, key, relPath };
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Main save command entry point
 *
 * Called as PostToolUse hook when Edit|Write completes.
 * Plan path: promote decisions / activate constraints.
 * Plan-less: enqueue draft decision create (pending.json only).
 */
export async function saveCommand(): Promise<void> {
  try {
    const input = await readStdinJson();

    // Only process Edit and Write tools
    const toolName = input.tool_name;
    if (toolName !== 'Edit' && toolName !== 'Write') {
      sendContinue();
      return;
    }

    const projectPath = getProjectPath(input);
    if (!projectPath) {
      sendContinue();
      return;
    }

    // Get file path from tool input
    const filePath =
      (input.tool_input?.file_path as string | undefined) ||
      (input.tool_input?.path as string | undefined);

    // Only process implementation files
    if (!isImplementationFile(filePath)) {
      sendContinue();
      return;
    }

    // Check if there's a current plan being tracked
    const planInfo = loadCurrentPlan(projectPath);
    if (!planInfo) {
      // Plan-less: enqueue draft only (NO DB / NO MCP decision set)
      const summary =
        typeof input.tool_response?.summary === 'string'
          ? input.tool_response.summary
          : undefined;
      const { key, relPath } = enqueueDraftFromWrite(projectPath, filePath!, {
        client: input.client,
        summary,
      });
      sendPostToolUseContext(
        `[sqlew] Queued draft decision ${key} for ${relPath} (flush on Stop / QueueWatcher)`,
        input.client,
      );
      return;
    }

    // Check if already recorded for this plan
    if (planInfo.recorded) {
      // Already recorded - no need to record again
      sendContinue();
      return;
    }

    // Enqueue decision status update: draft → in_progress
    // This will update all decisions with the plan_id tag
    enqueueDecisionUpdate(projectPath, {
      key: `plan/${planInfo.plan_file.replace(/\.md$/, '')}`,
      status: IN_PROGRESS_STATUS,
      tags: ['plan', planInfo.plan_id.slice(0, 8)],
    });

    // Enqueue constraint activation: active=0 → active=1
    enqueueConstraintActivate(projectPath, planInfo.plan_id);

    // Mark plan as recorded (implementation started)
    const updatedInfo: CurrentPlanInfo = {
      ...planInfo,
      recorded: true,
      decision_pending: false,
      plan_updated_at: new Date().toISOString(),
    };
    saveCurrentPlan(projectPath, updatedInfo);

    // PostToolUse inject — shape depends on stdin client (Cursor/Claude/Grok/omp/Codex).
    sendPostToolUseContext(
      `[sqlew] Implementation started for plan: ${planInfo.plan_file} | ` +
      `Queued: decisions → in_progress, constraints → active`,
      input.client,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[sqlew save] Error: ${message}`);
    sendContinue();
  }
}
