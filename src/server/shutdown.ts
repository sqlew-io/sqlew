/**
 * MCP Server - Shutdown Handlers
 * Graceful cleanup of resources on process termination
 */

import { closeDatabase } from '../database.js';
import { closeDebugLogger, debugLog } from '../utils/debug-logger.js';
import { setupGlobalErrorHandlers } from '../utils/error-handler.js';
import { stopQueueWatcher } from '../watcher/queue-watcher.js';

/**
 * Register signal handlers for graceful shutdown
 * Ensures database is properly closed
 */
export function registerShutdownHandlers(): void {
  setupGlobalErrorHandlers(() => {
    debugLog('INFO', 'Shutting down gracefully');
    // Stop file watcher first (prevents new DB writes during cleanup)
    stopQueueWatcher().catch(() => {});
    closeDatabase();
    closeDebugLogger();
  });
}

/**
 * Perform cleanup on process exit
 * Should be called in catch blocks and fatal error handlers
 */
export function performCleanup(): void {
  stopQueueWatcher().catch(() => {});
  closeDatabase();
  closeDebugLogger();
}
