/**
 * Queue Watcher - Monitors hook queue file for changes
 *
 * Watches `.sqlew/queue/pending.json` and processes queued decisions
 * when hooks write to the queue file.
 *
 * Flow:
 * 1. Hook writes to queue file (fast, <100ms)
 * 2. QueueWatcher detects change
 * 3. processHookQueue() registers decisions in DB
 *
 * @since v4.1.0
 */

import { dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { BaseWatcher } from './base-watcher.js';
import { getQueuePath, hasQueueItems, processQueue } from '../utils/hook-queue.js';
import { processQueueItem } from '../utils/queue-processor.js';
import { debugLog } from '../utils/debug-logger.js';
import type { ToolBackend } from '../backend/types.js';

/**
 * QueueWatcher - Singleton for monitoring hook queue
 */
export class QueueWatcher extends BaseWatcher {
  private static instance: QueueWatcher | null = null;
  private projectRoot: string;
  private backend: ToolBackend;
  private processing: boolean = false;
  private currentCallId: string = '';

  private constructor(projectRoot: string, backend: ToolBackend) {
    super('QueueWatcher', 500); // 500ms debounce for queue changes
    this.projectRoot = projectRoot;
    this.backend = backend;
  }

  /**
   * Get singleton instance
   */
  public static getInstance(projectRoot?: string, backend?: ToolBackend): QueueWatcher {
    if (!QueueWatcher.instance) {
      if (!projectRoot || !backend) {
        throw new Error('QueueWatcher: projectRoot and backend required for first initialization');
      }
      QueueWatcher.instance = new QueueWatcher(projectRoot, backend);
    }
    return QueueWatcher.instance;
  }

  /**
   * Reset singleton (for testing)
   */
  public static reset(): void {
    if (QueueWatcher.instance) {
      QueueWatcher.instance.stop().catch(() => {});
    }
    QueueWatcher.instance = null;
  }

  /**
   * Start watching the queue file
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      debugLog('WARN', `${this.watcherName}: Already running`);
      return;
    }

    try {
      const queuePath = getQueuePath(this.projectRoot);
      const queueDir = dirname(queuePath);

      // Ensure queue directory exists
      if (!existsSync(queueDir)) {
        mkdirSync(queueDir, { recursive: true });
      }

      // Watch the queue directory (not just file, to catch file creation)
      this.watcher = this.initializeWatcher({
        paths: queueDir,
        debounceMs: this.debounceMs,
        ignoreInitial: false, // Process existing queue on startup
      });

      // Handle file changes
      this.watcher.on('add', (path: string) => this.handleQueueChange(path));
      this.watcher.on('change', (path: string) => this.handleQueueChange(path));

      this.watcher.on('error', (error: unknown) => {
        debugLog('ERROR', `${this.watcherName}: Watch error`, { error });
      });

      this.isRunning = true;
      debugLog('INFO', `${this.watcherName}: Started`, {
        projectRoot: this.projectRoot,
        queueDir,
      });

      // Process any existing queue items on startup
      await this.processQueueIfNeeded();
    } catch (error) {
      debugLog('ERROR', `${this.watcherName}: Failed to start`, { error });
      throw error;
    }
  }

  /**
   * Handle queue file change
   */
  private handleQueueChange(path: string): void {
    // Only process pending.json
    if (!path.endsWith('pending.json')) {
      return;
    }

    const eventId = Math.random().toString(36).slice(2, 6);
    debugLog('INFO', `${this.watcherName}: Queue file changed`, {
      eventId,
      path,
      hasDebounceTimer: this.debounceTimers.has('queue-process'),
    });

    // Debounce to avoid processing during rapid writes
    this.debounce('queue-process', async () => {
      debugLog('INFO', `${this.watcherName}: Debounce callback fired`, { eventId });
      await this.processQueueIfNeeded();
    });
  }

  /**
   * Process queue if items exist
   */
  private async processQueueIfNeeded(): Promise<void> {
    const callId = Math.random().toString(36).slice(2, 8);
    this.currentCallId = callId;  // Store for use in item processors

    // CRITICAL: Set processing flag IMMEDIATELY to prevent race conditions
    // Multiple calls can arrive before the first one finishes checking hasQueueItems
    if (this.processing) {
      debugLog('WARN', `${this.watcherName}: Skipping - already processing`, { callId });
      return;
    }
    this.processing = true;  // SET IMMEDIATELY after check!

    debugLog('INFO', `${this.watcherName}: processQueueIfNeeded called`, {
      callId,
      processing: true,
    });

    try {
      if (!hasQueueItems(this.projectRoot)) {
        debugLog('INFO', `${this.watcherName}: Queue is empty, nothing to process`, { callId });
        return;
      }

      debugLog('INFO', `${this.watcherName}: Starting queue processing`, { callId });
      const count = await processQueue(this.projectRoot, this.processItem.bind(this), callId);
      debugLog('INFO', `${this.watcherName}: Processed ${count} queue items`, { callId });
    } catch (error) {
      debugLog('ERROR', `${this.watcherName}: Error processing queue`, { callId, error });
    } finally {
      this.processing = false;
      debugLog('INFO', `${this.watcherName}: Processing flag reset`, { callId });
    }
  }

  /**
   * Process a single queue item via shared upsert-aware processor
   */
  private async processItem(item: Parameters<typeof processQueueItem>[1]): Promise<void> {
    await processQueueItem(this.backend, item, this.currentCallId);
  }

  /**
   * Get watcher status
   */
  public getStatus(): { running: boolean; projectRoot: string } {
    return {
      running: this.isRunning,
      projectRoot: this.projectRoot,
    };
  }
}

/**
 * Start the queue watcher
 * Called from MCP server setup after backend initialization
 *
 * @param projectRoot - Project root directory
 * @param backend - ToolBackend instance (local or SaaS)
 */
export async function startQueueWatcher(projectRoot: string, backend: ToolBackend): Promise<void> {
  const watcher = QueueWatcher.getInstance(projectRoot, backend);
  await watcher.start();
}

/**
 * Stop the queue watcher
 */
export async function stopQueueWatcher(): Promise<void> {
  try {
    const watcher = QueueWatcher.getInstance();
    await watcher.stop();
  } catch {
    // Instance not initialized, nothing to stop
  }
}
