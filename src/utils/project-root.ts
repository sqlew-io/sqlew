/**
 * Project Root Determination Utility
 *
 * Determines the project root directory with correct priority order:
 * 0. CLAUDE_PROJECT_DIR environment variable (Claude Code / Grok Build hooks)
 * 0b. GROK_WORKSPACE_ROOT environment variable (Grok Build hooks / MCP)
 * 0c. CODEX_CWD environment variable (Codex hooks / MCP)
 * 0d. TERMINAL_CWD environment variable (Hermes hooks)
 * 1. SQLEW_PROJECT_ROOT environment variable (MCP client can set this)
 * 2. CLI --db-path argument (absolute path) → use dirname
 * 3. CLI --config-path argument (absolute path) → use dirname
 * 4. Config file database.path (absolute path) → use dirname
 * 5. Fallback to process.cwd()
 *
 * This prevents issues on Windows when launched from system directories
 * like C:\Windows\System32 (e.g., by MCP hosts like Claude Desktop or Junie AI).
 *
 * Environment Variable Support:
 * - CLAUDE_PROJECT_DIR: Set automatically by Claude Code / Grok Build hooks (v4.1.0+)
 * - GROK_WORKSPACE_ROOT: Set automatically by Grok Build hooks (v5.2.0+)
 * - SQLEW_PROJECT_ROOT: MCP clients can set this (Serena-MCP pattern)
 * This allows project-relative database paths without absolute CLI arguments.
 */

import * as path from 'path';
import * as os from 'os';

export interface ProjectRootOptions {
  /**
   * CLI argument: --db-path
   * If absolute, its directory becomes the project root
   */
  cliDbPath?: string;

  /**
   * CLI argument: --config-path
   * If absolute, its directory becomes the project root
   */
  cliConfigPath?: string;

  /**
   * Config file setting: database.path
   * If absolute, its directory becomes the project root
   */
  configDbPath?: string;
}

/**
 * Determines the project root directory based on available path information.
 *
 * Priority order (highest to lowest):
 * 0. CLAUDE_PROJECT_DIR environment variable (Claude Code / Grok Build hooks)
 * 0b. GROK_WORKSPACE_ROOT environment variable (Grok Build)
 * 1. SQLEW_PROJECT_ROOT environment variable
 * 2. CLI --db-path (absolute)
 * 3. CLI --config-path (absolute)
 * 4. Config database.path (absolute)
 * 5. process.cwd() (fallback)
 *
 * @param options - Path options from CLI arguments and config file
 * @returns Absolute path to project root directory (forward slashes for cross-platform consistency)
 *
 * @example
 * ```typescript
 * // Claude Code Hooks set CLAUDE_PROJECT_DIR automatically
 * const root = determineProjectRoot({});
 * // Returns: value of CLAUDE_PROJECT_DIR (highest priority)
 *
 * // MCP client sets environment variable (Junie, Claude Desktop, etc.)
 * // In Junie config: { "env": { "SQLEW_PROJECT_ROOT": "/path/to/project" } }
 * const root = determineProjectRoot({});
 * // Returns: '/path/to/project' (from environment variable)
 *
 * // User specified: sqlew --db-path=/absolute/path/to/.sqlew/db.db
 * const root = determineProjectRoot({ cliDbPath: '/absolute/path/to/.sqlew/db.db' });
 * // Returns: '/absolute/path/to/.sqlew' (not System32!)
 *
 * // User specified: sqlew --config-path=C:\Project\.sqlew\config.toml (Windows)
 * const root = determineProjectRoot({ cliConfigPath: 'C:\\Project\\.sqlew\\config.toml' });
 * // Returns: 'C:/Project/.sqlew' (normalized to forward slashes)
 *
 * // No arguments, fallback to execution directory
 * const root = determineProjectRoot({});
 * // Returns: process.cwd() (whatever directory sqlew was launched from)
 * ```
 */
export function determineProjectRoot(options: ProjectRootOptions = {}): string {
  // Priority 0: CLAUDE_PROJECT_DIR environment variable (v4.1.0+)
  // Claude Code Hooks set this automatically when executing hook commands
  const claudeProjectDir = process.env.CLAUDE_PROJECT_DIR;
  if (claudeProjectDir && path.isAbsolute(claudeProjectDir)) {
    // Normalize to forward slashes for cross-platform consistency
    return claudeProjectDir.replace(/\\/g, '/');
  }

  // Priority 0b: GROK_WORKSPACE_ROOT (Grok Build hooks inject this on every hook process)
  const grokWorkspaceRoot = process.env.GROK_WORKSPACE_ROOT;
  if (grokWorkspaceRoot && path.isAbsolute(grokWorkspaceRoot)) {
    return grokWorkspaceRoot.replace(/\\/g, '/');
  }

  // Priority 0c: CODEX_CWD (Codex hooks inject workspace cwd)
  const codexCwd = process.env.CODEX_CWD;
  if (codexCwd && path.isAbsolute(codexCwd)) {
    return codexCwd.replace(/\\/g, '/');
  }

  // Priority 0d: TERMINAL_CWD (Hermes shell hooks inject workspace cwd)
  const terminalCwd = process.env.TERMINAL_CWD;
  if (terminalCwd && path.isAbsolute(terminalCwd)) {
    return terminalCwd.replace(/\\/g, '/');
  }

  // Priority 1: SQLEW_PROJECT_ROOT environment variable
  // MCP clients (Junie, Claude Desktop, etc.) can set this to specify project directory
  const envProjectRoot = process.env.SQLEW_PROJECT_ROOT;
  if (envProjectRoot && path.isAbsolute(envProjectRoot)) {
    // Normalize to forward slashes for cross-platform consistency
    return envProjectRoot.replace(/\\/g, '/');
  }

  // Priority 2: CLI --db-path argument (absolute path)
  if (options.cliDbPath && path.isAbsolute(options.cliDbPath)) {
    const projectRoot = path.dirname(options.cliDbPath);
    // Normalize to forward slashes for cross-platform consistency
    return projectRoot.replace(/\\/g, '/');
  }

  // Priority 3: CLI --config-path argument (absolute path)
  if (options.cliConfigPath && path.isAbsolute(options.cliConfigPath)) {
    const projectRoot = path.dirname(options.cliConfigPath);
    // Normalize to forward slashes for cross-platform consistency
    return projectRoot.replace(/\\/g, '/');
  }

  // Priority 4: Config file database.path (absolute path)
  if (options.configDbPath && path.isAbsolute(options.configDbPath)) {
    const projectRoot = path.dirname(options.configDbPath);
    // Normalize to forward slashes for cross-platform consistency
    return projectRoot.replace(/\\/g, '/');
  }

  // Priority 5: Fallback to process.cwd()
  // This is the current behavior, but now it's the LAST resort instead of the FIRST
  const cwd = process.cwd();
  // Normalize to forward slashes for cross-platform consistency
  return cwd.replace(/\\/g, '/');
}

/**
 * Helper function to check if a path looks like it's in a system directory
 * on Windows (e.g., C:\Windows\System32).
 *
 * Useful for warning users if sqlew is being launched from an unexpected location.
 *
 * @param dirPath - Directory path to check
 * @returns True if path appears to be a Windows system directory
 */
export function isSystemDirectory(dirPath: string): boolean {
  if (process.platform !== 'win32') {
    return false;
  }

  const normalizedPath = dirPath.toLowerCase().replace(/\\/g, '/');

  // Common Windows system directories
  const systemDirs = [
    '/windows/system32',
    '/windows/syswow64',
    '/windows',
    '/program files',
    '/program files (x86)',
  ];

  return systemDirs.some(sysDir => normalizedPath.includes(sysDir));
}

/**
 * Whether the project root was determined from an explicit signal rather than
 * the bare process.cwd() fallback.
 *
 * Mirrors the priority-0..4 checks in determineProjectRoot(): if any of the
 * recognized environment variables or CLI/config path arguments are present
 * (as absolute paths), the integrator clearly intended a specific project, so
 * the launch is trusted and never treated as ambiguous.
 *
 * @param options - Same options passed to determineProjectRoot()
 * @returns true if an explicit root signal was provided
 */
export function wasProjectRootExplicit(options: ProjectRootOptions = {}): boolean {
  const envSignals = [
    process.env.CLAUDE_PROJECT_DIR,
    process.env.GROK_WORKSPACE_ROOT,
    process.env.CODEX_CWD,
    process.env.TERMINAL_CWD,
    process.env.SQLEW_PROJECT_ROOT,
  ];
  if (envSignals.some(value => value && path.isAbsolute(value))) {
    return true;
  }
  if (options.cliDbPath && path.isAbsolute(options.cliDbPath)) return true;
  if (options.cliConfigPath && path.isAbsolute(options.cliConfigPath)) return true;
  if (options.configDbPath && path.isAbsolute(options.configDbPath)) return true;
  return false;
}

/**
 * Whether a directory is too ambiguous to safely auto-register as a project.
 *
 * Desktop AI agents (Claude Desktop, Hermes Desktop, etc.) often spawn the MCP
 * server with a fixed cwd such as the user home folder or a system directory.
 * Auto-deriving a project name from those locations pollutes the shared DB
 * (e.g. a "kitayama" project from C:\Users\kitayama). This guard is kept
 * intentionally conservative so legitimate first-run CLI usage from a plain
 * project folder is NOT affected:
 *
 * - Windows system directories (System32, Program Files, ...)
 * - The user home directory itself
 *
 * Workspace-container detection (~/Projects, ~/Documents, ...) is deliberately
 * left out for now to avoid false positives; it can be layered on later.
 *
 * @param root - Project root directory to evaluate
 * @returns true if the directory is an ambiguous launch location
 */
export function isAmbiguousProjectRoot(root: string): boolean {
  if (!root) {
    return true;
  }
  if (isSystemDirectory(root)) {
    return true;
  }

  const normalizedRoot = path.resolve(root).replace(/\\/g, '/').toLowerCase();
  const home = path.resolve(os.homedir()).replace(/\\/g, '/').toLowerCase();

  // The user home directory itself is ambiguous (the canonical desktop case).
  if (normalizedRoot === home) {
    return true;
  }

  return false;
}
