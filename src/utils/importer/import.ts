/**
 * JSON Import Main Orchestrator
 *
 * Coordinates the entire import process with transaction atomicity.
 * Implements architectural decisions #247-259 for safe multi-project data migration.
 *
 * Import Order:
 * 1. Validate JSON schema
 * 2. Check project name conflict (skip if exists)
 * 3. Create new project
 * 4. Import master tables → ID mappings
 * 5. Import transaction data with remapped IDs
 * 6. Import junction tables with remapped IDs
 */

import type { Knex } from 'knex';
import type {
  JsonImportOptions,
  JsonImportResult,
  ImportContext,
  ImportStats,
} from '../../types.js';
import { importMasterTables } from './master-tables.js';
import { insertReturningId } from '../insert-returning-id.js';

/**
 * Main import function
 *
 * Architectural Decision #256: Transaction atomicity
 * All imports wrapped in transaction, rollback on error
 *
 * @param knex - Knex database instance
 * @param jsonData - Parsed JSON export data
 * @param options - Import options
 * @returns Import result with statistics
 */
export async function importJsonData(
  knex: Knex,
  jsonData: any,
  options: JsonImportOptions = {}
): Promise<JsonImportResult> {
  const { targetProjectName, skipIfExists = true, dryRun = false } = options;

  // Step 1: Extract project name
  const projectName = targetProjectName || jsonData.project?.name || jsonData.projects?.[0]?.name;
  if (!projectName) {
    return {
      success: false,
      error: 'No project name specified and none found in JSON export'
    };
  }

  console.error(`\nImporting project: ${projectName}`);

  // Step 2: Check for project name conflict
  const existingProject = await knex('m_projects')
    .where({ name: projectName })
    .first();

  if (existingProject && skipIfExists) {
    console.error(`⚠️  Project "${projectName}" already exists (ID: ${existingProject.id})`);
    console.error(`   Skipping import to avoid conflicts`);
    return {
      success: true,
      skipped: true,
      skip_reason: 'project_exists',
      project_name: projectName
    };
  }

  if (dryRun) {
    console.error(`✓ Dry run: Validation passed, would import to new project "${projectName}"`);
    return {
      success: true,
      project_name: projectName
    };
  }

  // Step 3: Perform import in transaction
  try {
    const result = await knex.transaction(async (trx) => {
      return await performImport(trx, jsonData, projectName);
    });

    console.error(`\n✓ Import complete: ${result.stats!.transaction_tables.decisions_created} decisions, ${result.stats!.transaction_tables.constraints_created} constraints`);
    return result;

  } catch (error) {
    console.error(`\n❌ Import failed: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`   Transaction rolled back, no data imported`);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Perform import within transaction
 */
async function performImport(
  trx: Knex.Transaction,
  jsonData: any,
  projectName: string
): Promise<JsonImportResult> {
  // Step 1: Create new project
  const projectData = jsonData.project || jsonData.projects?.[0];
  const projectId = await insertReturningId(trx, 'm_projects', {
    name: projectName,
    display_name: projectData?.display_name || projectName,
    detection_source: projectData?.detection_source || 'import',
    project_root_path: projectData?.project_root_path || null,
    created_ts: Math.floor(Date.now() / 1000),
    last_active_ts: Math.floor(Date.now() / 1000),
    metadata: JSON.stringify({
      imported_at: new Date().toISOString(),
      source_version: jsonData.metadata?.sqlew_version || jsonData.version,
      source_export_mode: jsonData.metadata?.export_mode || jsonData.export_mode
    })
  });

  console.error(`  ✓ Created project "${projectName}" (ID: ${projectId})`);

  // Step 2: Initialize import context
  // Note: agents mapping removed in v4.0 (agent system deleted)
  const ctx: ImportContext = {
    knex: trx,
    projectId,
    jsonData,
    options: {},
    mappings: {
      projects: new Map(),
      context_keys: new Map(),
      tags: new Map(),
      scopes: new Map(),
      constraint_categories: new Map(),
      layers: new Map(),
      decision_policies: new Map()
    },
    stats: initializeStats()
  };

  ctx.stats.project_created = true;

  // Step 3: Import master tables
  await importMasterTables(ctx);

  // Step 4: Import transaction tables
  await importTransactionTables(ctx);

  // Step 5: Import junction tables
  await importJunctionTables(ctx);

  return {
    success: true,
    project_id: projectId,
    project_name: projectName,
    stats: ctx.stats
  };
}

/**
 * Import transaction tables with ID remapping
 */
async function importTransactionTables(ctx: ImportContext): Promise<void> {
  console.error('  Importing transaction tables...');

  // Import in dependency order
  // Note: activity_log removed in v4.0 (table was never created)
  // Note: file_changes, tasks, task_details removed in v5.0
  await importDecisions(ctx);
  await importDecisionsNumeric(ctx);
  await importDecisionHistory(ctx);
  await importDecisionContext(ctx);
  await importConstraints(ctx);
  await importDecisionPolicies(ctx);  // v4.0+ table
  await importTagIndex(ctx);  // v4.0+ table

  console.error(`  ✓ Transaction tables imported`);
}

/**
 * Import t_decisions with remapped context_key IDs
 */
async function importDecisions(ctx: ImportContext): Promise<void> {
  const decisions = ctx.jsonData.transaction_tables.decisions || [];

  for (const decision of decisions) {
    const newKeyId = ctx.mappings.context_keys.get(decision.key_id);
    if (!newKeyId) continue;

    // Note: agent_id removed in v4.0
    await ctx.knex('t_decisions').insert({
      key_id: newKeyId,
      value: decision.value,
      layer_id: ctx.mappings.layers.get(decision.layer_id) || null,
      version: decision.version,
      status: decision.status,
      ts: decision.ts,
      project_id: ctx.projectId
    });
  }

  ctx.stats.transaction_tables.decisions_created = decisions.length;
}

/**
 * Import t_decisions_numeric with remapped context_key IDs
 */
async function importDecisionsNumeric(ctx: ImportContext): Promise<void> {
  const decisions = ctx.jsonData.transaction_tables.decisions_numeric || [];

  for (const decision of decisions) {
    const newKeyId = ctx.mappings.context_keys.get(decision.key_id);
    if (!newKeyId) continue;

    // Note: agent_id removed in v4.0
    await ctx.knex('t_decisions_numeric').insert({
      key_id: newKeyId,
      value: decision.value,
      layer_id: ctx.mappings.layers.get(decision.layer_id) || null,
      version: decision.version,
      status: decision.status,
      ts: decision.ts,
      project_id: ctx.projectId
    });
  }

  ctx.stats.transaction_tables.decisions_numeric_created = decisions.length;
}

/**
 * Import t_decision_history with remapped context_key IDs
 */
async function importDecisionHistory(ctx: ImportContext): Promise<void> {
  const history = ctx.jsonData.transaction_tables.decision_history || [];

  for (const entry of history) {
    const newKeyId = ctx.mappings.context_keys.get(entry.key_id);
    if (!newKeyId) continue;

    // Note: agent_id removed in v4.0
    await ctx.knex('t_decision_history').insert({
      key_id: newKeyId,
      version: entry.version,
      value: entry.value,
      ts: entry.ts,
      project_id: ctx.projectId
    });
  }

  ctx.stats.transaction_tables.decision_history_created = history.length;
}

/**
 * Import t_decision_context with remapped IDs
 */
async function importDecisionContext(ctx: ImportContext): Promise<void> {
  const contexts = ctx.jsonData.transaction_tables.decision_context || [];

  for (const context of contexts) {
    const newKeyId = ctx.mappings.context_keys.get(context.decision_key_id);
    if (!newKeyId) continue;

    // Note: agent_id removed in v4.0, related_task_id removed in v5.0
    await ctx.knex('t_decision_context').insert({
      decision_key_id: newKeyId,
      rationale: context.rationale,
      alternatives_considered: context.alternatives_considered,
      tradeoffs: context.tradeoffs,
      decision_date: context.decision_date,
      related_constraint_id: null,
      project_id: ctx.projectId
    });
  }

  ctx.stats.transaction_tables.decision_context_created = contexts.length;
}

/**
 * Import t_constraints with remapped IDs
 */
async function importConstraints(ctx: ImportContext): Promise<void> {
  const constraints = ctx.jsonData.transaction_tables.constraints || [];

  for (const constraint of constraints) {
    // Note: agent_id removed in v4.0
    await ctx.knex('t_constraints').insert({
      category_id: ctx.mappings.constraint_categories.get(constraint.category_id) || constraint.category_id,
      constraint_text: constraint.constraint_text,
      priority: constraint.priority,
      active: constraint.active,
      layer_id: ctx.mappings.layers.get(constraint.layer_id) || null,
      ts: constraint.ts,
      project_id: ctx.projectId
    });
  }

  ctx.stats.transaction_tables.constraints_created = constraints.length;
}

/**
 * Import t_decision_policies (v4.0+ table)
 */
async function importDecisionPolicies(ctx: ImportContext): Promise<void> {
  const policies = ctx.jsonData.master_tables?.decision_policies || [];

  for (const policy of policies) {
    const newPolicyId = await insertReturningId(ctx.knex, 't_decision_policies', {
      name: policy.name,
      description: policy.description,
      defaults: policy.defaults,
      required_fields: policy.required_fields,
      validation_rules: policy.validation_rules,
      quality_gates: policy.quality_gates,
      suggest_similar: policy.suggest_similar ?? 1,
      category: policy.category,
      ts: policy.ts || Math.floor(Date.now() / 1000),
      project_id: ctx.projectId
    });

    ctx.mappings.decision_policies.set(policy.id, newPolicyId);
  }

  ctx.stats.transaction_tables.decision_policies_created = policies.length;
}

/**
 * Import t_tag_index (v4.0+ table)
 * Note: source_id remapping depends on source_type (decision, constraint)
 */
async function importTagIndex(ctx: ImportContext): Promise<void> {
  const indices = ctx.jsonData.master_tables?.tag_index || [];

  for (const index of indices) {
    // Skip task-related entries (removed in v5.0)
    if (index.source_type === 'task') continue;

    // Remap source_id based on source_type
    let newSourceId: number | null = null;
    if (index.source_type === 'decision') {
      newSourceId = ctx.mappings.context_keys.get(index.source_id) ?? null;
    }
    // Skip if we couldn't remap the source_id (e.g., constraint)
    if (!newSourceId && index.source_type !== 'constraint') continue;

    await ctx.knex('t_tag_index').insert({
      tag: index.tag,
      source_type: index.source_type,
      source_id: newSourceId || index.source_id,  // Use original for constraints
      project_id: ctx.projectId,
      created_ts: index.created_ts || Math.floor(Date.now() / 1000)
    });
  }

  ctx.stats.transaction_tables.tag_index_created = indices.length;
}

/**
 * Import junction tables with remapped IDs
 */
async function importJunctionTables(ctx: ImportContext): Promise<void> {
  console.error('  Importing junction tables...');

  await importDecisionTags(ctx);
  await importDecisionScopes(ctx);
  await importConstraintTags(ctx);
  // Note: task-related junction tables removed in v5.0

  console.error(`  ✓ Junction tables imported`);
}

/**
 * Import t_decision_tags with remapped IDs
 */
async function importDecisionTags(ctx: ImportContext): Promise<void> {
  const tags = ctx.jsonData.transaction_tables.decision_tags || [];

  for (const tag of tags) {
    const newKeyId = ctx.mappings.context_keys.get(tag.decision_key_id);
    const newTagId = ctx.mappings.tags.get(tag.tag_id);
    if (!newKeyId || !newTagId) continue;

    await ctx.knex('t_decision_tags').insert({
      decision_key_id: newKeyId,
      tag_id: newTagId,
      project_id: ctx.projectId
    });
  }

  ctx.stats.junction_tables.decision_tags_created = tags.length;
}

/**
 * Import t_decision_scopes with remapped IDs
 */
async function importDecisionScopes(ctx: ImportContext): Promise<void> {
  const scopes = ctx.jsonData.transaction_tables.decision_scopes || [];

  for (const scope of scopes) {
    const newKeyId = ctx.mappings.context_keys.get(scope.decision_key_id);
    const newScopeId = ctx.mappings.scopes.get(scope.scope_id);
    if (!newKeyId || !newScopeId) continue;

    await ctx.knex('t_decision_scopes').insert({
      decision_key_id: newKeyId,
      scope_id: newScopeId,
      project_id: ctx.projectId
    });
  }

  ctx.stats.junction_tables.decision_scopes_created = scopes.length;
}

/**
 * Import t_constraint_tags with remapped IDs
 */
async function importConstraintTags(ctx: ImportContext): Promise<void> {
  const tags = ctx.jsonData.transaction_tables.constraint_tags || [];

  for (const tag of tags) {
    const newTagId = ctx.mappings.tags.get(tag.tag_id);
    if (!newTagId) continue;

    // Note: constraint_id is not remapped as constraints are imported sequentially
    // and the IDs may not match. This is a limitation of the current implementation.
    // For now, we skip importing constraint tags.
  }

  ctx.stats.junction_tables.constraint_tags_created = 0;
}

/**
 * Initialize empty statistics
 */
function initializeStats(): ImportStats {
  return {
    project_created: false,
    master_tables: {
      // Note: agents_created removed in v4.0
      // Note: files_created, files_reused removed in v5.0
      context_keys_created: 0,
      tags_created: 0,
      tags_reused: 0,
      scopes_created: 0,
      scopes_reused: 0
    },
    transaction_tables: {
      decisions_created: 0,
      decisions_numeric_created: 0,
      decision_history_created: 0,
      decision_context_created: 0,
      constraints_created: 0,
      // Note: activity_log_created removed in v4.0
      // Note: file_changes_created, tasks_created, task_details_created removed in v5.0
      decision_policies_created: 0,  // v4.0+ table
      tag_index_created: 0  // v4.0+ table
    },
    junction_tables: {
      decision_tags_created: 0,
      decision_scopes_created: 0,
      constraint_tags_created: 0
      // Note: task_tags_created, task_file_links_created, task_decision_links_created, task_dependencies_created removed in v5.0
    }
  };
}
