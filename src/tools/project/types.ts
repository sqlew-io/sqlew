/**
 * Type definitions for the `project` MCP tool.
 */

export type ProjectAction =
  | 'current'
  | 'resolve'
  | 'list'
  | 'validate'
  | 'help'
  | 'example';

export interface ProjectToolParams {
  action: ProjectAction;
  /** Absolute path to the project root (for resolve/validate). */
  root?: string;
  /** Project name (for resolve/validate). */
  name?: string;
  /** Stable ref, e.g. "sqlew_proj_3" (for resolve/validate). */
  ref?: string;
  /** Allow creating a new project when resolving by name. */
  allow_create?: boolean;
}

export interface ProjectSummary {
  id: number;
  name: string;
  display_name?: string;
  root?: string;
  detection_source: string;
  ref: string;
}
