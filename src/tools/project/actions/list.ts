/**
 * project.list - List all registered projects in m_projects.
 *
 * Helps a desktop agent discover known projects and their refs without prior
 * knowledge of the database contents.
 */

import { getAdapter } from '../../../database.js';
import { makeProjectRef } from '../../../utils/project-scope-resolver.js';
import type { ProjectSummary } from '../types.js';

export interface ProjectListResponse {
  count: number;
  projects: ProjectSummary[];
}

interface ProjectListRow {
  id: number;
  name: string;
  display_name: string | null;
  detection_source: string;
  project_root_path: string | null;
}

export async function projectList(): Promise<ProjectListResponse> {
  const knex = getAdapter().getKnex();
  const rows = await knex('m_projects')
    .select('id', 'name', 'display_name', 'detection_source', 'project_root_path')
    .orderBy('last_active_ts', 'desc') as ProjectListRow[];

  return {
    count: rows.length,
    projects: rows.map((r) => ({
      id: r.id,
      name: r.name,
      display_name: r.display_name || undefined,
      root: r.project_root_path || undefined,
      detection_source: r.detection_source,
      ref: makeProjectRef(r.id),
    })),
  };
}
