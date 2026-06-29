/**
 * Project Scope Resolver
 *
 * Resolves a per-call project target (the reserved `_sqlew_project` tool
 * parameter, and the `project` tool's root/name/ref inputs) into concrete
 * project metadata backed by the m_projects table.
 *
 * This enables tool-call-level project targeting for desktop AI agents
 * (Claude Desktop, Hermes Desktop, ...) whose MCP server cwd does not identify
 * the active project. It generalizes the existing read-only `_reference_project`
 * precedent (name-only lookup in list/search_layer) to also accept an absolute
 * repo path and a stable ref, and to optionally create on write.
 *
 * Resolution order: ref > root > name.
 *
 * Backward compatibility: the m_projects schema is unchanged. Name remains the
 * unique key, so a name that already exists with a *different* root is treated
 * as a collision and rejected on writes (fail-closed) to avoid writing ADRs to
 * the wrong project.
 */

import * as path from 'path';
import { existsSync } from 'fs';
import type { Knex } from 'knex';
import { getAdapter } from '../database.js';
import { detectProjectName } from './project-detector.js';
import type { ProjectMetadata } from './project-context.js';

/** Reserved per-call project scope (the `_sqlew_project` tool parameter). */
export interface SqlewProjectInput {
  /** Absolute path to the project root (repo directory). */
  root?: string;
  /** Project name as registered in m_projects. */
  name?: string;
  /** Stable ref returned by the `project` tool (e.g. "sqlew_proj_3"). */
  ref?: string;
  /** Allow creating a new project when resolving by name (writes only). */
  allow_create?: boolean;
}

export interface ResolveOptions {
  /** Whether the calling action mutates data (create-on-missing, collision check). */
  forWrite: boolean;
}

const REF_PREFIX = 'sqlew_proj_';

/** Build the stable ref string for a project id. */
export function makeProjectRef(id: number): string {
  return `${REF_PREFIX}${id}`;
}

/** Parse a ref string back into a numeric id, or null if malformed. */
function parseRef(ref: string): number | null {
  if (!ref.startsWith(REF_PREFIX)) {
    return null;
  }
  const id = Number(ref.slice(REF_PREFIX.length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Throw a structured resolver error (JSON string, matching sqlew conventions). */
function fail(code: string, message: string): never {
  throw new Error(JSON.stringify({ error: code, message }));
}

interface ProjectRow {
  id: number;
  name: string;
  display_name: string | null;
  detection_source: string;
  project_root_path: string | null;
  metadata: string | null;
}

function rowToMetadata(row: ProjectRow): ProjectMetadata {
  return {
    id: row.id,
    name: row.name,
    display_name: row.display_name || undefined,
    detection_source: row.detection_source as ProjectMetadata['detection_source'],
    project_root_path: row.project_root_path || undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  };
}

/** Normalize a filesystem path for comparison (forward slashes, lowercase). */
function normalizePath(p: string): string {
  return path.resolve(p).replace(/\\/g, '/').toLowerCase();
}

/**
 * Project names share ProjectContext's validation rule (alphanumeric, hyphen,
 * underscore, <= 64 chars). Auto-deriving a name from a non-ASCII directory
 * would otherwise insert an unusable row; fail with a clear, actionable error
 * instead. (Slugification is intentionally out of scope for now.)
 */
function assertValidProjectName(name: string): void {
  if (name.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    fail(
      'SQLEW_PROJECT_NAME_INVALID',
      `Cannot derive a valid project name ("${name}"). Set [project].name in ` +
      `.sqlew/config.toml (alphanumeric, hyphen, underscore; max 64 chars) and retry.`
    );
  }
}

/**
 * Resolve a per-call project scope into concrete project metadata.
 *
 * @param input - The `_sqlew_project` value (root / name / ref)
 * @param opts - Whether the calling action is a write
 * @returns Resolved project metadata (find-or-create per the rules above)
 */
export async function resolveProjectScope(
  input: SqlewProjectInput,
  opts: ResolveOptions
): Promise<ProjectMetadata> {
  const knex = getAdapter().getKnex();

  // 1. ref: most specific, points at an exact m_projects row.
  if (input.ref) {
    const id = parseRef(input.ref);
    if (id === null) {
      fail('SQLEW_PROJECT_REF_INVALID', `Invalid _sqlew_project.ref: "${input.ref}".`);
    }
    const row = await knex('m_projects').where({ id }).first<ProjectRow>();
    if (!row) {
      fail('SQLEW_PROJECT_NOT_FOUND', `No project for ref "${input.ref}".`);
    }
    return rowToMetadata(row);
  }

  // 2. root: deterministic — derive name from config/git/dir, find-or-create.
  if (input.root) {
    const root = path.resolve(input.root).replace(/\\/g, '/');
    if (!existsSync(root)) {
      fail('SQLEW_PROJECT_ROOT_NOT_FOUND', `_sqlew_project.root does not exist: "${root}".`);
    }
    const detected = await detectProjectName(root);
    return findOrCreate(knex, detected.name, root, detected.source, opts);
  }

  // 3. name: look up existing; create only on write + allow_create.
  if (input.name) {
    return findOrCreate(knex, input.name, undefined, 'metadata', {
      forWrite: opts.forWrite && (input.allow_create ?? true),
    });
  }

  fail(
    'SQLEW_PROJECT_REQUIRED',
    '_sqlew_project must specify one of: root, name, or ref.'
  );
}

/**
 * Find an existing project by name, or create it when permitted.
 *
 * Collision rule: if the name exists with a different recorded root, reject on
 * write (avoid mis-targeting); allow on read (best-effort cross-project query).
 */
async function findOrCreate(
  knex: Knex,
  name: string,
  root: string | undefined,
  source: ProjectMetadata['detection_source'],
  opts: ResolveOptions
): Promise<ProjectMetadata> {
  const existing = await knex('m_projects').where({ name }).first<ProjectRow>();

  if (existing) {
    if (
      root &&
      existing.project_root_path &&
      normalizePath(existing.project_root_path) !== normalizePath(root)
    ) {
      if (opts.forWrite) {
        fail(
          'SQLEW_PROJECT_NAME_COLLISION',
          `Project "${name}" already exists with a different root ` +
          `("${existing.project_root_path}" vs "${root}"). Set a unique [project].name ` +
          `in .sqlew/config.toml for this repo to avoid mixing ADRs.`
        );
      }
      // read: fall through and use the existing row (best-effort)
    }
    return rowToMetadata(existing);
  }

  if (!opts.forWrite) {
    fail('SQLEW_PROJECT_NOT_FOUND', `Project "${name}" not found.`);
  }

  assertValidProjectName(name);

  const now = Math.floor(Date.now() / 1000);
  await knex('m_projects').insert({
    name,
    display_name: name,
    detection_source: source,
    project_root_path: root ?? null,
    created_ts: now,
    last_active_ts: now,
    metadata: null,
  });

  // Refetch by name (avoids cross-database .returning() inconsistencies).
  const created = await knex('m_projects').where({ name }).first<ProjectRow>();
  if (!created) {
    fail('SQLEW_PROJECT_CREATE_FAILED', `Failed to create project "${name}".`);
  }
  return rowToMetadata(created);
}
