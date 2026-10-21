/**
 * Shared queue item processor (QueueWatcher + flush-queue CLI)
 *
 * Decision `create` is upsert-by-key: update if the key exists, insert if not.
 * Uses decision.set with ignore_suggest so auto-drafts are not blocked by
 * HighSimilarity / duplicate-detection policies.
 *
 * @since v5.4.x
 */

import type { ToolBackend } from '../backend/types.js';
import { debugLog } from './debug-logger.js';
import type {
  QueueItem,
  DecisionQueueItem,
  ConstraintQueueItem,
  DecisionContextQueueItem,
} from './hook-queue.js';

/**
 * Process a single queue item against a ToolBackend.
 */
export async function processQueueItem(
  backend: ToolBackend,
  item: QueueItem,
  callId?: string
): Promise<void> {
  if (item.type === 'decision') {
    await processDecisionItem(backend, item as DecisionQueueItem, callId);
  } else if (item.type === 'constraint') {
    await processConstraintItem(backend, item as ConstraintQueueItem, callId);
  } else if (item.type === 'decision_context') {
    await processDecisionContextItem(backend, item as DecisionContextQueueItem, callId);
  }
}

/**
 * Decision create → upsert by key (set + ignore_suggest).
 * Decision update → set (status / fields).
 */
async function processDecisionItem(
  backend: ToolBackend,
  item: DecisionQueueItem,
  callId?: string
): Promise<void> {
  const { action, data } = item;

  debugLog('INFO', '[queue-processor] Processing decision', {
    callId,
    action,
    key: data.key,
  });

  if (action === 'create') {
    // Upsert-by-key: set inserts or updates; ignore_suggest avoids failed-queue
    // spam for path-keyed auto drafts that look similar to existing ADRs.
    const params: Record<string, unknown> = {
      key: data.key,
      value: data.value ?? `Draft: ${data.key}`,
      status: data.status ?? 'draft',
      ignore_suggest: true,
    };
    if (data.layer) params.layer = data.layer;
    if (data.tags) params.tags = data.tags;

    if (data.layer || (data.tags && data.tags.length > 0)) {
      await backend.execute('decision', 'set', params);
    } else {
      // Minimal payload — let quick_set infer layer/tags, still upsert
      await backend.execute('decision', 'quick_set', params);
    }
  } else if (action === 'update') {
    await backend.execute('decision', 'set', {
      key: data.key,
      value: data.value || `Updated: ${data.key}`,
      status: data.status,
      layer: data.layer,
      tags: data.tags,
      ignore_suggest: true,
    });
  }
}

async function processConstraintItem(
  backend: ToolBackend,
  item: ConstraintQueueItem,
  callId?: string
): Promise<void> {
  const { action, data } = item;

  debugLog('INFO', '[queue-processor] Processing constraint', {
    callId,
    action,
    text: data.text?.slice(0, 50),
    category: data.category,
  });

  if (action === 'create') {
    const priority = data.priority || 'medium';
    await backend.execute<{ success: boolean; constraint_id: number }>('constraint', 'add', {
      constraint_text: data.text,
      category: data.category || 'architecture',
      priority,
      layer: data.layer,
      tags: data.tags,
      reason: data.reason,
      active: data.active ?? true,
    });
  } else if (action === 'activate') {
    if (data.plan_id) {
      const tag = data.plan_id.slice(0, 8);
      await backend.execute<{ success: boolean; activated_count: number }>(
        'constraint',
        'activate_by_tag',
        { tag }
      );
    }
  }
}

async function processDecisionContextItem(
  backend: ToolBackend,
  item: DecisionContextQueueItem,
  callId?: string
): Promise<void> {
  const { data } = item;

  debugLog('INFO', '[queue-processor] Processing decision_context', {
    callId,
    key: data.key,
    rationalePreview: data.rationale?.slice(0, 50),
  });

  let alternatives: string | null = null;
  if (data.alternatives) {
    const parts = data.alternatives.split(',').map(s => s.trim()).filter(Boolean);
    alternatives = JSON.stringify(parts);
  }

  await backend.execute('decision', 'add_decision_context', {
    key: data.key,
    rationale: data.rationale,
    alternatives_considered: alternatives,
    tradeoffs: data.tradeoffs || null,
  });
}
