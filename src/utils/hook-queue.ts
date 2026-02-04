/**
 * Hook Queue System
 *
 * File-based queue for async decision operations.
 * Hooks write to queue (fast), MCP server processes on startup.
 *
 * @since v4.1.0
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { debugLog } from './debug-logger.js';

// ============================================================================
// Debug Configuration
// ============================================================================

/**
 * Enable detailed trace logging for queue operations.
 * Set to `true` when debugging queue issues (writes to .sqlew/queue/trace.log)
 *
 * Also controls:
 * - snapshot_*.json files (per-write snapshots)
 * - pending-debug.json (write history)
 */
const QUEUE_TRACE_ENABLED = false;

// ============================================================================
// File Lock for Queue Processing
// ============================================================================

/** Lock timeout in milliseconds (30 seconds) */
const LOCK_TIMEOUT_MS = 30000;

/**
 * Try to acquire a lock for queue processing
 * Uses file-based locking with timestamp for stale lock detection
 *
 * @param projectPath - Project root path
 * @returns true if lock acquired, false if another process holds the lock
 */
export function tryAcquireLock(projectPath: string): boolean {
  const lockPath = join(projectPath, '.sqlew/queue/pending.lock');

  if (existsSync(lockPath)) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));
      const age = Date.now() - lock.timestamp;
      if (age < LOCK_TIMEOUT_MS) {
        debugLog('INFO', '[hook-queue] Lock held by another process', {
          pid: lock.pid,
          ageMs: age,
        });
        return false; // Lock still valid, skip processing
      }
      debugLog('WARN', '[hook-queue] Stale lock detected, overwriting', {
        pid: lock.pid,
        ageMs: age,
      });
    } catch {
      // Lock file corrupted, overwrite it
      debugLog('WARN', '[hook-queue] Corrupted lock file, overwriting');
    }
  }

  // Acquire lock
  try {
    writeFileSync(lockPath, JSON.stringify({
      pid: process.pid,
      timestamp: Date.now(), // Unix epoch ms (timezone-independent)
    }));
    debugLog('INFO', '[hook-queue] Lock acquired', { pid: process.pid });
    return true;
  } catch (error) {
    debugLog('ERROR', '[hook-queue] Failed to acquire lock', { error });
    return false;
  }
}

/**
 * Release the queue processing lock
 *
 * @param projectPath - Project root path
 */
export function releaseLock(projectPath: string): void {
  const lockPath = join(projectPath, '.sqlew/queue/pending.lock');
  try {
    unlinkSync(lockPath);
    debugLog('INFO', '[hook-queue] Lock released');
  } catch {
    // Ignore errors (file may already be deleted)
  }
}

// ============================================================================
// Types
// ============================================================================

/** Queue item action type */
export type QueueAction = 'create' | 'update' | 'activate';

/** Queue item for decision operations */
export interface DecisionQueueItem {
  type: 'decision';
  action: QueueAction;
  timestamp: string;
  data: {
    key: string;
    value?: string;
    status?: string;
    layer?: string;
    tags?: string[];
  };
}

/** Queue item for constraint operations */
export interface ConstraintQueueItem {
  type: 'constraint';
  action: QueueAction;
  timestamp: string;
  data: {
    text: string;
    category?: string;
    priority?: string;
    layer?: string;
    tags?: string[];
    active?: boolean;
    plan_id?: string;
  };
}

/** Queue item for decision context operations */
export interface DecisionContextQueueItem {
  type: 'decision_context';
  action: 'create';
  timestamp: string;
  data: {
    /** Decision key to attach context to */
    key: string;
    /** Why this decision was made (required) */
    rationale: string;
    /** Alternatives considered (comma-separated) */
    alternatives?: string;
    /** Tradeoffs description */
    tradeoffs?: string;
  };
}

/** Union type for all queue items */
export type QueueItem = DecisionQueueItem | ConstraintQueueItem | DecisionContextQueueItem;

/** Queue file structure */
export interface QueueFile {
  items: QueueItem[];
}

/** Failed queue item (includes original item + error info) */
export interface FailedQueueItem {
  item: QueueItem;
  error: string;
  failedAt: string;
}

/** Failed queue file structure */
export interface FailedQueueFile {
  items: FailedQueueItem[];
}

// ============================================================================
// Constants
// ============================================================================

/** Queue directory relative to project root */
const QUEUE_DIR = '.sqlew/queue';

/** Queue file name */
const QUEUE_FILE = 'pending.json';

/** Failed queue file name (for items that cannot be retried) */
const FAILED_QUEUE_FILE = 'failed.json';

// ============================================================================
// Queue File Operations
// ============================================================================

/**
 * Get queue file path for a project
 */
export function getQueuePath(projectPath: string): string {
  return join(projectPath, QUEUE_DIR, QUEUE_FILE);
}

/**
 * Get failed queue file path for a project
 */
export function getFailedQueuePath(projectPath: string): string {
  return join(projectPath, QUEUE_DIR, FAILED_QUEUE_FILE);
}

/**
 * Ensure queue directory exists
 */
function ensureQueueDir(projectPath: string): void {
  const queueDir = join(projectPath, QUEUE_DIR);
  if (!existsSync(queueDir)) {
    mkdirSync(queueDir, { recursive: true });
  }
}

/**
 * Append failed items to failed queue file
 *
 * Items that fail processing (e.g., HighSimilarity errors) are moved here
 * instead of being retried in pending.json indefinitely.
 *
 * @param projectPath - Project root path
 * @param errors - Array of failed items with error messages
 */
export function appendToFailedQueue(
  projectPath: string,
  errors: Array<{ item: QueueItem; error: string }>
): void {
  if (errors.length === 0) return;

  ensureQueueDir(projectPath);
  const failedPath = getFailedQueuePath(projectPath);

  // Read existing failed queue
  let failedQueue: FailedQueueFile = { items: [] };
  if (existsSync(failedPath)) {
    try {
      const parsed = JSON.parse(readFileSync(failedPath, 'utf-8'));
      // Validate structure - items must be an array
      if (parsed && Array.isArray(parsed.items)) {
        failedQueue = parsed as FailedQueueFile;
      }
      // else: keep default { items: [] }
    } catch {
      // Corrupted file, start fresh
      failedQueue = { items: [] };
    }
  }

  // Append new failed items
  const now = new Date().toISOString();
  for (const { item, error } of errors) {
    failedQueue.items.push({
      item,
      error,
      failedAt: now,
    });
  }

  // Write atomically
  const tempPath = failedPath + '.tmp';
  writeFileSync(tempPath, JSON.stringify(failedQueue, null, 2), 'utf-8');
  try {
    renameSync(tempPath, failedPath);
  } catch {
    writeFileSync(failedPath, JSON.stringify(failedQueue, null, 2), 'utf-8');
    try { unlinkSync(tempPath); } catch { /* ignore */ }
  }

  debugLog('INFO', '[hook-queue] Appended failed items to failed queue', {
    count: errors.length,
    failedPath,
  });
}

/**
 * Read failed queue file
 */
export function readFailedQueue(projectPath: string): FailedQueueFile {
  const failedPath = getFailedQueuePath(projectPath);
  if (!existsSync(failedPath)) {
    return { items: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(failedPath, 'utf-8'));
    // Validate structure - items must be an array
    if (!parsed || !Array.isArray(parsed.items)) {
      debugLog('WARN', '[hook-queue] readFailedQueue: invalid structure', { failedPath });
      return { items: [] };
    }
    return parsed as FailedQueueFile;
  } catch {
    return { items: [] };
  }
}

/**
 * Clear failed queue file
 */
export function clearFailedQueue(projectPath: string): void {
  const failedPath = getFailedQueuePath(projectPath);
  if (existsSync(failedPath)) {
    unlinkSync(failedPath);
    debugLog('INFO', '[hook-queue] Cleared failed queue', { failedPath });
  }
}

/**
 * Write to queue trace log (debugLog-independent for Hook CLI)
 * Logs ALL operations for debugging Hook flow
 *
 * @note Controlled by QUEUE_TRACE_ENABLED flag
 */
function writeQueueTrace(projectPath: string, level: 'INFO' | 'WARN' | 'ERROR', message: string, data?: Record<string, unknown>): void {
  if (!QUEUE_TRACE_ENABLED) return;
  try {
    const traceLogPath = join(projectPath, QUEUE_DIR, 'trace.log');
    const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
    const entry = `[${new Date().toISOString()}] [${level}] [PID:${process.pid}] ${message}${dataStr}\n`;
    appendFileSync(traceLogPath, entry, 'utf-8');
  } catch { /* ignore */ }
}

/**
 * Read queue file (returns empty queue if not exists)
 */
export function readQueue(projectPath: string): QueueFile {
  const queuePath = getQueuePath(projectPath);
  writeQueueTrace(projectPath, 'INFO', 'readQueue: START', { queuePath });

  if (!existsSync(queuePath)) {
    writeQueueTrace(projectPath, 'INFO', 'readQueue: file does not exist, returning empty');
    debugLog('DEBUG', '[hook-queue] readQueue: file does not exist', { queuePath });
    return { items: [] };
  }
  try {
    const content = readFileSync(queuePath, 'utf-8');
    writeQueueTrace(projectPath, 'INFO', 'readQueue: read file', {
      contentLength: content.length,
      contentPreview: content.slice(0, 100),
    });
    debugLog('DEBUG', '[hook-queue] readQueue: read file', {
      queuePath,
      contentLength: content.length,
      contentPreview: content.slice(0, 100),
    });
    const parsed = JSON.parse(content);
    // Validate structure - items must be an array
    if (!parsed || !Array.isArray(parsed.items)) {
      writeQueueTrace(projectPath, 'WARN', 'readQueue: invalid structure, returning empty', {
        hasItems: !!parsed?.items,
        isArray: Array.isArray(parsed?.items),
      });
      debugLog('WARN', '[hook-queue] readQueue: invalid structure', { queuePath });
      return { items: [] };
    }
    writeQueueTrace(projectPath, 'INFO', 'readQueue: SUCCESS', { itemCount: parsed.items.length });
    debugLog('DEBUG', '[hook-queue] readQueue: parsed successfully', {
      itemCount: parsed.items.length,
    });
    return parsed as QueueFile;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    writeQueueTrace(projectPath, 'ERROR', 'readQueue: JSON parse FAILED', { error: errorMsg });
    debugLog('ERROR', '[hook-queue] readQueue: JSON parse failed', {
      queuePath,
      error: errorMsg,
    });
    return { items: [] };
  }
}

/**
 * Write queue file (atomic write to prevent partial reads)
 *
 * Uses write-to-temp + rename pattern to ensure readers always see
 * complete file content, even on Windows where file locking is different.
 *
 * @param projectPath - Project root path
 * @param queue - Queue data to write
 * @param caller - Name of the calling function (for debug snapshots)
 */
export function writeQueue(projectPath: string, queue: QueueFile, caller: string = 'unknown'): void {
  ensureQueueDir(projectPath);
  const queuePath = getQueuePath(projectPath);
  const tempPath = queuePath + '.tmp';

  // Write to temp file first
  const content = JSON.stringify(queue, null, 2);
  writeFileSync(tempPath, content, 'utf-8');

  // Atomic rename (Windows: uses MoveFileEx internally)
  try {
    renameSync(tempPath, queuePath);
  } catch (error) {
    // Fallback: If rename fails (e.g., cross-device), write directly
    debugLog('WARN', '[hook-queue] writeQueue: rename failed, using direct write', {
      error: error instanceof Error ? error.message : String(error),
    });
    writeFileSync(queuePath, content, 'utf-8');
    try { unlinkSync(tempPath); } catch { /* ignore */ }
  }

  // DEBUG: Snapshot after each write with caller name + epoch time
  // Controlled by QUEUE_TRACE_ENABLED flag
  if (QUEUE_TRACE_ENABLED) {
    const epoch = Date.now();
    const snapshotPath = queuePath.replace('pending.json', `snapshot_${caller}_${epoch}.json`);
    try {
      const snapshotData = {
        caller,
        timestamp: new Date().toISOString(),
        epoch,
        pid: process.pid,
        itemCount: queue.items.length,
        items: queue.items,
      };
      writeFileSync(snapshotPath, JSON.stringify(snapshotData, null, 2), 'utf-8');
    } catch { /* ignore snapshot errors */ }

    // DEBUG: Also write to pending-debug.json with timestamp for tracing
    const debugPath = queuePath.replace('pending.json', 'pending-debug.json');
    const debugData = {
      timestamp: new Date().toISOString(),
      pid: process.pid,
      itemCount: queue.items.length,
      items: queue.items,
    };
    try {
      // Append to debug file (read existing + append)
      let existing: unknown[] = [];
      if (existsSync(debugPath)) {
        try {
          existing = JSON.parse(readFileSync(debugPath, 'utf-8'));
        } catch { existing = []; }
      }
      existing.push(debugData);
      // Keep last 50 entries
      if (existing.length > 50) existing = existing.slice(-50);
      writeFileSync(debugPath, JSON.stringify(existing, null, 2), 'utf-8');
    } catch { /* ignore debug file errors */ }
  }
}

// ============================================================================
// Enqueue Operations (Used by Hooks - Fast, No DB)
// ============================================================================

/**
 * Enqueue a decision creation
 *
 * @param projectPath - Project root path
 * @param data - Decision data
 */
export function enqueueDecisionCreate(
  projectPath: string,
  data: {
    key: string;
    value: string;
    status: string;
    layer: string;
    tags: string[];
  }
): void {
  writeQueueTrace(projectPath, 'INFO', 'enqueueDecisionCreate: START', { key: data.key });
  const queue = readQueue(projectPath);
  writeQueueTrace(projectPath, 'INFO', 'enqueueDecisionCreate: after readQueue', { existingItems: queue.items.length });

  // Duplicate check: skip if same key already in queue
  const existingDecision = queue.items.find(
    i => i.type === 'decision' && (i as DecisionQueueItem).data.key === data.key
  );
  if (existingDecision) {
    writeQueueTrace(projectPath, 'WARN', 'enqueueDecisionCreate: SKIP duplicate', { key: data.key });
    debugLog('INFO', '[hook-queue] Skipping duplicate decision in queue', { key: data.key });
    return;
  }

  const item: DecisionQueueItem = {
    type: 'decision',
    action: 'create',
    timestamp: new Date().toISOString(),
    data,
  };
  queue.items.push(item);
  writeQueueTrace(projectPath, 'INFO', 'enqueueDecisionCreate: before writeQueue', { totalItems: queue.items.length });
  writeQueue(projectPath, queue, 'enqueueDecisionCreate');
  writeQueueTrace(projectPath, 'INFO', 'enqueueDecisionCreate: DONE');
}

/**
 * Enqueue a decision status update
 *
 * @param projectPath - Project root path
 * @param data - Update data (key + new status)
 */
export function enqueueDecisionUpdate(
  projectPath: string,
  data: {
    key: string;
    value?: string;
    status: string;
    layer?: string;
    tags?: string[];
  }
): void {
  const queue = readQueue(projectPath);
  const item: DecisionQueueItem = {
    type: 'decision',
    action: 'update',
    timestamp: new Date().toISOString(),
    data,
  };
  queue.items.push(item);
  writeQueue(projectPath, queue, 'enqueueDecisionUpdate');
}

// ============================================================================
// Process Queue (Used by MCP Server on Startup)
// ============================================================================

/**
 * Process all pending queue items
 *
 * Called by MCP server after DB initialization.
 * Processes items in order, then clears the queue.
 *
 * @param projectPath - Project root path
 * @param processor - Function to process each item
 * @param callId - Optional call ID for tracing
 * @returns Number of items processed
 */
export async function processQueue(
  projectPath: string,
  processor: (item: QueueItem) => Promise<void>,
  callId?: string
): Promise<number> {
  // Try to acquire file lock for exclusive processing
  if (!tryAcquireLock(projectPath)) {
    debugLog('INFO', '[hook-queue] Skipping processQueue - another process holds the lock', { callId });
    return 0;
  }

  try {
    const queue = readQueue(projectPath);
    debugLog('INFO', '[hook-queue] processQueue called', {
      callId,
      pid: process.pid,
      itemCount: queue.items.length,
      items: queue.items.map(i => ({
        type: i.type,
        action: i.action,
        key: i.type === 'decision' ? (i as DecisionQueueItem).data.key : undefined,
        text: i.type === 'constraint' ? (i as ConstraintQueueItem).data.text?.slice(0, 30) : undefined,
      })),
    });

    if (queue.items.length === 0) {
      return 0;
    }

    // CRITICAL: Clear queue IMMEDIATELY after reading to prevent duplicate processing
    // If another call comes in while we're processing, it will see an empty queue
    debugLog('INFO', '[hook-queue] Clearing queue before processing (race condition prevention)', { callId });
    clearQueue(projectPath);

    let processed = 0;
    const errors: Array<{ item: QueueItem; error: string }> = [];

    for (let i = 0; i < queue.items.length; i++) {
      const item = queue.items[i];
      debugLog('INFO', `[hook-queue] Processing item ${i + 1}/${queue.items.length}`, {
        callId,
        type: item.type,
        action: item.action,
      });

      try {
        await processor(item);
        processed++;
        debugLog('INFO', `[hook-queue] Item ${i + 1} processed successfully`, { callId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ item, error: message });
        debugLog('ERROR', `[hook-queue] Item ${i + 1} failed`, { callId, error: message });
      }
    }

    debugLog('INFO', '[hook-queue] Processing complete', {
      callId,
      processed,
      errors: errors.length,
      errorDetails: errors.map(e => e.error),
    });

    // Move failed items to failed queue (no retry - errors like HighSimilarity are permanent)
    if (errors.length > 0) {
      debugLog('WARN', '[hook-queue] Moving failed items to failed queue', {
        callId,
        failedCount: errors.length,
      });
      appendToFailedQueue(projectPath, errors);
    }

    return processed;
  } finally {
    releaseLock(projectPath);
  }
}

/**
 * Clear the queue file
 */
export function clearQueue(projectPath: string): void {
  const queuePath = getQueuePath(projectPath);
  if (existsSync(queuePath)) {
    writeQueue(projectPath, { items: [] }, 'clearQueue');
  }
}

/**
 * Check if queue has pending items
 */
export function hasQueueItems(projectPath: string): boolean {
  const queue = readQueue(projectPath);
  return queue.items.length > 0;
}

// ============================================================================
// Decision Context Queue Operations (v5.0.4+)
// ============================================================================

/**
 * Enqueue a decision context creation
 *
 * Must be enqueued AFTER the corresponding DecisionCreate item
 * to ensure the decision exists when context is processed.
 *
 * @param projectPath - Project root path
 * @param data - Decision context data
 */
export function enqueueDecisionContextCreate(
  projectPath: string,
  data: {
    key: string;
    rationale: string;
    alternatives?: string;
    tradeoffs?: string;
  }
): void {
  writeQueueTrace(projectPath, 'INFO', 'enqueueDecisionContextCreate: START', { key: data.key });
  const queue = readQueue(projectPath);
  writeQueueTrace(projectPath, 'INFO', 'enqueueDecisionContextCreate: after readQueue', { existingItems: queue.items.length });

  // Duplicate check: skip if same key + rationale prefix already in queue
  const rationalePrefix = data.rationale.slice(0, 30);
  const existingContext = queue.items.find(
    i => i.type === 'decision_context'
      && (i as DecisionContextQueueItem).data.key === data.key
      && (i as DecisionContextQueueItem).data.rationale.slice(0, 30) === rationalePrefix
  );
  if (existingContext) {
    writeQueueTrace(projectPath, 'WARN', 'enqueueDecisionContextCreate: SKIP duplicate', { key: data.key });
    debugLog('INFO', '[hook-queue] Skipping duplicate decision context in queue', { key: data.key });
    return;
  }

  const item: DecisionContextQueueItem = {
    type: 'decision_context',
    action: 'create',
    timestamp: new Date().toISOString(),
    data,
  };
  queue.items.push(item);
  writeQueueTrace(projectPath, 'INFO', 'enqueueDecisionContextCreate: before writeQueue', { totalItems: queue.items.length });
  debugLog('INFO', '[hook-queue] enqueueDecisionContextCreate', {
    projectPath,
    key: data.key,
    rationalePreview: data.rationale?.slice(0, 30),
    queueSizeAfter: queue.items.length,
  });
  writeQueue(projectPath, queue, 'enqueueDecisionContextCreate');
  writeQueueTrace(projectPath, 'INFO', 'enqueueDecisionContextCreate: DONE');
}

// ============================================================================
// Constraint Queue Operations (v4.2.1+)
// ============================================================================

/**
 * Enqueue a constraint creation
 *
 * @param projectPath - Project root path
 * @param data - Constraint data
 */
export function enqueueConstraintCreate(
  projectPath: string,
  data: {
    text: string;
    category?: string;
    priority?: string;
    layer?: string;
    tags?: string[];
    active?: boolean;
    plan_id?: string;
  }
): void {
  writeQueueTrace(projectPath, 'INFO', 'enqueueConstraintCreate: START', { text: data.text?.slice(0, 30) });
  const queue = readQueue(projectPath);
  writeQueueTrace(projectPath, 'INFO', 'enqueueConstraintCreate: after readQueue', { existingItems: queue.items.length });

  // Duplicate check: skip if same text already in queue
  const existingConstraint = queue.items.find(
    i => i.type === 'constraint' && (i as ConstraintQueueItem).data.text === data.text
  );
  if (existingConstraint) {
    writeQueueTrace(projectPath, 'WARN', 'enqueueConstraintCreate: SKIP duplicate', { text: data.text?.slice(0, 30) });
    debugLog('INFO', '[hook-queue] Skipping duplicate constraint in queue', { text: data.text?.slice(0, 30) });
    return;
  }

  const item: ConstraintQueueItem = {
    type: 'constraint',
    action: 'create',
    timestamp: new Date().toISOString(),
    data,
  };
  queue.items.push(item);
  writeQueueTrace(projectPath, 'INFO', 'enqueueConstraintCreate: before writeQueue', { totalItems: queue.items.length });
  debugLog('INFO', '[hook-queue] enqueueConstraintCreate', {
    projectPath,
    text: data.text?.slice(0, 30),
    category: data.category,
    queueSizeAfter: queue.items.length,
  });
  writeQueue(projectPath, queue, 'enqueueConstraintCreate');
  writeQueueTrace(projectPath, 'INFO', 'enqueueConstraintCreate: DONE');
}

/**
 * Enqueue constraint activation (set active=1)
 *
 * @param projectPath - Project root path
 * @param planId - Plan ID to match constraints
 */
export function enqueueConstraintActivate(
  projectPath: string,
  planId: string
): void {
  const queue = readQueue(projectPath);
  const item: ConstraintQueueItem = {
    type: 'constraint',
    action: 'activate',
    timestamp: new Date().toISOString(),
    data: {
      text: '', // Not used for activate action
      plan_id: planId,
      active: true,
    },
  };
  queue.items.push(item);
  writeQueue(projectPath, queue, 'enqueueConstraintActivate');
}
