/**
 * MCP Server - Initialization and Setup
 * Handles database initialization, config loading, and file watcher setup
 *
 * Config Priority (v4.1.0+):
 * 1. Main repo config (worktree parent .sqlew/config.toml)
 * 2. Local config (.sqlew/config.toml)
 * 3. Global config (~/.config/sqlew/config.toml)
 * 4. Default behavior
 *
 * Note: .sqlew/ directory is NOT created if config specifies MySQL/PostgreSQL
 */

import { existsSync } from 'fs';
import { resolve, isAbsolute } from 'path';
import { DatabaseAdapter, initializeDatabase, getAdapter } from '../database.js';
import { DEFAULT_DB_PATH } from '../constants.js';
import { loadConfigFile, DEFAULT_CONFIG_PATH } from '../config/loader.js';
import type { SqlewConfig } from '../config/types.js';
import { ensureProjectConfig } from '../config/writer.js';
import { ProjectContext } from '../utils/project-context.js';
import { detectVCS, GitAdapter } from '../utils/vcs-adapter.js';
import { startQueueWatcher } from '../watcher/queue-watcher.js';
import { initDebugLogger, debugLog } from '../utils/debug-logger.js';
import { ensureSqlewDirectory } from '../config/example-generator.js';
import { determineProjectRoot } from '../utils/project-root.js';
import { ParsedArgs } from './arg-parser.js';
import { initializeSqlewRules } from '../init-rules.js';
import { loadGlobalConfig } from '../config/global-config.js';
import { initializeBackend, isCloudMode, getBackend } from '../backend/backend-factory.js';

/**
 * Extract project name from a path, skipping hidden directories.
 *
 * This handles cases where --db-path points to ~/.sqlew/sqlew.db
 * and we want to use the parent directory name (e.g., 'kitayama')
 * instead of '.sqlew'.
 *
 * @param projectPath - Absolute path to extract project name from
 * @returns Project name (non-hidden directory name)
 */
function extractProjectNameFromPath(projectPath: string): string {
  // Split by forward slash (paths are normalized to forward slashes)
  const dirSegments = projectPath.split('/').filter(s => s.length > 0);

  // Find the first non-hidden directory name from the end
  // Skip directories starting with '.' (e.g., .sqlew, .git)
  for (let i = dirSegments.length - 1; i >= 0; i--) {
    const segment = dirSegments[i];
    if (segment && !segment.startsWith('.')) {
      return segment;
    }
  }

  // Fallback to 'default' if all segments are hidden
  return 'default';
}

/**
 * Config source type for priority tracking
 */
type ConfigSource = 'worktree-parent' | 'local' | 'global' | 'default';

/**
 * Result of config loading with priority
 */
interface ConfigLoadResult {
  config: SqlewConfig;
  effectiveRoot: string;
  source: ConfigSource;
}

/**
 * Load config with priority order (v4.1.0+):
 * 1. Main repo config (worktree parent)
 * 2. Local config (.sqlew/config.toml)
 * 3. Global config (~/.config/sqlew/config.toml)
 * 4. Default behavior
 *
 * @param currentDir - Current working directory
 * @param parsedArgs - Parsed CLI arguments
 * @returns Config, effective root, and source
 */
async function loadConfigWithPriority(
  currentDir: string,
  parsedArgs: ParsedArgs
): Promise<ConfigLoadResult> {
  const localConfigPath = resolve(currentDir, DEFAULT_CONFIG_PATH);

  // Priority 1: Check if in worktree and main repo has config
  const gitAdapter = new GitAdapter(currentDir);
  const isWorktree = await gitAdapter.isWorktree();

  if (isWorktree) {
    const mainRepoRoot = await gitAdapter.getMainRepositoryRoot();
    if (mainRepoRoot) {
      const mainConfigPath = resolve(mainRepoRoot, DEFAULT_CONFIG_PATH);
      if (existsSync(mainConfigPath)) {
        // Use main repo config
        const config = loadConfigFile(mainRepoRoot, parsedArgs.configPath);
        return {
          config,
          effectiveRoot: mainRepoRoot,
          source: 'worktree-parent',
        };
      }
    }
  }

  // Priority 2: Local config
  if (existsSync(localConfigPath)) {
    const config = loadConfigFile(currentDir, parsedArgs.configPath);
    return {
      config,
      effectiveRoot: currentDir,
      source: 'local',
    };
  }

  // Priority 3: Global config
  const globalConfig = loadGlobalConfig();
  // Check if global config has meaningful database settings
  if (globalConfig.database?.type || globalConfig.database?.path) {
    // Merge global config with defaults
    const { DEFAULT_CONFIG } = await import('../config/types.js');

    // Build merged config - use type assertion for compatibility
    const mergedDatabase = {
      ...DEFAULT_CONFIG.database,
      ...globalConfig.database,
    } as SqlewConfig['database'];

    const config: SqlewConfig = {
      ...DEFAULT_CONFIG,
      database: mergedDatabase,
      autodelete: { ...DEFAULT_CONFIG.autodelete, ...globalConfig.autodelete },
      tasks: { ...DEFAULT_CONFIG.tasks, ...globalConfig.tasks },
      debug: { ...DEFAULT_CONFIG.debug, ...globalConfig.debug },
      agents: { ...DEFAULT_CONFIG.agents, ...globalConfig.agents },
      commands: { ...DEFAULT_CONFIG.commands, ...globalConfig.commands },
    };
    return {
      config,
      effectiveRoot: currentDir,
      source: 'global',
    };
  }

  // Priority 4: Default behavior
  const config = loadConfigFile(currentDir, parsedArgs.configPath);
  return {
    config,
    effectiveRoot: currentDir,
    source: 'default',
  };
}

export interface SetupResult {
  db: DatabaseAdapter;
  fileConfig: SqlewConfig;
  projectRoot: string;
  projectContext: ProjectContext;
  detectionSource: 'cli' | 'config' | 'git' | 'metadata' | 'directory';
}

/**
 * Initialize server: database, config, project context, file watcher
 * Returns initialized components for server startup
 */
export async function initializeServer(parsedArgs: ParsedArgs): Promise<SetupResult> {
  // 0. Determine current working directory
  const currentDir = determineProjectRoot({
    cliDbPath: parsedArgs.dbPath,
    cliConfigPath: parsedArgs.configPath,
  });

  // 1. Load config with priority order (v4.1.0+):
  //    Main repo (worktree parent) > Local > Global > Default
  const { config: fileConfig, effectiveRoot: finalProjectRoot, source: configSource } =
    await loadConfigWithPriority(currentDir, parsedArgs);

  // 2. Only create .sqlew/ if:
  //    - Using SQLite (not MySQL/PostgreSQL/Cloud)
  //    - Config source is local or default (not worktree parent or global)
  const isExternalDB = fileConfig.database?.type === 'mysql' || fileConfig.database?.type === 'postgres';
  const isCloud = isCloudMode(fileConfig);
  const shouldCreateLocalDir = !isExternalDB && !isCloud && (configSource === 'local' || configSource === 'default');

  if (shouldCreateLocalDir) {
    ensureSqlewDirectory(finalProjectRoot);
  }

  // Determine final database path
  // Priority: CLI --db-path > config file database.path > default
  // IMPORTANT: When using worktree-parent config, resolve relative paths from effectiveRoot (main repo)
  let dbPath = parsedArgs.dbPath || fileConfig.database?.path;
  if (dbPath && !isAbsolute(dbPath)) {
    // Relative path - resolve from effectiveRoot for worktree-parent/global, or currentDir for local/default
    if (configSource === 'worktree-parent' || configSource === 'global') {
      dbPath = resolve(finalProjectRoot, dbPath);
    }
  }

  // 3. Initialize debug logger (file-based logging, after config loaded)
  // Priority: CLI arg > environment variable > config file
  // IMPORTANT: When using worktree-parent config, resolve relative paths from effectiveRoot (main repo)
  let debugLogPath = parsedArgs.debugLogPath || process.env.SQLEW_DEBUG || fileConfig.debug?.log_path;
  if (debugLogPath && !isAbsolute(debugLogPath)) {
    if (configSource === 'worktree-parent' || configSource === 'global') {
      debugLogPath = resolve(finalProjectRoot, debugLogPath);
    }
  }
  const debugLogLevel = fileConfig.debug?.log_level || 'info';
  initDebugLogger(debugLogPath, debugLogLevel);

  debugLog('INFO', 'Config loaded with priority', {
    currentDir,
    finalProjectRoot,
    configSource,
    isExternalDB,
    shouldCreateLocalDir,
  });
  debugLog('INFO', 'Database path determined', { dbPath });

  // 4. Initialize database and backend (SILENT - no stderr writes yet)
  let db: DatabaseAdapter;
  const isExplicitRDBMS = fileConfig.database?.type === 'mysql'
                       || fileConfig.database?.type === 'postgres';

  // Cloud mode: Initialize SaaS backend only (help/example/use_case use TOML files, no DB needed)
  if (isCloud) {
    await initializeBackend(fileConfig, finalProjectRoot);
    debugLog('INFO', 'Backend initialized', { type: 'cloud' });

    // Create dummy adapter for compatibility (not actually used in cloud mode)
    // help/example/use_case tools read from TOML files via help-loader.ts
    db = null as unknown as DatabaseAdapter;
  } else if (isExplicitRDBMS) {
    // User explicitly configured MySQL/PostgreSQL
    // Note: Config uses 'postgres' but initializeDatabase expects 'postgresql'
    const dbType = fileConfig.database!.type === 'postgres' ? 'postgresql' : fileConfig.database!.type;
    const dbHost = fileConfig.database!.connection?.host || 'localhost';
    const dbName = fileConfig.database!.connection?.database || 'sqlew';
    const config = {
      databaseType: dbType as 'mysql' | 'postgresql',
      connection: {
        ...fileConfig.database!.connection,
        user: fileConfig.database!.auth?.user,
        password: fileConfig.database!.auth?.password,
      },
    };

    try {
      db = await initializeDatabase(config);

      // Test connection immediately - fail fast if connection is bad
      await db.getKnex().raw('SELECT 1');
      await initializeBackend(fileConfig, finalProjectRoot);
      debugLog('INFO', 'Backend initialized', { type: dbType, host: dbHost, database: dbName });
    } catch (error: any) {
      // Connection failed - EXIT WITHOUT SQLITE FALLBACK
      const errorMsg = `❌ Failed to connect to ${config.databaseType}: ${error.message}`;
      debugLog('ERROR', errorMsg, { error, stack: error.stack });
      console.error(errorMsg);
      console.error('Please check your .sqlew/config.toml database configuration and try again.');
      console.error('Connection details: host=' + config.connection.host + ', database=' + config.connection.database);
      throw new Error(`Database connection failed: ${error.message}`);
    }
  } else {
    // SQLite (default or explicit) - always resolve DB path from project root
    // This ensures migrations run on the correct database (not the package's DB)
    const resolvedDbPath = dbPath || resolve(finalProjectRoot, DEFAULT_DB_PATH);
    const config = { connection: { filename: resolvedDbPath } };
    db = await initializeDatabase(config);
    await initializeBackend(fileConfig, finalProjectRoot);
    debugLog('INFO', 'Backend initialized', { type: 'sqlite', path: resolvedDbPath });
  }

  // 5-7. ProjectContext initialization
  // Cloud mode skips DB-dependent operations (uses config.toml values directly)
  let projectName = extractProjectNameFromPath(finalProjectRoot);
  let detectionSource: 'cli' | 'config' | 'git' | 'metadata' | 'directory' = 'directory';

  if (isCloud) {
    // Cloud mode: Use config.toml values directly (no local DB)
    projectName = fileConfig.project?.name || extractProjectNameFromPath(finalProjectRoot);
    detectionSource = fileConfig.project?.name ? 'config' : 'directory';
    debugLog('INFO', 'Cloud mode: Using config.toml values', { projectName });
  }

  // Initialize ProjectContext
  const projectContext = ProjectContext.getInstance();

  if (isCloud) {
    // Cloud mode: Already have projectName/detectionSource from config.toml
    // Use initWithoutDb (no local DB access)
    projectContext.initWithoutDb(projectName, detectionSource, {
      projectRootPath: finalProjectRoot,
    });

    debugLog('INFO', 'ProjectContext initialized (cloud mode)', {
      projectId: projectContext.getProjectId(),
      projectName: projectContext.getProjectName(),
    });
  } else {
    // Local/RDBMS mode: Detect project name with priority order
    const knex = getAdapter().getKnex();

    // Priority order: CLI --project-name > config.toml > git remote > directory name
    if (parsedArgs.projectName) {
      projectName = parsedArgs.projectName;
      detectionSource = 'cli';
      debugLog('INFO', 'Project name from CLI argument', { projectName });
    } else if (fileConfig.project?.name) {
      projectName = fileConfig.project.name;
      detectionSource = 'config';
      debugLog('INFO', 'Project name from config.toml', { projectName });
    } else {
      // Detect from VCS or directory
      const vcsAdapter = await detectVCS(finalProjectRoot);

      if (vcsAdapter) {
        const detectedName = await vcsAdapter.extractProjectName();
        if (detectedName) {
          projectName = detectedName;
          detectionSource = 'git';
          debugLog('INFO', 'Project name detected from VCS', { projectName, vcs: vcsAdapter.getVCSType() });
        } else {
          projectName = extractProjectNameFromPath(finalProjectRoot);
          detectionSource = 'directory';
          debugLog('INFO', 'Project name from directory', { projectName });
        }
      } else {
        projectName = extractProjectNameFromPath(finalProjectRoot);
        detectionSource = 'directory';
        debugLog('INFO', 'Project name from directory (no VCS)', { projectName });
      }

      // Write to config.toml if not present AND not CLI override
      if (!parsedArgs.projectName) {
        const configWritten = ensureProjectConfig(finalProjectRoot, projectName, {
          configPath: parsedArgs.configPath,
        });

        if (configWritten) {
          debugLog('INFO', 'Project name written to config.toml', {
            projectName,
            detectionSource,
            configPath: parsedArgs.configPath || DEFAULT_CONFIG_PATH
          });
        }
      }
    }

    // Initialize with database
    await projectContext.ensureProject(knex, projectName, detectionSource, {
      projectRootPath: finalProjectRoot,
    });

    debugLog('INFO', 'ProjectContext initialized', {
      projectId: projectContext.getProjectId(),
      projectName: projectContext.getProjectName(),
    });
  }

  // Log successful initialization
  debugLog('INFO', 'MCP Shared Context Server initialized', {
    dbPath,
    projectId: projectContext.getProjectId(),
    projectName: projectContext.getProjectName(),
    debugLogLevel: debugLogLevel
  });

  // 8. Initialize sqlew rules (global rules + gitignore) - silent, non-blocking
  // IMPORTANT: Use currentDir (worktree) not finalProjectRoot (main repo)
  try {
    initializeSqlewRules(currentDir);
  } catch (error) {
    debugLog('WARN', 'Failed to initialize sqlew rules', { error });
    // Non-fatal - continue server startup
  }

  // 9. Start queue watcher for hook-to-DB processing
  // Watches .sqlew/queue/pending.json and processes queued decisions
  // Uses Backend abstraction to support both local DB and SaaS
  try {
    const backend = getBackend();
    await startQueueWatcher(currentDir, backend);
  } catch (error) {
    debugLog('WARN', 'Failed to start queue watcher', { error });
    // Non-fatal - hooks will still enqueue, processed on next startup
  }

  return {
    db,
    fileConfig,
    projectRoot: finalProjectRoot,
    projectContext,
    detectionSource,
  };
}
