/**
 * Schema Version Detection Module (v4.0)
 *
 * Detects the current database schema version based on table presence.
 * Used by the query layer to determine which tables to use.
 *
 * Version Detection Logic:
 * - v4.x: m_projects table exists → use v4_ tables
 * - v3.x: m_agents table exists but no v4_ tables → use m_/t_ tables
 * - v2.x: Legacy tables without m_ prefix (unlikely to exist now)
 *
 * This module is critical for backward compatibility during the v3→v4 transition.
 */

import type { Knex } from 'knex';
import { debugLog } from '../../utils/debug-logger.js';

/**
 * Schema version enum
 */
export type SchemaVersion = 'v5' | 'v4' | 'v3' | 'unknown';

/**
 * Detailed schema version info
 */
export interface SchemaVersionInfo {
  version: SchemaVersion;
  majorVersion: number;
  minorVersion: number;
  hasV4Tables: boolean;
  hasV3Tables: boolean;
  tablePrefix: 'm_' | 'v4_' | '';
  transactionPrefix: 't_' | 'v4_' | '';
  detectedAt: number;
}

// Singleton instance
let cachedVersionInfo: SchemaVersionInfo | null = null;

/**
 * Detect schema version by checking table existence
 */
export async function detectSchemaVersion(knex: Knex): Promise<SchemaVersionInfo> {
  // Return cached version if already detected in this session
  if (cachedVersionInfo) {
    return cachedVersionInfo;
  }

  debugLog('INFO', 'Detecting database schema version...');

  // Check core tables for version detection
  const hasMProjects = await knex.schema.hasTable('m_projects');
  const hasTDecisions = await knex.schema.hasTable('t_decisions');
  const hasTConstraints = await knex.schema.hasTable('t_constraints');

  // Check v4-specific table (dropped in v5.0)
  const hasV4Tasks = await knex.schema.hasTable('v4_tasks');

  // Check v3-specific tables (dropped in v4.0/v5.0)
  const hasAgents = await knex.schema.hasTable('m_agents');
  const hasV3Tasks = await knex.schema.hasTable('t_tasks');

  // Determine schema version (v5 first, since migrations run before detection)
  const hasV5Tables = hasMProjects && hasTDecisions && hasTConstraints && !hasV4Tasks;
  const hasV4Tables = hasMProjects && hasTDecisions && hasV4Tasks;
  const hasV3Tables = hasAgents && hasTDecisions && hasV3Tasks;

  let version: SchemaVersion;
  let majorVersion: number;
  let minorVersion: number;
  let tablePrefix: 'm_' | 'v4_' | '';
  let transactionPrefix: 't_' | 'v4_' | '';

  if (hasV5Tables) {
    // v5.x schema detected - m_/t_ prefix (current)
    version = 'v5';
    majorVersion = 5;
    minorVersion = 0;
    tablePrefix = 'm_';
    transactionPrefix = 't_';

    debugLog('INFO', 'Schema version detected: v5.x (using m_/t_ tables)');
  } else if (hasV4Tables) {
    // v4.x schema detected - v4_ prefix (pre-migration)
    version = 'v4';
    majorVersion = 4;
    minorVersion = 0;
    tablePrefix = 'v4_';
    transactionPrefix = 'v4_';

    debugLog('INFO', 'Schema version detected: v4.x (using v4_ tables)');
  } else if (hasV3Tables) {
    // v3.x schema detected - legacy tables
    version = 'v3';
    majorVersion = 3;
    minorVersion = 0;
    tablePrefix = 'm_';
    transactionPrefix = 't_';

    debugLog('INFO', 'Schema version detected: v3.x (using m_/t_ tables)');
  } else {
    // Unknown schema - this shouldn't happen after migrations
    version = 'unknown';
    majorVersion = 0;
    minorVersion = 0;
    tablePrefix = '';
    transactionPrefix = '';

    debugLog('WARN', 'Unknown schema version detected - no expected tables found');
  }

  cachedVersionInfo = {
    version,
    majorVersion,
    minorVersion,
    hasV4Tables,
    hasV3Tables,
    tablePrefix,
    transactionPrefix,
    detectedAt: Date.now(),
  };

  return cachedVersionInfo;
}

/**
 * Get cached schema version info (throws if not yet detected)
 */
export function getSchemaVersion(): SchemaVersionInfo {
  if (!cachedVersionInfo) {
    throw new Error('Schema version not yet detected. Call detectSchemaVersion() first.');
  }
  return cachedVersionInfo;
}

/**
 * Check if schema version has been detected
 */
export function isSchemaVersionDetected(): boolean {
  return cachedVersionInfo !== null;
}

/**
 * Clear cached schema version (for testing)
 */
export function clearSchemaVersionCache(): void {
  cachedVersionInfo = null;
}

/**
 * Check if using v5 schema
 */
export function isV5Schema(): boolean {
  return cachedVersionInfo?.version === 'v5';
}

/**
 * Check if using v4 schema
 */
export function isV4Schema(): boolean {
  return cachedVersionInfo?.version === 'v4';
}

/**
 * Check if using v3 schema
 */
export function isV3Schema(): boolean {
  return cachedVersionInfo?.version === 'v3';
}

/**
 * Get table name with correct prefix
 *
 * @param baseName - Base table name without prefix (e.g., 'agents', 'decisions')
 * @param type - 'master' for reference tables, 'transaction' for data tables
 * @returns Prefixed table name (e.g., 'v4_agents' or 'v4_agents')
 */
export function getTableName(
  baseName: string,
  type: 'master' | 'transaction' = 'transaction'
): string {
  if (!cachedVersionInfo) {
    // Fallback to v3 naming if version not detected
    return type === 'master' ? `m_${baseName}` : `t_${baseName}`;
  }

  if (cachedVersionInfo.version === 'v4') {
    // v4 uses unified v4_ prefix for all tables
    return `v4_${baseName}`;
  }

  // v3 uses m_ for master tables, t_ for transaction tables
  return type === 'master' ? `m_${baseName}` : `t_${baseName}`;
}

/**
 * Get table names for common tables
 */
export const TableNames = {
  // Master tables (agents removed in v4.0)
  projects: () => getTableName('projects', 'master'),
  layers: () => getTableName('layers', 'master'),
  tags: () => getTableName('tags', 'master'),
  files: () => getTableName('files', 'master'),
  contextKeys: () => getTableName('context_keys', 'master'),
  constraintCategories: () => getTableName('constraint_categories', 'master'),
  taskStatuses: () => getTableName('task_statuses', 'master'),
  config: () => getTableName('config', 'master'),

  // Transaction tables
  decisions: () => getTableName('decisions', 'transaction'),
  decisionHistory: () => getTableName('decision_history', 'transaction'),
  decisionContext: () => getTableName('decision_context', 'transaction'),
  decisionPolicies: () => getTableName('decision_policies', 'transaction'),
  tasks: () => getTableName('tasks', 'transaction'),
  taskDependencies: () => getTableName('task_dependencies', 'transaction'),
  taskFileLinks: () => getTableName('task_file_links', 'transaction'),
  taskDecisionLinks: () => getTableName('task_decision_links', 'transaction'),
  fileChanges: () => getTableName('file_changes', 'transaction'),
  constraints: () => getTableName('constraints', 'transaction'),
  tagIndex: () => getTableName('tag_index', 'transaction'),

  // Help system tables (v4 only has these with v4_ prefix)
  helpTools: () => cachedVersionInfo?.version === 'v4' ? 'm_help_tools' : 'm_help_tools',
  helpActions: () => cachedVersionInfo?.version === 'v4' ? 'm_help_actions' : 'm_help_actions',
  helpActionParams: () => cachedVersionInfo?.version === 'v4' ? 't_help_action_params' : 'm_help_action_params',
  helpActionExamples: () => cachedVersionInfo?.version === 'v4' ? 't_help_action_examples' : 'm_help_action_examples',
  helpUseCases: () => cachedVersionInfo?.version === 'v4' ? 't_help_use_cases' : 'm_help_use_cases',
  helpUseCaseCategories: () => cachedVersionInfo?.version === 'v4' ? 'm_help_use_case_cats' : 'm_help_use_case_cats',
};
