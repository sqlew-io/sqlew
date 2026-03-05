/**
 * JSON Export/Import Integration Tests
 * Tests round-trip data integrity for v5.0 schema
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { initializeDatabase, closeDatabase } from '../../database.js';
import type { DatabaseAdapter } from '../../adapters/types.js';
import { ProjectContext } from '../../utils/project-context.js';
import { generateJsonExport } from '../../utils/exporter/export.js';
import { importJsonData } from '../../utils/importer/import.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

let testDb: DatabaseAdapter;
let tempDir: string;
let tempDbPath: string;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlew-json-test-'));
  tempDbPath = path.join(tempDir, 'test.db');
  testDb = await initializeDatabase({ connection: { filename: tempDbPath } });
});

afterEach(async () => {
  ProjectContext.reset();
  await closeDatabase();
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('JSON Export v5.0 Schema', () => {
  it('should export project with decisions', async () => {
    const knex = testDb.getKnex();

    // Setup project
    const projectContext = ProjectContext.getInstance();
    await projectContext.ensureProject(knex, 'test-project', 'config');

    // Create a decision
    const [keyId] = await knex('m_context_keys').insert({ key_name: 'test/key' });
    await knex('t_decisions').insert({
      key_id: keyId,
      project_id: projectContext.getProjectId(),
      value: 'test-value',
      layer_id: 1,
      version: '1.0.0',
      status: 1,
      ts: Math.floor(Date.now() / 1000)
    });

    // Export
    const jsonStr = await generateJsonExport(knex, { projectName: 'test-project' });
    const json = JSON.parse(jsonStr);

    // Verify structure
    assert.strictEqual(json.metadata.export_mode, 'single_project');
    assert.strictEqual(json.project.name, 'test-project');
    assert.strictEqual(json.transaction_tables.decisions.length, 1);
    assert.strictEqual(json.transaction_tables.decisions[0].value, 'test-value');

    // Verify v5.0 schema - no task/file fields
    assert.strictEqual(json.master_tables.files, undefined);
    assert.strictEqual(json.master_tables.task_statuses, undefined);
    assert.strictEqual(json.transaction_tables.tasks, undefined);
    assert.strictEqual(json.transaction_tables.file_changes, undefined);
  });

  it('should export project with constraints', async () => {
    const knex = testDb.getKnex();

    // Setup project
    const projectContext = ProjectContext.getInstance();
    await projectContext.ensureProject(knex, 'constraint-project', 'config');

    // Create a constraint
    await knex('t_constraints').insert({
      category_id: 1,
      project_id: projectContext.getProjectId(),
      layer_id: 1,
      constraint_text: 'Never use eval()',
      priority: 1,
      active: 1,
      ts: Math.floor(Date.now() / 1000)
    });

    // Export
    const jsonStr = await generateJsonExport(knex, { projectName: 'constraint-project' });
    const json = JSON.parse(jsonStr);

    // Verify constraints
    assert.strictEqual(json.transaction_tables.constraints.length, 1);
    assert.strictEqual(json.transaction_tables.constraints[0].constraint_text, 'Never use eval()');
  });

  it('should export all projects when no projectName specified', async () => {
    const knex = testDb.getKnex();

    // Setup two additional projects (default already exists)
    const projectContext1 = ProjectContext.getInstance();
    await projectContext1.ensureProject(knex, 'project-1', 'config');

    ProjectContext.reset();
    const projectContext2 = ProjectContext.getInstance();
    await projectContext2.ensureProject(knex, 'project-2', 'config');

    // Export all
    const jsonStr = await generateJsonExport(knex, {});
    const json = JSON.parse(jsonStr);

    // Verify (default + 2 created = 3 projects)
    assert.strictEqual(json.metadata.export_mode, 'all_projects');
    assert.ok(Array.isArray(json.projects));
    assert.ok(json.projects.length >= 2, `Expected at least 2 projects, got ${json.projects.length}`);
  });
});

describe('JSON Import v5.0 Schema', () => {
  it('should import project with decisions', async () => {
    const knex = testDb.getKnex();

    // Create minimal export JSON
    const exportJson = {
      metadata: {
        sqlew_version: '5.0.0',
        schema_version: '5.0',
        exported_at: new Date().toISOString(),
        export_mode: 'single_project',
        database_type: 'sqlite'
      },
      version: '5.0.0',
      exported_at: new Date().toISOString(),
      export_mode: 'single_project',
      database_type: 'sqlite',
      project: {
        name: 'imported-project',
        display_name: 'Imported Project',
        detection_source: 'import',
        project_root_path: null,
        created_ts: Math.floor(Date.now() / 1000),
        last_active_ts: Math.floor(Date.now() / 1000),
        metadata: null
      },
      master_tables: {
        context_keys: [{ id: 1, key: 'imported/key' }],
        tags: [],
        scopes: [],
        constraint_categories: [],
        layers: [{ id: 1, name: 'infrastructure' }],
        decision_policies: [],
        tag_index: []
      },
      transaction_tables: {
        decisions: [{
          key_id: 1,
          project_id: 1,
          value: 'imported-value',
          layer_id: 1,
          version: '1.0.0',
          status: 1,
          ts: Math.floor(Date.now() / 1000)
        }],
        decisions_numeric: [],
        decision_history: [],
        decision_tags: [],
        decision_scopes: [],
        decision_context: [],
        constraints: [],
        constraint_tags: []
      }
    };

    // Import
    const result = await importJsonData(knex, exportJson, {});

    // Verify
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.project_name, 'imported-project');

    // Check data in DB
    const decisions = await knex('t_decisions')
      .join('m_context_keys', 't_decisions.key_id', 'm_context_keys.id')
      .select('m_context_keys.key_name', 't_decisions.value');

    assert.strictEqual(decisions.length, 1);
    assert.strictEqual(decisions[0].key_name, 'imported/key');
    assert.strictEqual(decisions[0].value, 'imported-value');
  });

  it('should skip import if project already exists', async () => {
    const knex = testDb.getKnex();

    // Create existing project
    const projectContext = ProjectContext.getInstance();
    await projectContext.ensureProject(knex, 'existing-project', 'config');

    // Try to import with same name
    const exportJson = {
      metadata: {
        sqlew_version: '5.0.0',
        schema_version: '5.0',
        exported_at: new Date().toISOString(),
        export_mode: 'single_project',
        database_type: 'sqlite'
      },
      project: {
        name: 'existing-project',
        display_name: 'Existing Project',
        detection_source: 'import',
        project_root_path: null,
        created_ts: Math.floor(Date.now() / 1000),
        last_active_ts: Math.floor(Date.now() / 1000),
        metadata: null
      },
      master_tables: {
        context_keys: [],
        tags: [],
        scopes: [],
        constraint_categories: [],
        layers: [],
        decision_policies: [],
        tag_index: []
      },
      transaction_tables: {
        decisions: [],
        decisions_numeric: [],
        decision_history: [],
        decision_tags: [],
        decision_scopes: [],
        decision_context: [],
        constraints: [],
        constraint_tags: []
      }
    };

    const result = await importJsonData(knex, exportJson, { skipIfExists: true });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(result.skip_reason, 'project_exists');
  });
});

describe('JSON Export/Import Round-Trip', () => {
  it('should preserve decision data through export/import cycle', async () => {
    const knex = testDb.getKnex();

    // Setup source project
    const projectContext = ProjectContext.getInstance();
    await projectContext.ensureProject(knex, 'source-project', 'config');

    // Create decision
    const [keyId] = await knex('m_context_keys').insert({ key_name: 'architecture/database' });
    await knex('t_decisions').insert({
      key_id: keyId,
      project_id: projectContext.getProjectId(),
      value: 'PostgreSQL 15',
      layer_id: 4, // data layer
      version: '2.0.0',
      status: 1,
      ts: Math.floor(Date.now() / 1000)
    });

    // Export
    const jsonStr = await generateJsonExport(knex, { projectName: 'source-project' });
    const exportedJson = JSON.parse(jsonStr);

    // Import as new project
    const importResult = await importJsonData(knex, exportedJson, {
      targetProjectName: 'cloned-project'
    });

    assert.strictEqual(importResult.success, true);

    // Verify imported data
    const clonedProject = await knex('m_projects')
      .where({ name: 'cloned-project' })
      .first();
    assert.ok(clonedProject);

    const clonedDecisions = await knex('t_decisions')
      .where({ project_id: clonedProject.id })
      .join('m_context_keys', 't_decisions.key_id', 'm_context_keys.id')
      .select('m_context_keys.key_name', 't_decisions.value', 't_decisions.version');

    assert.strictEqual(clonedDecisions.length, 1);
    assert.strictEqual(clonedDecisions[0].key_name, 'architecture/database');
    assert.strictEqual(clonedDecisions[0].value, 'PostgreSQL 15');
    assert.strictEqual(clonedDecisions[0].version, '2.0.0');
  });

  it('should preserve constraint data through export/import cycle', async () => {
    const knex = testDb.getKnex();

    // Setup source project
    const projectContext = ProjectContext.getInstance();
    await projectContext.ensureProject(knex, 'constraint-source', 'config');

    // Create constraint
    await knex('t_constraints').insert({
      category_id: 1,
      project_id: projectContext.getProjectId(),
      layer_id: 2, // business layer
      constraint_text: 'All API endpoints must validate input',
      priority: 1, // critical
      active: 1,
      ts: Math.floor(Date.now() / 1000)
    });

    // Export
    const jsonStr = await generateJsonExport(knex, { projectName: 'constraint-source' });
    const exportedJson = JSON.parse(jsonStr);

    // Import as new project
    const importResult = await importJsonData(knex, exportedJson, {
      targetProjectName: 'constraint-cloned'
    });

    assert.strictEqual(importResult.success, true);

    // Verify imported constraint
    const clonedProject = await knex('m_projects')
      .where({ name: 'constraint-cloned' })
      .first();

    const clonedConstraints = await knex('t_constraints')
      .where({ project_id: clonedProject.id });

    assert.strictEqual(clonedConstraints.length, 1);
    assert.strictEqual(clonedConstraints[0].constraint_text, 'All API endpoints must validate input');
    assert.strictEqual(clonedConstraints[0].priority, 1);
  });
});

describe('Backward Compatibility (v3.7 JSON)', () => {
  it('should import v3.7 JSON format with numeric schema_version', async () => {
    const knex = testDb.getKnex();

    // Simulated v3.7 export JSON
    const v3ExportJson = {
      metadata: {
        sqlew_version: '3.7.3',
        schema_version: 3,  // v3.7 used NUMBER type
        exported_at: new Date().toISOString(),
        export_mode: 'single_project',
        database_type: 'sqlite'
      },
      version: '3.7.3',
      exported_at: new Date().toISOString(),
      export_mode: 'single_project',
      database_type: 'sqlite',
      project: {
        name: 'v3-legacy-project',
        display_name: 'V3 Legacy Project',
        detection_source: 'import',
        project_root_path: null,
        created_ts: Math.floor(Date.now() / 1000),
        last_active_ts: Math.floor(Date.now() / 1000),
        metadata: null
      },
      master_tables: {
        // v3.7 specific fields
        agents: [{ id: 1, name: 'default', last_active_ts: 0 }],
        files: [{ id: 1, project_id: 1, path: '/old/file.ts' }],
        task_statuses: [{ id: 1, name: 'pending' }],
        // Common fields
        context_keys: [{ id: 1, key: 'v3/decision' }],
        tags: [],
        scopes: [],
        constraint_categories: [],
        layers: [{ id: 1, name: 'infrastructure' }]
        // Note: decision_policies and tag_index didn't exist in v3.7
      },
      transaction_tables: {
        decisions: [{
          key_id: 1,
          project_id: 1,
          value: 'v3-value',
          layer_id: 1,
          version: '1.0.0',
          status: 1,
          ts: Math.floor(Date.now() / 1000),
          agent_id: 1  // v3.7 had agent_id
        }],
        decisions_numeric: [],
        decision_history: [],
        decision_tags: [],
        decision_scopes: [],
        decision_context: [],
        constraints: [],
        constraint_tags: [],
        // v3.7 specific fields
        activity_log: [{ id: 1, message: 'test' }],
        file_changes: [],
        tasks: [],
        task_details: [],
        task_tags: [],
        task_file_links: [],
        task_decision_links: [],
        task_dependencies: []
      }
    };

    // Import should succeed
    const result = await importJsonData(knex, v3ExportJson, {});

    assert.strictEqual(result.success, true, 'v3.7 import should succeed');
    assert.strictEqual(result.project_name, 'v3-legacy-project');

    // Decision should be imported (agent_id ignored in v4.0+)
    const project = await knex('m_projects')
      .where({ name: 'v3-legacy-project' })
      .first();
    const decisions = await knex('t_decisions')
      .where({ project_id: project.id });

    assert.strictEqual(decisions.length, 1);
    assert.strictEqual(decisions[0].value, 'v3-value');
  });
});

describe('Backward Compatibility (v4.x JSON)', () => {
  it('should import v4.x JSON format (ignoring task/file data)', async () => {
    const knex = testDb.getKnex();

    // Simulated v4.x export JSON with task/file fields
    const v4ExportJson = {
      metadata: {
        sqlew_version: '4.3.1',
        schema_version: '4.3',
        exported_at: new Date().toISOString(),
        export_mode: 'single_project',
        database_type: 'sqlite'
      },
      version: '4.3.1',
      exported_at: new Date().toISOString(),
      export_mode: 'single_project',
      database_type: 'sqlite',
      project: {
        name: 'v4-legacy-project',
        display_name: 'V4 Legacy Project',
        detection_source: 'import',
        project_root_path: null,
        created_ts: Math.floor(Date.now() / 1000),
        last_active_ts: Math.floor(Date.now() / 1000),
        metadata: null
      },
      master_tables: {
        // v4.x fields that should be ignored in v5.0
        files: [{ id: 1, project_id: 1, path: '/src/main.ts' }],
        task_statuses: [{ id: 1, name: 'pending' }],
        // v5.0 compatible fields
        context_keys: [{ id: 1, key: 'legacy/decision' }],
        tags: [],
        scopes: [],
        constraint_categories: [],
        layers: [{ id: 1, name: 'infrastructure' }],
        decision_policies: [],
        tag_index: []
      },
      transaction_tables: {
        decisions: [{
          key_id: 1,
          project_id: 1,
          value: 'legacy-value',
          layer_id: 1,
          version: '1.0.0',
          status: 1,
          ts: Math.floor(Date.now() / 1000)
        }],
        decisions_numeric: [],
        decision_history: [],
        decision_tags: [],
        decision_scopes: [],
        decision_context: [],
        constraints: [],
        constraint_tags: [],
        // v4.x fields that should be ignored in v5.0
        file_changes: [{ id: 1, file_id: 1, project_id: 1 }],
        tasks: [{ id: 1, title: 'Legacy Task', project_id: 1 }],
        task_details: [],
        task_tags: [],
        task_file_links: [],
        task_decision_links: [],
        task_dependencies: []
      }
    };

    // Import should succeed
    const result = await importJsonData(knex, v4ExportJson, {});

    assert.strictEqual(result.success, true, 'Import should succeed');
    assert.strictEqual(result.project_name, 'v4-legacy-project');

    // Decision data should be imported
    const project = await knex('m_projects')
      .where({ name: 'v4-legacy-project' })
      .first();
    assert.ok(project, 'Project should be created');

    const decisions = await knex('t_decisions')
      .where({ project_id: project.id });
    assert.strictEqual(decisions.length, 1, 'Decision should be imported');
    assert.strictEqual(decisions[0].value, 'legacy-value');

    // Task/file data is silently ignored (v5.0 doesn't support them)
    // This is expected behavior - no error, just no import
  });
});

describe('Error Handling', () => {
  it('should fail gracefully when project not found for export', async () => {
    const knex = testDb.getKnex();

    try {
      await generateJsonExport(knex, { projectName: 'non-existent-project' });
      assert.fail('Should have thrown error');
    } catch (error) {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Project not found/);
    }
  });

  it('should fail gracefully when no project name in import JSON', async () => {
    const knex = testDb.getKnex();

    const invalidJson = {
      metadata: {},
      master_tables: {},
      transaction_tables: {}
    };

    const result = await importJsonData(knex, invalidJson, {});

    assert.strictEqual(result.success, false);
    assert.match(result.error!, /No project name/);
  });
});
