/**
 * Save Hook Command
 *
 * PostToolUse hook for Edit|Write:
 * - Always enqueue a plan-less draft decision create from the file path (NO DB)
 * - With a tracked unrecorded plan: also promote decisions/constraints once
 *
 * Usage:
 *   echo '{"tool_name": "Write", "tool_input": {"file_path": "src/foo.ts"}}' | sqlew save
 *
 * @since v4.1.0
 * @updated v5.4.x - Plan-less Write path enqueues draft to pending.json (no DB)
 * @updated v5.4.x - Draft enqueue is not gated on absence of a tracked plan
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

/**
 * Result of processing one Edit|Write save hook invocation.
 *
 * Draft enqueue and plan promote are independent concerns:
 * - Draft always runs for implementation files (ignores `recorded`)
 * - Plan promote is one-shot via `implementation_started` (not `recorded`)
 *
 * `recorded` belongs to plan-processor / SubagentStop (skip re-extracting the
 * same plan body). Reusing it here previously blocked plan-less drafts by
 * accident — that coupling is removed.
 */
export interface SaveHookResult {
  /** Early-out (wrong tool / non-impl file) — caller should sendContinue */
  skipped: boolean;
  draft?: { key: string; relPath: string };
  /** One-shot plan status transition ran on this invocation */
  planPromoted?: { planFile: string; planId: string };
}

export interface ProcessSaveHookInput {
  projectPath: string;
  toolName?: string;
  filePath?: string;
  client?: HookClient | string | null;
  summary?: string;
}

/**
 * Core save-hook logic (testable without stdin).
 *
 * Plan-less draft enqueue is never gated on session-cache plan presence or
 * `recorded`. Promote uses `implementation_started` so save never mutates
 * the extraction-dedup flag that SubagentStop / ExitPlanMode rely on.
 */
export function processSaveHook(input: ProcessSaveHookInput): SaveHookResult {
  const { projectPath, toolName, filePath, client, summary } = input;

  if (toolName !== 'Edit' && toolName !== 'Write') {
    return { skipped: true };
  }

  if (!isImplementationFile(filePath) || !filePath) {
    return { skipped: true };
  }

  // Always enqueue plan-less draft (keys are `{client}/auto/...`, distinct from plan/)
  const draft = enqueueDraftFromWrite(projectPath, filePath, { client, summary });

  let planPromoted: SaveHookResult['planPromoted'];
  const planInfo = loadCurrentPlan(projectPath);
  if (planInfo && !planInfo.implementation_started) {
    // One-shot promote only — do NOT set `recorded` (that flag is for extraction dedup)
    enqueueDecisionUpdate(projectPath, {
      key: `plan/${planInfo.plan_file.replace(/\.md$/, '')}`,
      status: IN_PROGRESS_STATUS,
      tags: ['plan', planInfo.plan_id.slice(0, 8)],
    });

    enqueueConstraintActivate(projectPath, planInfo.plan_id);

    const updatedInfo: CurrentPlanInfo = {
      ...planInfo,
      implementation_started: true,
      plan_updated_at: new Date().toISOString(),
    };
    saveCurrentPlan(projectPath, updatedInfo);

    planPromoted = {
      planFile: planInfo.plan_file,
      planId: planInfo.plan_id,
    };
  }

  return { skipped: false, draft, planPromoted };
}

function buildSaveContextMessage(result: SaveHookResult): string {
  const parts: string[] = [];
  if (result.draft) {
    parts.push(
      `Queued draft decision ${result.draft.key} for ${result.draft.relPath} (flush on Stop / QueueWatcher)`,
    );
  }
  if (result.planPromoted) {
    parts.push(
      `Implementation started for plan: ${result.planPromoted.planFile} | ` +
        `Queued: decisions → in_progress, constraints → active`,
    );
  }
  return `[sqlew] ${parts.join(' | ')}`;
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Main save command entry point
 *
 * Called as PostToolUse hook when Edit|Write completes.
 * Always enqueues draft for implementation files; may also promote a tracked plan once.
 */
export async function saveCommand(): Promise<void> {
  try {
    const input = await readStdinJson();

    const projectPath = getProjectPath(input);
    if (!projectPath) {
      sendContinue();
      return;
    }

    const filePath =
      (input.tool_input?.file_path as string | undefined) ||
      (input.tool_input?.path as string | undefined);

    const summary =
      typeof input.tool_response?.summary === 'string'
        ? input.tool_response.summary
        : undefined;

    const result = processSaveHook({
      projectPath,
      toolName: input.tool_name,
      filePath,
      client: input.client,
      summary,
    });

    if (result.skipped || !result.draft) {
      sendContinue();
      return;
    }

    // PostToolUse inject — shape depends on stdin client (Cursor/Claude/Grok/omp/Codex).
    sendPostToolUseContext(buildSaveContextMessage(result), input.client);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[sqlew save] Error: ${message}`);
    sendContinue();
  }
}
