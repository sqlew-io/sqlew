/**
 * JSON import/export system types (v3.7.3)
 */

/**
 * Options for JSON import operation
 */
export interface JsonImportOptions {
  /** Optional: Target project name (if not provided, uses name from JSON) */
  targetProjectName?: string;
  /** Optional: Skip import if project already exists (default: true) */
  skipIfExists?: boolean;
  /** Optional: Dry run mode - validate only, don't import (default: false) */
  dryRun?: boolean;
}

/**
 * JSON import validation result
 */
export interface ImportValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  schema_version?: number;
  sqlew_version?: string;
  export_mode?: 'single_project' | 'all_projects';
}

/**
 * ID mapping for a single master table
 * Maps old IDs (from export) to new IDs (in target database)
 */
export interface IdMapping extends Map<number, number> {}

/**
 * Complete ID mapping context for all master tables
 * Note: agents removed in v4.0, files/tasks removed in v5.0
 */
export interface ImportIdMappings {
  projects: IdMapping;
  context_keys: IdMapping;
  tags: IdMapping;
  scopes: IdMapping;
  constraint_categories: IdMapping;
  layers: IdMapping;
  decision_policies: IdMapping;  // v4.0+ table
}

/**
 * Import context - holds all state during import operation
 */
export interface ImportContext {
  /** Knex instance for database operations */
  knex: any;
  /** ID mappings for all tables */
  mappings: ImportIdMappings;
  /** Target project ID (created during import) */
  projectId: number;
  /** Source JSON data */
  jsonData: any;
  /** Import options */
  options: JsonImportOptions;
  /** Statistics (updated during import) */
  stats: ImportStats;
}

/**
 * Import statistics
 * Note: agents_created, activity_log_created removed in v4.0
 * Note: files/tasks related stats removed in v5.0
 */
export interface ImportStats {
  project_created: boolean;
  master_tables: {
    context_keys_created: number;
    tags_created: number;
    tags_reused: number;
    scopes_created: number;
    scopes_reused: number;
  };
  transaction_tables: {
    decisions_created: number;
    decisions_numeric_created: number;
    decision_history_created: number;
    decision_context_created: number;
    constraints_created: number;
    decision_policies_created: number;  // v4.0+ table
    tag_index_created: number;  // v4.0+ table
  };
  junction_tables: {
    decision_tags_created: number;
    decision_scopes_created: number;
    constraint_tags_created: number;
  };
}

/**
 * JSON import result
 */
export interface JsonImportResult {
  success: boolean;
  project_id?: number;
  project_name?: string;
  stats?: ImportStats;
  error?: string;
  skipped?: boolean;
  skip_reason?: string;
}
