/**
 * Migration: v4.0 Data Migration from v3.x
 *
 * Copies data from v3.x tables (m_/t_ prefix) to v4_ tables.
 * This migration is idempotent - it only copies data if v4_ tables are empty.
 *
 * Migration Strategy:
 * 1. Check if v3.x tables exist (detect upgrade vs fresh install)
 * 2. For each table, check if v4_ version is empty
 * 3. Copy data preserving IDs and foreign key relationships
 * 4. Skip deprecated tables: t_agent_messages, t_activity_log, t_decision_templates, m_agents
 *
 * Tables Migrated (31 total):
 * - Master Tables: m_projects → v4_projects, etc. (m_agents removed in v4.0)
 * - Transaction Tables: t_decisions → v4_decisions, t_tasks → v4_tasks, etc.
 *
 * Tables NOT Migrated (deprecated in v4.0):
 * - m_agents - agent tracking removed (v3.6.5 simplified system, now fully removed)
 * - t_agent_messages - messaging system removed
 * - t_activity_log - activity logging removed
 * - t_decision_templates - merged into v4_decision_policies
 */

import type { Knex } from 'knex';
import { createHash } from 'crypto';

export async function up(knex: Knex): Promise<void> {
  console.error('🔄 Starting v4.0 data migration from v3.x...');

  // Check if this is an upgrade (v3.x tables exist) or fresh install
  const hasV3Tables = await knex.schema.hasTable('m_agents');

  if (!hasV3Tables) {
    console.error('  ℹ️ No v3.x tables found - this is a fresh install, skipping data migration');
    return;
  }

  // ============================================================================
  // Helper Functions
  // ============================================================================

  /**
   * Migrate table data if target is empty
   * Automatically filters columns to only those that exist in source table
   */
  async function migrateTable(
    sourceTable: string,
    targetTable: string,
    columns: string[],
    options: {
      columnMapping?: Record<string, string>;
      filter?: string;
      upsertKey?: string;
      autoFilterColumns?: boolean;
    } = {}
  ): Promise<number> {
    const sourceExists = await knex.schema.hasTable(sourceTable);
    if (!sourceExists) {
      console.error(`  ⚠️ ${sourceTable} does not exist, skipping`);
      return 0;
    }

    const targetCount = await knex(targetTable).count('* as count').first();
    const hasTargetData = targetCount && Number(targetCount.count) > 0;

    if (hasTargetData && !options.upsertKey) {
      console.error(`  ✓ ${targetTable} already has data, skipping`);
      return 0;
    }

    let effectiveColumns = columns;
    if (options.autoFilterColumns !== false) {
      const existingColumns: string[] = [];
      for (const col of columns) {
        const sourceCol = options.columnMapping?.[col] || col;
        if (await knex.schema.hasColumn(sourceTable, sourceCol)) {
          existingColumns.push(col);
        }
      }
      effectiveColumns = existingColumns;

      if (effectiveColumns.length === 0) {
        console.error(`  ⚠️ ${sourceTable} has none of the expected columns, skipping`);
        return 0;
      }
    }

    const selectColumns = effectiveColumns.map(col => {
      if (options.columnMapping && options.columnMapping[col]) {
        return `${options.columnMapping[col]} as ${col}`;
      }
      return col;
    });

    let query = knex(sourceTable).select(knex.raw(selectColumns.join(', ')));
    if (options.filter) {
      query = query.whereRaw(options.filter);
    }

    const sourceData = await query;

    if (sourceData.length === 0) {
      console.error(`  ℹ️ ${sourceTable} is empty, nothing to migrate`);
      return 0;
    }

    let dataToInsert = sourceData;
    if (options.upsertKey && hasTargetData) {
      const existingKeys = await knex(targetTable)
        .select(options.upsertKey)
        .then(rows => new Set(rows.map((r: any) => r[options.upsertKey!])));

      dataToInsert = sourceData.filter((row: any) => !existingKeys.has(row[options.upsertKey!]));

      if (dataToInsert.length === 0) {
        console.error(`  ✓ ${targetTable} already has all data from ${sourceTable}, skipping`);
        return 0;
      }
    }

    const batchSize = 100;
    for (let i = 0; i < dataToInsert.length; i += batchSize) {
      const batch = dataToInsert.slice(i, i + batchSize);
      await knex(targetTable).insert(batch);
    }

    console.error(`  ✓ Migrated ${dataToInsert.length} rows: ${sourceTable} → ${targetTable}`);
    return dataToInsert.length;
  }

  let totalMigrated = 0;

  // ============================================================================
  // 1. Migrate Master Tables
  // ============================================================================

  console.error('\n📋 Migrating master tables...');

  // m_agents migration removed - agent tracking no longer used in v4.0

  // Delete seeded default project to avoid ID conflict with v3 data
  await knex('v4_projects').where('name', 'default').del();

  const hasProjectsTable = await knex.schema.hasTable('m_projects');
  if (hasProjectsTable) {
    const projectCols = ['id', 'name'];
    if (await knex.schema.hasColumn('m_projects', 'display_name')) projectCols.push('display_name');
    if (await knex.schema.hasColumn('m_projects', 'detection_source')) projectCols.push('detection_source');
    if (await knex.schema.hasColumn('m_projects', 'project_root_path')) projectCols.push('project_root_path');
    if (await knex.schema.hasColumn('m_projects', 'created_ts')) projectCols.push('created_ts');
    if (await knex.schema.hasColumn('m_projects', 'last_active_ts')) projectCols.push('last_active_ts');
    if (await knex.schema.hasColumn('m_projects', 'metadata')) projectCols.push('metadata');
    totalMigrated += await migrateTable('m_projects', 'v4_projects', projectCols, { upsertKey: 'name' });
  }

  totalMigrated += await migrateTable('m_layers', 'v4_layers', ['id', 'name'], { upsertKey: 'name' });
  totalMigrated += await migrateTable('m_constraint_categories', 'v4_constraint_categories', ['id', 'name'], { upsertKey: 'name' });
  totalMigrated += await migrateTable('m_task_statuses', 'v4_task_statuses', ['id', 'name'], { upsertKey: 'name' });

  // v4_context_keys - 'key' is MySQL reserved word
  const contextKeysExists = await knex.schema.hasTable('m_context_keys');
  if (contextKeysExists) {
    const targetCount = await knex('v4_context_keys').count('* as count').first();
    if (!targetCount || Number(targetCount.count) === 0) {
      const client = knex.client.config.client;
      const isMySQL = client === 'mysql2' || client === 'mysql';
      const keyCol = isMySQL ? '`key`' : 'key';

      const sourceData = await knex('m_context_keys').select(knex.raw(`id, ${keyCol} as key_name`));
      if (sourceData.length > 0) {
        const batchSize = 100;
        for (let i = 0; i < sourceData.length; i += batchSize) {
          const batch = sourceData.slice(i, i + batchSize);
          await knex('v4_context_keys').insert(batch);
        }
        console.error(`  ✓ Migrated ${sourceData.length} rows: m_context_keys → v4_context_keys`);
        totalMigrated += sourceData.length;
      }
    } else {
      console.error('  ✓ v4_context_keys already has data, skipping');
    }
  }

  // v4_files - no path_hash in v4 schema, uses path directly
  const filesExists = await knex.schema.hasTable('m_files');
  if (filesExists) {
    const targetCount = await knex('v4_files').count('* as count').first();
    const hasTargetData = targetCount && Number(targetCount.count) > 0;

    if (!hasTargetData) {
      const sourceFiles = await knex('m_files').select('id', 'project_id', 'path');
      if (sourceFiles.length > 0) {
        const filesToInsert = sourceFiles.map((f: any) => ({
          id: f.id,
          project_id: f.project_id,
          path: f.path,
        }));

        const batchSize = 100;
        for (let i = 0; i < filesToInsert.length; i += batchSize) {
          const batch = filesToInsert.slice(i, i + batchSize);
          await knex('v4_files').insert(batch);
        }
        console.error(`  ✓ Migrated ${filesToInsert.length} rows: m_files → v4_files`);
        totalMigrated += filesToInsert.length;
      } else {
        console.error('  ℹ️ m_files is empty, nothing to migrate');
      }
    } else {
      console.error('  ✓ v4_files already has data, skipping');
    }
  }

  totalMigrated += await migrateTable('m_tags', 'v4_tags', ['id', 'project_id', 'name'], { upsertKey: 'name' });
  totalMigrated += await migrateTable('m_scopes', 'v4_scopes', ['id', 'project_id', 'name'], { upsertKey: 'name' });

  // Note: v4_config removed in v4.0 - config is now in-memory
  // m_config data is not migrated (use CLI args or config file instead)

  const hasHelpTools = await knex.schema.hasTable('m_help_tools');
  if (hasHelpTools) {
    const hasOverview = await knex.schema.hasColumn('m_help_tools', 'overview');
    if (hasOverview) {
      totalMigrated += await migrateTable('m_help_tools', 'v4_help_tools', ['tool_name', 'description', 'overview']);
    } else {
      totalMigrated += await migrateTable('m_help_tools', 'v4_help_tools', ['tool_name', 'description']);
    }
  }

  const hasHelpActions = await knex.schema.hasTable('m_help_actions');
  if (hasHelpActions) {
    const hasActionId = await knex.schema.hasColumn('m_help_actions', 'action_id');
    const hasReturns = await knex.schema.hasColumn('m_help_actions', 'returns');
    if (hasActionId) {
      if (hasReturns) {
        totalMigrated += await migrateTable('m_help_actions', 'v4_help_actions',
          ['id', 'tool_name', 'action_name', 'description', 'returns'],
          { columnMapping: { 'id': 'action_id' } }
        );
      } else {
        totalMigrated += await migrateTable('m_help_actions', 'v4_help_actions',
          ['id', 'tool_name', 'action_name', 'description'],
          { columnMapping: { 'id': 'action_id' } }
        );
      }
    }
  }

  const hasUseCaseCats = await knex.schema.hasTable('m_help_use_case_categories');
  if (hasUseCaseCats) {
    const hasCategoryId = await knex.schema.hasColumn('m_help_use_case_categories', 'category_id');
    if (hasCategoryId) {
      totalMigrated += await migrateTable('m_help_use_case_categories', 'v4_help_use_case_cats',
        ['id', 'category_name', 'description'],
        { columnMapping: { 'id': 'category_id' } }
      );
    }
  }

  const hasBuiltinPolicies = await knex.schema.hasTable('m_builtin_policies');
  if (hasBuiltinPolicies) {
    totalMigrated += await migrateTable('m_builtin_policies', 'v4_builtin_policies', [
      'id', 'name', 'defaults', 'validation_rules', 'quality_gates', 'suggest_similar', 'category'
    ]);
  }

  console.error('  ℹ️ Skipping m_tag_index migration (incompatible v3 schema)');
  console.error(`  📊 Master tables: ${totalMigrated} rows migrated`);

  // ============================================================================
  // 2. Migrate Transaction Tables
  // ============================================================================

  console.error('\n📋 Migrating transaction tables...');
  let transactionMigrated = 0;

  const hasProjectIdInDecisions = await knex.schema.hasColumn('t_decisions', 'project_id');
  if (hasProjectIdInDecisions) {
    // Newer v3 schemas: simply copy project_id from source table (agent_id removed in v4.0)
    transactionMigrated += await migrateTable('t_decisions', 'v4_decisions', [
      'key_id', 'project_id', 'value', 'layer_id', 'version', 'status', 'ts'
    ]);
  } else {
    // Legacy v3 schemas: t_decisions does not have a project_id column,
    // so we assign a fixed value of 1 during migration.
    const hasTDecisions = await knex.schema.hasTable('t_decisions');
    if (!hasTDecisions) {
      console.error('  ⚠️ t_decisions does not exist, skipping');
    } else {
      const targetCount = await knex('v4_decisions').count('* as count').first();
      const hasTargetData = targetCount && Number(targetCount.count) > 0;

      if (hasTargetData) {
        console.error('  ✓ v4_decisions already has data, skipping');
      } else {
        const sourceRows = await knex('t_decisions').select(
          'key_id',
          'value',
          'layer_id',
          'version',
          'status',
          'ts',
        );

        if (sourceRows.length === 0) {
          console.error('  ℹ️ t_decisions is empty, nothing to migrate');
        } else {
          const rowsToInsert = sourceRows.map((row: any) => ({
            key_id: row.key_id,
            project_id: 1,
            value: row.value,
            layer_id: row.layer_id,
            version: row.version,
            status: row.status,
            ts: row.ts,
          }));

          const batchSize = 100;
          for (let i = 0; i < rowsToInsert.length; i += batchSize) {
            const batch = rowsToInsert.slice(i, i + batchSize);
            await knex('v4_decisions').insert(batch);
          }

          console.error(`  ✓ Migrated ${rowsToInsert.length} rows: t_decisions → v4_decisions`);
          transactionMigrated += rowsToInsert.length;
        }
      }
    }
  }

  if (hasProjectIdInDecisions) {
    transactionMigrated += await migrateTable('t_decisions_numeric', 'v4_decisions_numeric', [
      'key_id', 'project_id', 'value', 'layer_id', 'version', 'status', 'ts'
    ]);
  }

  transactionMigrated += await migrateTable('t_decision_history', 'v4_decision_history', [
    'id', 'key_id', 'project_id', 'version', 'value', 'ts'
  ]);

  transactionMigrated += await migrateTable('t_decision_tags', 'v4_decision_tags', [
    'decision_key_id', 'project_id', 'tag_id'
  ]);

  transactionMigrated += await migrateTable('t_decision_scopes', 'v4_decision_scopes', [
    'decision_key_id', 'project_id', 'scope_id'
  ]);

  // Filter orphaned decision_context records
  transactionMigrated += await migrateTable('t_decision_context', 'v4_decision_context', [
    'id', 'decision_key_id', 'project_id', 'rationale', 'alternatives_considered',
    'tradeoffs', 'decision_date', 'related_task_id', 'related_constraint_id', 'ts'
  ], { filter: 'decision_key_id IN (SELECT key_id FROM t_decisions)' });

  const hasDecisionPolicies = await knex.schema.hasTable('t_decision_policies');
  if (hasDecisionPolicies) {
    transactionMigrated += await migrateTable('t_decision_policies', 'v4_decision_policies', [
      'id', 'name', 'project_id', 'description', 'defaults', 'required_fields',
      'validation_rules', 'quality_gates', 'suggest_similar', 'category', 'ts'
    ]);
  }

  const hasPruningLog = await knex.schema.hasTable('t_decision_pruning_log');
  if (hasPruningLog) {
    transactionMigrated += await migrateTable('t_decision_pruning_log', 'v4_decision_pruning_log', [
      'id', 'decision_key_id', 'project_id', 'pruned_at', 'reason'
    ]);
  }

  transactionMigrated += await migrateTable('t_file_changes', 'v4_file_changes', [
    'id', 'file_id', 'project_id', 'layer_id', 'change_type', 'description', 'ts'
  ]);

  transactionMigrated += await migrateTable('t_constraints', 'v4_constraints', [
    'id', 'category_id', 'project_id', 'layer_id', 'constraint_text', 'priority', 'active', 'ts'
  ]);

  transactionMigrated += await migrateTable('t_constraint_tags', 'v4_constraint_tags', [
    'constraint_id', 'tag_id'
  ]);

  transactionMigrated += await migrateTable('t_tasks', 'v4_tasks', [
    'id', 'title', 'project_id', 'status_id', 'priority',
    'layer_id', 'created_ts', 'updated_ts', 'completed_ts'
  ]);

  // Filter orphaned records: only migrate task_details where task exists
  transactionMigrated += await migrateTable('t_task_details', 'v4_task_details', [
    'task_id', 'description', 'acceptance_criteria', 'acceptance_criteria_json', 'notes'
  ], { filter: 'task_id IN (SELECT id FROM t_tasks)' });

  transactionMigrated += await migrateTable('t_task_tags', 'v4_task_tags', [
    'task_id', 'project_id', 'tag_id'
  ], { filter: 'task_id IN (SELECT id FROM t_tasks)' });

  transactionMigrated += await migrateTable('t_task_decision_links', 'v4_task_decision_links', [
    'task_id', 'project_id', 'decision_key_id', 'link_type'
  ], { filter: 'task_id IN (SELECT id FROM t_tasks)' });

  transactionMigrated += await migrateTable('t_task_constraint_links', 'v4_task_constraint_links', [
    'task_id', 'constraint_id'
  ], { filter: 'task_id IN (SELECT id FROM t_tasks)' });

  const hasTaskFileLinks = await knex.schema.hasTable('t_task_file_links');
  if (hasTaskFileLinks) {
    const hasAction = await knex.schema.hasColumn('t_task_file_links', 'action');
    if (hasAction) {
      transactionMigrated += await migrateTable('t_task_file_links', 'v4_task_file_links', [
        'task_id', 'project_id', 'file_id', 'action'
      ], { filter: 'task_id IN (SELECT id FROM t_tasks)' });
    } else {
      transactionMigrated += await migrateTable('t_task_file_links', 'v4_task_file_links', [
        'task_id', 'project_id', 'file_id'
      ], { filter: 'task_id IN (SELECT id FROM t_tasks)' });
    }
  }

  transactionMigrated += await migrateTable('t_task_dependencies', 'v4_task_dependencies', [
    'blocker_task_id', 'blocked_task_id', 'project_id', 'created_ts'
  ], { filter: 'blocker_task_id IN (SELECT id FROM t_tasks) AND blocked_task_id IN (SELECT id FROM t_tasks)' });

  const hasTaskPrunedFiles = await knex.schema.hasTable('t_task_pruned_files');
  if (hasTaskPrunedFiles) {
    console.error('  ℹ️ Skipping t_task_pruned_files migration (schema varies, data regenerable)');
  }

  console.error('  ℹ️ Help system data: v4_bootstrap seeds fresh data (tools, actions, params, use cases, policies)');

  const hasTokenUsage = await knex.schema.hasTable('t_token_usage');
  if (hasTokenUsage) {
    transactionMigrated += await migrateTable('t_token_usage', 'v4_token_usage', [
      'id', 'project_id', 'tool_name', 'action_name', 'tokens_used', 'ts'
    ]);
  }

  console.error(`  📊 Transaction tables: ${transactionMigrated} rows migrated`);

  // ============================================================================
  // 3. Summary
  // ============================================================================

  console.error('\n🎉 v4.0 data migration completed!');
  console.error(`   Total rows migrated: ${totalMigrated + transactionMigrated}`);
  console.error('   ⚠️ Deprecated tables NOT migrated:');
  console.error('      - m_agents (agent tracking removed in v4.0)');
  console.error('      - t_agent_messages (messaging removed)');
  console.error('      - t_activity_log (activity logging removed)');
  console.error('      - t_decision_templates (merged into v4_decision_policies)');
}

export async function down(knex: Knex): Promise<void> {
  console.error('🔄 Clearing v4.0 migrated data...');

  const transactionTables = [
    'v4_token_usage',
    'v4_help_action_sequences', 'v4_help_use_cases', 'v4_help_action_examples', 'v4_help_action_params',
    'v4_task_pruned_files', 'v4_task_dependencies', 'v4_task_file_links', 'v4_task_constraint_links',
    'v4_task_decision_links', 'v4_task_tags', 'v4_task_details', 'v4_tasks',
    'v4_constraint_tags', 'v4_constraints', 'v4_file_changes',
    'v4_decision_pruning_log', 'v4_decision_policies', 'v4_decision_context', 'v4_decision_scopes',
    'v4_decision_tags', 'v4_decision_history', 'v4_decisions_numeric', 'v4_decisions',
  ];

  for (const table of transactionTables) {
    try {
      await knex(table).del();
    } catch {
      // Table might not exist
    }
  }

  console.error('✅ v4.0 migrated data cleared (master table seeds preserved)');
}
