/**
 * Base Watcher - Common file watching functionality
 *
 * Provides shared infrastructure for file watchers:
 * - chokidar v4 initialization
 * - WSL detection and handling
 * - Debounce management
 * - Start/stop lifecycle
 *
 * @since v4.1.0
 */

import chokidar, { FSWatcher } from 'chokidar';
import { detectEnvironment } from '../utils/environment-detector.js';
import { debugLog } from '../utils/debug-logger.js';

/**
 * Watcher configuration options
 */
export interface WatcherOptions {
  /** Paths to watch */
  paths: string | string[];
  /** Debounce time in milliseconds */
  debounceMs?: number;
  /** Whether to ignore initial scan */
  ignoreInitial?: boolean;
  /** Custom ignore function */
  ignored?: (path: string) => boolean;
  /** Use polling (for network filesystems) */
  usePolling?: boolean;
  /** Polling interval in milliseconds */
  pollInterval?: number;
}

/**
 * Abstract base class for file watchers
 */
export abstract class BaseWatcher {
  protected watcher: FSWatcher | null = null;
  protected isRunning: boolean = false;
  protected debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  protected readonly debounceMs: number;
  protected readonly watcherName: string;

  constructor(name: string, debounceMs: number = 2000) {
    this.watcherName = name;
    this.debounceMs = debounceMs;
  }

  /**
   * Initialize chokidar watcher with common options
   */
  protected initializeWatcher(options: WatcherOptions): FSWatcher {
    const env = detectEnvironment();
    const isWSL = env === 'wsl';
    if (isWSL) {
      debugLog('INFO', `${this.watcherName}: WSL detected`);
    }

    // WSL2 + Windows FS (/mnt/) requires polling because inotify doesn't work
    const paths = Array.isArray(options.paths) ? options.paths : [options.paths];
    const needsPolling = isWSL && paths.some(p => p.startsWith('/mnt/'));
    const usePolling = options.usePolling ?? needsPolling;

    if (needsPolling && options.usePolling === undefined) {
      debugLog('INFO', `${this.watcherName}: Auto-enabling polling for WSL2 Windows FS`);
    }

    const watcherConfig: Parameters<typeof chokidar.watch>[1] = {
      persistent: true,
      ignoreInitial: options.ignoreInitial ?? true,
      awaitWriteFinish: {
        // Wait longer for file writes to stabilize (especially for rapid sequential writes)
        stabilityThreshold: Math.max(options.debounceMs ?? this.debounceMs, 1000),
        pollInterval: 500,  // Reduced polling frequency to avoid duplicate events
      },
      usePolling,
      interval: options.pollInterval ?? 500,  // Match polling interval
    };

    if (options.ignored && watcherConfig) {
      watcherConfig.ignored = options.ignored;
    }

    return chokidar.watch(options.paths, watcherConfig);
  }

  /**
   * Debounced handler - calls handler after debounce period
   */
  protected debounce(key: string, handler: () => void | Promise<void>): void {
    // Clear existing timer for this key
    const existingTimer = this.debounceTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = setTimeout(async () => {
      this.debounceTimers.delete(key);
      try {
        await handler();
      } catch (error) {
        debugLog('ERROR', `${this.watcherName}: Error in debounced handler`, {
          error,
        });
      }
    }, this.debounceMs);

    this.debounceTimers.set(key, timer);
  }

  /**
   * Start the watcher - must be implemented by subclasses
   */
  public abstract start(): Promise<void>;

  /**
   * Stop the watcher
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      // Clear all debounce timers
      this.debounceTimers.forEach((timer) => clearTimeout(timer));
      this.debounceTimers.clear();

      // Close watcher
      if (this.watcher) {
        await this.watcher.close();
        this.watcher = null;
      }

      this.isRunning = false;
      debugLog('INFO', `${this.watcherName}: Stopped`);
    } catch (error) {
      debugLog('ERROR', `${this.watcherName}: Error stopping`, { error });
      throw error;
    }
  }

  /**
   * Check if watcher is running
   */
  public getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get watcher name for logging
   */
  public getName(): string {
    return this.watcherName;
  }
}
