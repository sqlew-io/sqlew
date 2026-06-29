/**
 * ProjectContext Singleton - Manages current project identity for multi-project support
 *
 * Satisfies constraints:
 * - #41 (CRITICAL): Caches project_id after first detection, no repeated DB queries
 * - #44, #30 (HIGH): Provides getProjectId() and getProjectName() methods
 * - #47 (HIGH): Provides reset() for test isolation
 * - #23, #24 (CRITICAL): Config.toml as source of truth, auto-write on first run
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Knex } from 'knex';

export interface ProjectMetadata {
  id: number;
  name: string;
  display_name?: string;
  detection_source: 'cli' | 'config' | 'git' | 'metadata' | 'directory';
  project_root_path?: string;
  metadata?: Record<string, unknown>;
}

/**
 * ProjectContext singleton - manages current project identity
 *
 * Design:
 * - Single instance per MCP server session
 * - Lazy initialization on first access
 * - Caches project_id and project_name in memory
 * - Never queries database after initialization
 * - Reset capability for test isolation
 */
export class ProjectContext {
  private static instance: ProjectContext | null = null;
  private projectMetadata: ProjectMetadata | null = null;
  private initialized = false;

  /**
   * Unbound state (desktop AI agents launched from an ambiguous cwd).
   *
   * When the MCP server is started from an ambiguous location (user home,
   * system directory) without any explicit project signal, the server stays
   * up but refuses to auto-register a directory-name project. Project-scoped
   * write/read actions then fail-closed with SQLEW_PROJECT_REQUIRED unless the
   * caller passes a per-request scope (_sqlew_project). help/example/use_case
   * and the `project` tool remain usable so the agent can recover.
   */
  private unbound = false;
  private unboundReason: string | null = null;

  /**
   * Private constructor enforces singleton pattern
   */
  private constructor() {}

  /**
   * Create a request-scoped (non-singleton) ProjectContext.
   *
   * Used together with runWithProjectScope() to override the active project
   * for the duration of a single MCP tool call (per-call project targeting).
   * The returned instance is fully initialized and independent of the
   * singleton, so concurrent calls never cross-contaminate.
   *
   * @param metadata - Resolved project metadata to bind to this scope
   */
  public static createScoped(metadata: ProjectMetadata): ProjectContext {
    const ctx = new ProjectContext();
    ctx.projectMetadata = metadata;
    ctx.initialized = true;
    return ctx;
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): ProjectContext {
    if (!ProjectContext.instance) {
      ProjectContext.instance = new ProjectContext();
    }
    return ProjectContext.instance;
  }

  /**
   * Reset singleton state (for testing only)
   * Satisfies Constraint #47: Test isolation
   */
  public static reset(): void {
    if (ProjectContext.instance) {
      ProjectContext.instance.projectMetadata = null;
      ProjectContext.instance.initialized = false;
      ProjectContext.instance.unbound = false;
      ProjectContext.instance.unboundReason = null;
    }
    ProjectContext.instance = null;
  }

  /**
   * Ensure project is initialized and cached
   *
   * @param knex - Database connection
   * @param projectName - Project name from config or detection
   * @param detectionSource - How the project name was detected
   * @param options - Optional metadata
   * @returns Project metadata with cached ID
   *
   * Satisfies Constraints:
   * - #41: Query once per session, cache in memory
   * - #23: Register project in database if doesn't exist
   */
  public async ensureProject(
    knex: Knex,
    projectName: string,
    detectionSource: 'cli' | 'config' | 'git' | 'metadata' | 'directory',
    options?: {
      displayName?: string;
      projectRootPath?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<ProjectMetadata> {
    // Return cached metadata if already initialized
    if (this.initialized && this.projectMetadata) {
      return this.projectMetadata;
    }

    // Validate project name (Constraint #37)
    this.validateProjectName(projectName);

    // Query database for existing project or create new one
    // Uses Knex query builder (Constraint #49, #50)
    let project = await knex('m_projects')
      .where({ name: projectName })
      .first<{
        id: number;
        name: string;
        display_name: string | null;
        detection_source: string;
        project_root_path: string | null;
        metadata: string | null;
      }>();

    if (!project) {
      // Insert new project using Knex query builder (Constraint #49)
      // Set timestamps in application code for cross-DB compatibility
      const now = Math.floor(Date.now() / 1000);

      await knex('m_projects').insert({
        name: projectName,
        display_name: options?.displayName || projectName,
        detection_source: detectionSource,
        project_root_path: options?.projectRootPath || null,
        created_ts: now,
        last_active_ts: now,
        metadata: options?.metadata ? JSON.stringify(options.metadata) : null,
      });

      // Fetch the newly created project by name
      // (Avoids cross-database inconsistencies with .returning())
      project = await knex('m_projects')
        .where({ name: projectName })
        .first<{
          id: number;
          name: string;
          display_name: string | null;
          detection_source: string;
          project_root_path: string | null;
          metadata: string | null;
        }>();

      if (!project) {
        throw new Error(`Failed to create project: ${projectName}`);
      }
    }

    // Cache project metadata in memory (Constraint #41)
    this.projectMetadata = {
      id: project.id,
      name: project.name,
      display_name: project.display_name || undefined,
      detection_source: project.detection_source as ProjectMetadata['detection_source'],
      project_root_path: project.project_root_path || undefined,
      metadata: project.metadata ? JSON.parse(project.metadata) : undefined,
    };

    this.initialized = true;

    return this.projectMetadata;
  }

  /**
   * Initialize without database access (for cloud mode)
   *
   * Uses projectId=0 as placeholder. Call setProjectId() to override
   * with actual ID received from SaaS backend.
   *
   * @param projectName - Project name from config or detection
   * @param detectionSource - How the project name was detected
   * @param options - Optional metadata
   * @returns Project metadata with placeholder ID
   */
  public initWithoutDb(
    projectName: string,
    detectionSource: 'cli' | 'config' | 'git' | 'metadata' | 'directory',
    options?: { projectRootPath?: string }
  ): ProjectMetadata {
    // Return cached metadata if already initialized
    if (this.initialized && this.projectMetadata) {
      return this.projectMetadata;
    }

    // Validate project name
    this.validateProjectName(projectName);

    // Set metadata with placeholder ID (will be overridden by SaaS backend)
    this.projectMetadata = {
      id: 0,  // Placeholder - use setProjectId() to override
      name: projectName,
      detection_source: detectionSource,
      project_root_path: options?.projectRootPath,
    };

    this.initialized = true;

    return this.projectMetadata;
  }

  /**
   * Override project ID with value from SaaS backend
   *
   * Called after receiving project ID from SaaS API response.
   * Only works if already initialized (via initWithoutDb or ensureProject).
   *
   * @param projectId - Project ID from SaaS backend
   */
  public setProjectId(projectId: number): void {
    if (!this.initialized || !this.projectMetadata) {
      throw new Error(
        'ProjectContext not initialized. Call initWithoutDb() or ensureProject() first.'
      );
    }
    this.projectMetadata.id = projectId;
  }

  /**
   * Get cached project ID
   *
   * @throws Error if project not initialized
   * @returns Project ID
   *
   * Satisfies Constraint #44: Provide getProjectId() method
   */
  public getProjectId(): number {
    if (this.unbound) {
      throw new Error(this.unboundError());
    }
    if (!this.initialized || !this.projectMetadata) {
      throw new Error(
        'ProjectContext not initialized. Call ensureProject() first during server startup.'
      );
    }
    return this.projectMetadata.id;
  }

  /**
   * Get cached project name
   *
   * @throws Error if project not initialized
   * @returns Project name
   *
   * Satisfies Constraint #44: Provide getProjectName() method
   */
  public getProjectName(): string {
    if (this.unbound) {
      throw new Error(this.unboundError());
    }
    if (!this.initialized || !this.projectMetadata) {
      throw new Error(
        'ProjectContext not initialized. Call ensureProject() first during server startup.'
      );
    }
    return this.projectMetadata.name;
  }

  /**
   * Get all cached project metadata
   *
   * @throws Error if project not initialized
   * @returns Complete project metadata
   */
  public getProjectMetadata(): ProjectMetadata {
    if (!this.initialized || !this.projectMetadata) {
      throw new Error(
        'ProjectContext not initialized. Call ensureProject() first during server startup.'
      );
    }
    return { ...this.projectMetadata }; // Return copy to prevent mutations
  }

  /**
   * Check if project context is initialized
   *
   * @returns true if initialized, false otherwise
   */
  public isInitialized(): boolean {
    return this.initialized && this.projectMetadata !== null;
  }

  /**
   * Mark this context as unbound (ambiguous startup cwd, no explicit project).
   *
   * Clears any cached metadata. After this, getProjectId()/getProjectName()
   * throw a SQLEW_PROJECT_REQUIRED error until a request-scoped context is
   * supplied via runWithProjectScope().
   *
   * @param reason - Human-readable reason (e.g. the ambiguous cwd) for diagnostics
   */
  public markUnbound(reason: string): void {
    this.unbound = true;
    this.unboundReason = reason;
    this.initialized = false;
    this.projectMetadata = null;
  }

  /**
   * Whether this context is unbound (no project resolvable at startup).
   */
  public isUnbound(): boolean {
    return this.unbound;
  }

  /**
   * Diagnostic reason for the unbound state, if any.
   */
  public getUnboundReason(): string | null {
    return this.unboundReason;
  }

  /**
   * Build the structured SQLEW_PROJECT_REQUIRED error message.
   */
  private unboundError(): string {
    return JSON.stringify({
      error: 'SQLEW_PROJECT_REQUIRED',
      message:
        'sqlew could not determine a project from the MCP server launch directory' +
        (this.unboundReason ? ` (${this.unboundReason})` : '') +
        '. Pass _sqlew_project.root (absolute repo path) or _sqlew_project.name on this call, ' +
        'or call the "project" tool (action: resolve) first to obtain a ref. ' +
        'Alternatively set SQLEW_PROJECT_ROOT in the MCP server env.',
    });
  }

  /**
   * Validate project name according to security constraints
   *
   * @param projectName - Project name to validate
   * @throws Error if project name is invalid
   *
   * Satisfies Constraint #37: Alphanumeric + hyphens/underscores only, max 64 chars
   */
  private validateProjectName(projectName: string): void {
    // Max 64 characters
    if (projectName.length > 64) {
      throw new Error(
        `Project name exceeds maximum length of 64 characters: ${projectName.length}`
      );
    }

    // Alphanumeric + hyphens/underscores only
    const validPattern = /^[a-zA-Z0-9_-]+$/;
    if (!validPattern.test(projectName)) {
      throw new Error(
        `Invalid project name: ${projectName}. Only alphanumeric characters, hyphens, and underscores are allowed.`
      );
    }

    // Additional check: must not be empty
    if (projectName.trim().length === 0) {
      throw new Error('Project name cannot be empty');
    }
  }
}

/**
 * AsyncLocalStorage holding the request-scoped ProjectContext (if any).
 *
 * This is the mechanism that turns sqlew's process-level project detection
 * into per-call project targeting WITHOUT touching the ~25 call sites that
 * read getProjectContext().getProjectId(). The scope propagates across awaits,
 * so transaction callbacks and deep internal helpers all observe it.
 */
const projectScopeStorage = new AsyncLocalStorage<ProjectContext>();

/**
 * Run `fn` with a request-scoped ProjectContext active.
 *
 * Any getProjectContext() call inside `fn` (including across awaits) returns
 * `ctx` instead of the singleton. Concurrent calls each get their own scope,
 * so projects never cross-contaminate.
 *
 * @param ctx - The scoped ProjectContext (see ProjectContext.createScoped)
 * @param fn - The work to run within the scope
 */
export function runWithProjectScope<T>(
  ctx: ProjectContext,
  fn: () => Promise<T>
): Promise<T> {
  return projectScopeStorage.run(ctx, fn);
}

/**
 * Convenience function to get the active ProjectContext.
 *
 * Returns the request-scoped context when one is active (set via
 * runWithProjectScope), otherwise falls back to the process singleton.
 * Signature is unchanged so existing call sites need no modification.
 *
 * @returns The active ProjectContext (scoped or singleton)
 */
export function getProjectContext(): ProjectContext {
  return projectScopeStorage.getStore() ?? ProjectContext.getInstance();
}
