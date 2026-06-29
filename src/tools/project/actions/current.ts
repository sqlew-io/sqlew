/**
 * project.current - Report the active project for this MCP session/call.
 *
 * Reflects the request-scoped project when invoked with _sqlew_project, the
 * startup-bound project otherwise, or an unbound status when the server was
 * launched from an ambiguous cwd (desktop AI agents).
 */

import { getProjectContext } from '../../../utils/project-context.js';
import { makeProjectRef } from '../../../utils/project-scope-resolver.js';
import type { ProjectSummary } from '../types.js';

export interface ProjectCurrentResponse {
  bound: boolean;
  project?: ProjectSummary;
  reason?: string;
  hint?: string;
}

export function projectCurrent(): ProjectCurrentResponse {
  const ctx = getProjectContext();

  if (ctx.isUnbound()) {
    return {
      bound: false,
      reason: ctx.getUnboundReason() || 'No project resolvable from the launch directory.',
      hint:
        'Pass _sqlew_project.root or .name on tool calls, or call project.resolve ' +
        'to register a project and reuse the returned ref.',
    };
  }

  if (!ctx.isInitialized()) {
    return { bound: false, reason: 'ProjectContext is not initialized.' };
  }

  const meta = ctx.getProjectMetadata();
  return {
    bound: true,
    project: {
      id: meta.id,
      name: meta.name,
      display_name: meta.display_name,
      root: meta.project_root_path,
      detection_source: meta.detection_source,
      ref: makeProjectRef(meta.id),
    },
  };
}
