/**
 * project.validate - Check whether a root/name/ref resolves cleanly, WITHOUT
 * creating anything. Returns a structured ok/false result instead of throwing,
 * so an agent can probe before committing writes.
 */

import {
  resolveProjectScope,
  makeProjectRef,
} from '../../../utils/project-scope-resolver.js';
import type { ProjectSummary, ProjectToolParams } from '../types.js';

export interface ProjectValidateResponse {
  ok: boolean;
  project?: ProjectSummary;
  error?: string;
  message?: string;
}

export async function projectValidate(
  params: ProjectToolParams
): Promise<ProjectValidateResponse> {
  if (!params.root && !params.name && !params.ref) {
    return {
      ok: false,
      error: 'SQLEW_PROJECT_REQUIRED',
      message: 'project.validate requires one of: root, name, ref.',
    };
  }

  try {
    // Read-only: never create. A brand-new (unregistered) repo path therefore
    // reports ok:false with SQLEW_PROJECT_NOT_FOUND — use project.resolve to register.
    const meta = await resolveProjectScope(
      { root: params.root, name: params.name, ref: params.ref },
      { forWrite: false }
    );
    return {
      ok: true,
      project: {
        id: meta.id,
        name: meta.name,
        display_name: meta.display_name,
        root: meta.project_root_path,
        detection_source: meta.detection_source,
        ref: makeProjectRef(meta.id),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // resolver throws JSON-encoded { error, message }; surface it structurally.
    try {
      const parsed = JSON.parse(message);
      return { ok: false, error: parsed.error, message: parsed.message };
    } catch {
      return { ok: false, error: 'SQLEW_PROJECT_VALIDATE_FAILED', message };
    }
  }
}
