/**
 * project.resolve - Resolve (and optionally register) a project, returning a
 * stable ref for the agent to attach to subsequent decision/constraint calls
 * via _sqlew_project.ref.
 *
 * Typical desktop flow:
 *   1. project.resolve { root: "C:/.../mcp-sqlew" }  -> { project, usage }
 *   2. decision.set { ..., _sqlew_project: { ref } }
 */

import {
  resolveProjectScope,
  makeProjectRef,
} from '../../../utils/project-scope-resolver.js';
import type { ProjectSummary, ProjectToolParams } from '../types.js';

export interface ProjectResolveResponse {
  project: ProjectSummary;
  usage: { _sqlew_project: { ref: string } };
}

export async function projectResolve(
  params: ProjectToolParams
): Promise<ProjectResolveResponse> {
  if (!params.root && !params.name && !params.ref) {
    throw new Error(
      JSON.stringify({
        error: 'SQLEW_PROJECT_REQUIRED',
        message: 'project.resolve requires one of: root, name, ref.',
      })
    );
  }

  // root resolves deterministically and may register a new project; name-only
  // creation requires explicit allow_create to avoid accidental duplicates.
  const forWrite = params.allow_create ?? Boolean(params.root);

  const meta = await resolveProjectScope(
    {
      root: params.root,
      name: params.name,
      ref: params.ref,
      allow_create: params.allow_create,
    },
    { forWrite }
  );

  const ref = makeProjectRef(meta.id);
  return {
    project: {
      id: meta.id,
      name: meta.name,
      display_name: meta.display_name,
      root: meta.project_root_path,
      detection_source: meta.detection_source,
      ref,
    },
    usage: { _sqlew_project: { ref } },
  };
}
