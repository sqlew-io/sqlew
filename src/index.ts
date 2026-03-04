#!/usr/bin/env node
/**
 * MCP Shared Context Server - Entry Point
 * Provides context management tools via Model Context Protocol
 *
 * Unified entry point (v4.0.2+):
 * - No args or MCP args: Start MCP server
 * - CLI commands (db:export, db:import, db:dump, query): Delegate to CLI
 */

// ============================================================================
// CLI Command Detection (must be first, before any MCP imports)
// ============================================================================
const rawArgs = process.argv.slice(2);
const firstArg = rawArgs[0] || '';

// Check if this is a CLI command or flag
const cliCommands = [
  'db:dump', 'db:export', 'db:import', 'query',
  'suggest', 'track-plan', 'save', 'check-completion', 'mark-done', 'init',
  // Hook events (v4.2.0+, v5.0.0+)
  'on-subagent-stop', 'on-stop', 'on-enter-plan', 'on-exit-plan', 'on-session-start', 'on-prompt', 'pr-adr',
];
// CLI flags that should route to CLI (not MCP server)
const cliFlags = ['--init', '--help', '--version'];
const isCliCommand = cliCommands.includes(firstArg) || cliFlags.includes(firstArg);

if (isCliCommand) {
  // Delegate to CLI module
  import('./cli.js').then(async (cli) => {
    await cli.runCli(rawArgs);
  }).catch((error) => {
    console.error('CLI Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
} else {
  // Start MCP Server
  startMcpServer();
}

// ============================================================================
// MCP Server
// ============================================================================
async function startMcpServer(): Promise<void> {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { parseArgs, validateArgs } = await import('./server/arg-parser.js');
  const { registerAllTools } = await import('./server/tool-registration.js');
  const { initializeServer } = await import('./server/setup.js');
  const { registerShutdownHandlers, performCleanup } = await import('./server/shutdown.js');
  const { handleInitializationError, safeConsoleError } = await import('./utils/error-handler.js');
  const { stopQueueWatcher } = await import('./watcher/queue-watcher.js');
  const { debugLog } = await import('./utils/debug-logger.js');

  // Parse command-line arguments
  const args = process.argv.slice(2);
  const parsedArgs = parseArgs(args);

  // Validate arguments (throws if invalid)
  try {
    validateArgs(parsedArgs);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // Create MCP server (McpServer wraps the low-level Server)
  const mcpServer = new McpServer(
    {
      name: 'sqlew',
      version: '5.0.8',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register all tools via McpServer.registerTool() API
  // Handles ListTools + CallTool automatically (no manual setRequestHandler needed)
  registerAllTools(mcpServer);

  // Setup centralized global error handlers
  registerShutdownHandlers();

  // Start server
  let debugLoggerInitialized = false;

  try {
    // Initialize server (database, config, project context)
    const setupResult = await initializeServer(parsedArgs);
    debugLoggerInitialized = true;

    // Connect MCP server transport FIRST (before any stderr writes)
    // This prevents EPIPE errors with clients expecting pure JSON-RPC protocol
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);

    // NOW safe to write diagnostic messages (using EPIPE-safe wrapper)
    safeConsoleError('✓ MCP Shared Context Server running on stdio');

    const dbPath = parsedArgs.dbPath || setupResult.fileConfig.database?.path;
    if (dbPath) {
      const source = parsedArgs.dbPath ? 'CLI' : 'config file';
      safeConsoleError(`  Database: ${dbPath} (from ${source})`);
    }

    safeConsoleError(`  Project: ${setupResult.projectContext.getProjectName()} (ID: ${setupResult.projectContext.getProjectId()}, source: ${setupResult.detectionSource})`);

    // Detect parent process exit (stdin pipe closed)
    // StdioServerTransport only listens for 'data'/'error', not 'end'
    // Without this, chokidar's persistent watcher keeps the process alive
    process.stdin.on('end', async () => {
      debugLog('INFO', 'Stdin closed - parent process exited, shutting down');
      try {
        await stopQueueWatcher();
      } catch {
        // Ignore - may not be initialized
      }
      performCleanup();
      process.exit(0);
    });
  } catch (error) {
    // If debug logger not initialized, write to stderr as fallback
    if (!debugLoggerInitialized) {
      console.error('\n❌ EARLY INITIALIZATION ERROR (before debug logger):', error);
      if (error instanceof Error && error.stack) {
        console.error('Stack:', error.stack);
      }
    }

    // Use centralized initialization error handler (writes to log file)
    handleInitializationError(error);

    performCleanup();
    process.exit(1);
  }
}
