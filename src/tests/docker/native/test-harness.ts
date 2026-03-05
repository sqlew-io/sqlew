/**
 * Native RDBMS Integration Test Harness
 *
 * Parameterized testing utilities for running test suites across
 * MySQL, MariaDB, and PostgreSQL via fresh Knex migrations.
 */

import { describe, before, after } from 'node:test';
import assert from 'node:assert';
import type { Knex } from 'knex';
import { initDatabase, teardownDatabase } from './db-init.js';
import { type DatabaseType } from '../../database/testing-config.js';

/**
 * Run the same test suite on MySQL, MariaDB, and PostgreSQL
 *
 * This is the KEY function that enables DRY testing - write tests once,
 * run on all databases automatically.
 *
 * @param suiteName - Test suite name (e.g., "Decision Operations")
 * @param defineTests - Function that defines tests using getDb() closure
 *
 * @example
 * ```typescript
 * runTestsOnAllDatabases('Decision Operations', (getDb, dbType) => {
 *   it('should set decision', async () => {
 *     const db = getDb();
 *     const result = await setDecision(db, { ... });
 *     assert.ok(result.id);
 *   });
 * });
 * ```
 */
export function runTestsOnAllDatabases(
  suiteName: string,
  defineTests: (getDb: () => Knex, dbType: DatabaseType) => void
): void {
  const databases: DatabaseType[] = ['mysql', 'mariadb', 'postgresql'];

  for (const dbType of databases) {
    describe(`${suiteName} - ${dbType}`, () => {
      let db: Knex;

      before(async () => {
        console.log(`  🔧 Initializing ${dbType} database...`);
        db = await initDatabase(dbType);
        await seedTestData(db);
        console.log(`  ✅ ${dbType} ready`);
      });

      after(async () => {
        console.log(`  🧹 Cleaning up ${dbType}...`);
        await teardownDatabase(db);
        console.log(`  ✅ ${dbType} cleanup complete`);
      });

      defineTests(() => db, dbType);
    });
  }
}

/**
 * Seed minimal test data for operations testing
 *
 * Creates baseline master data required for decision/constraint/task operations:
 * - 9 layers (presentation, business, data, infrastructure, cross-cutting,
 *             documentation, planning, coordination, review)
 * - 5 tags (test, api, performance, security, architecture)
 * - 3 scopes (global, module, component)
 *
 * @param db - Knex database connection
 */
export async function seedTestData(db: Knex): Promise<void> {
  const layerCount = await db('m_layers').count('* as count').first();
  if (!layerCount || layerCount.count === 0) {
    await db('m_layers').insert([
      { name: 'presentation' },
      { name: 'business' },
      { name: 'data' },
      { name: 'infrastructure' },
      { name: 'cross-cutting' },
      { name: 'documentation' },
      { name: 'planning' },
      { name: 'coordination' },
      { name: 'review' },
    ]);
  }

  const tags = ['test', 'api', 'performance', 'security', 'architecture'];
  for (const tag of tags) {
    const exists = await db('m_tags').where({ name: tag, project_id: 1 }).first();
    if (!exists) {
      await db('m_tags').insert({ name: tag, project_id: 1 });
    }
  }

  const scopes = ['global', 'module', 'component'];
  for (const scope of scopes) {
    const exists = await db('m_scopes').where({ name: scope, project_id: 1 }).first();
    if (!exists) {
      await db('m_scopes').insert({ name: scope, project_id: 1 });
    }
  }

  // Note: Task statuses (v4_task_statuses) removed in v5.0
}

/**
 * Clean up test data (keep schema intact)
 *
 * Deletes all transaction data while preserving master tables.
 * Schema remains for fast test execution (no migration re-run).
 *
 * @param db - Knex database connection
 */
export async function cleanupTestData(db: Knex): Promise<void> {
  await db('t_decision_tags').where('project_id', 1).del();
  await db('t_decision_scopes').where('project_id', 1).del();
  // t_decision_context added in v3.7.0
  await db('t_decision_context').where('project_id', 1).del();
  await db('t_decisions').where('project_id', 1).del();
  await db('t_decisions_numeric').where('project_id', 1).del();
  // m_context_keys has no project_id column
  await db('m_context_keys').del();

  await db('t_constraints').where('project_id', 1).del();

  // Note: Task and file tables removed in v5.0

  // polymorphic design: source_type + source_id + tag
  await db('t_tag_index').where('project_id', 1).del();
}

/**
 * Assert that a decision exists with expected key and value
 *
 * @param db - Knex database connection
 * @param key - Decision key to check
 * @param expectedValue - Expected decision value
 */
export async function assertDecisionExists(
  db: Knex,
  key: string,
  expectedValue: string
): Promise<void> {
  const contextKey = await db('m_context_keys')
    .where({ key_name: key })
    .first();

  assert.ok(contextKey, `Decision key "${key}" should exist`);

  const decision = await db('t_decisions')
    .where({ key_id: contextKey.id, project_id: 1 })
    .first();

  assert.ok(decision, `Decision for key "${key}" should exist`);
  assert.strictEqual(decision.value, expectedValue, `Decision value should match`);
}

/**
 * Assert that a constraint is active
 *
 * @param db - Knex database connection
 * @param rule - Constraint rule to check
 */
export async function assertConstraintActive(db: Knex, rule: string): Promise<void> {
  const constraint = await db('t_constraints')
    .where({ constraint_text: rule, active: 1, project_id: 1 })
    .first();

  assert.ok(constraint, `Constraint "${rule}" should be active`);
}

// Note: assertTaskStatus() removed in v5.0 (task system deprecated)

/**
 * Assert that a decision has specific tags
 *
 * @param db - Knex database connection
 * @param key - Decision key
 * @param expectedTags - Array of expected tag names
 */
export async function assertDecisionHasTags(
  db: Knex,
  key: string,
  expectedTags: string[]
): Promise<void> {
  const contextKey = await db('m_context_keys')
    .where({ key_name: key })
    .first();

  assert.ok(contextKey, `Decision key "${key}" should exist`);

  const tags = await db('t_decision_tags')
    .join('m_tags', 't_decision_tags.tag_id', 'm_tags.id')
    .where({ 't_decision_tags.decision_key_id': contextKey.id, 't_decision_tags.project_id': 1 })
    .pluck('m_tags.name');

  assert.strictEqual(tags.length, expectedTags.length, `Should have ${expectedTags.length} tags`);

  for (const expectedTag of expectedTags) {
    assert.ok(tags.includes(expectedTag), `Should have tag "${expectedTag}"`);
  }
}

/**
 * Assert that tag index is populated for a decision
 *
 * @param db - Knex database connection
 * @param key - Decision key
 * @param expectedTags - Array of expected tag names in index
 */
export async function assertTagIndexPopulated(
  db: Knex,
  key: string,
  expectedTags: string[]
): Promise<void> {
  const contextKey = await db('m_context_keys')
    .where({ key_name: key })
    .first();

  assert.ok(contextKey, `Decision key "${key}" should exist`);

  const indexEntries = await db('t_tag_index')
    .where({ source_type: 'decision', source_id: contextKey.id, project_id: 1 })
    .pluck('tag');

  assert.strictEqual(indexEntries.length, expectedTags.length, `Tag index should have ${expectedTags.length} entries`);

  for (const expectedTag of expectedTags) {
    assert.ok(indexEntries.includes(expectedTag), `Tag index should contain "${expectedTag}"`);
  }
}

/**
 * Get tag ID by name (creates if not exists)
 *
 * @param db - Knex database connection
 * @param tagName - Tag name
 * @returns Tag ID
 */
export async function getTagId(db: Knex, tagName: string): Promise<number> {
  let tag = await db('m_tags').where({ name: tagName, project_id: 1 }).first();

  if (!tag) {
    await db('m_tags').insert({ name: tagName, project_id: 1 });
    tag = await db('m_tags').where({ name: tagName, project_id: 1 }).first();
  }

  return tag.id;
}

/**
 * Get layer ID by name
 *
 * @param db - Knex database connection
 * @param layerName - Layer name
 * @returns Layer ID
 */
export async function getLayerId(db: Knex, layerName: string): Promise<number> {
  const layer = await db('m_layers').where({ name: layerName }).first();
  assert.ok(layer, `Layer "${layerName}" should exist`);
  return layer.id;
}

/**
 * Get scope ID by name (creates if not exists)
 *
 * @param db - Knex database connection
 * @param scopeName - Scope name
 * @returns Scope ID
 */
export async function getScopeId(db: Knex, scopeName: string): Promise<number> {
  let scope = await db('m_scopes').where({ name: scopeName, project_id: 1 }).first();

  if (!scope) {
    await db('m_scopes').insert({ name: scopeName, project_id: 1 });
    scope = await db('m_scopes').where({ name: scopeName, project_id: 1 }).first();
  }

  return scope.id;
}

/**
 * Source databases for cross-database migration testing
 * Includes SQLite (local) + Docker databases (MySQL, MariaDB, PostgreSQL)
 */
export type CrossDbSourceType = 'sqlite' | DatabaseType;

/**
 * Seed rich test data covering all v4 tables for migration testing
 *
 * Creates comprehensive test data including:
 * - Master tables: layers, tags, scopes
 * - Decisions with tags
 * - Constraints
 *
 * Note: Task and file tables removed in v5.0 (deprecated)
 *
 * @param db - Knex database connection
 * @param projectId - Project ID to use (default: 1)
 */
export async function seedRichTestData(db: Knex, projectId: number = 1): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  const decisionKeys = ['migration-test-decision-1', 'migration-test-decision-2', 'migration-test-decision-3'];
  for (let i = 0; i < decisionKeys.length; i++) {
    const keyName = decisionKeys[i];
    await db('m_context_keys').insert({ key_name: keyName });
    const keyRecord = await db('m_context_keys').where({ key_name: keyName }).first();

    const layerId = (i % 3) + 1; // Rotate through layers 1, 2, 3
    await db('t_decisions').insert({
      key_id: keyRecord.id,
      project_id: projectId,
      value: `Test decision value ${i + 1}`,
      version: '1.0.0',
      ts: now - (i * 100),
      layer_id: layerId,
      status: 1, // Status.ACTIVE = 1
    });

    const tagIds = await db('m_tags').where({ project_id: projectId }).limit(2).pluck('id');
    for (const tagId of tagIds) {
      await db('t_decision_tags').insert({
        decision_key_id: keyRecord.id,
        project_id: projectId,
        tag_id: tagId,
      }).catch(() => {}); // Ignore duplicates
    }
  }

  const constraints = [
    { text: 'Migration test constraint 1', category: 'architecture', priority: 3 },
    { text: 'Migration test constraint 2', category: 'performance', priority: 2 },
  ];
  for (const c of constraints) {
    const categoryRecord = await db('m_constraint_categories').where({ name: c.category }).first();
    await db('t_constraints').insert({
      constraint_text: c.text,
      project_id: projectId,
      category_id: categoryRecord?.id || 1,
      priority: c.priority,
      layer_id: 1,
      active: 1,
      ts: now,
    });
  }

  // Note: Task and file table seeding removed in v5.0 (deprecated)
}

/**
 * Verify sqlew access by checking row counts and basic CRUD operations
 *
 * @param db - Knex database connection to verify
 * @param expectedCounts - Expected row counts per table
 * @returns Verification result with details
 */
export async function verifySqlewAccess(
  db: Knex,
  expectedCounts?: Record<string, number>
): Promise<{
  success: boolean;
  tables: Record<string, { count: number; expected?: number; match: boolean }>;
  errors: string[];
}> {
  const errors: string[] = [];
  const tables: Record<string, { count: number; expected?: number; match: boolean }> = {};

  const tablesToCheck = [
    'm_projects',
    'm_layers',
    'm_tags',
    'm_context_keys',
    't_decisions',
    't_decision_tags',
    't_constraints',
  ];

  for (const table of tablesToCheck) {
    try {
      const result = await db(table).count('* as count').first();
      const count = Number(result?.count || 0);
      const expected = expectedCounts?.[table];
      const match = expected === undefined || count === expected;

      tables[table] = { count, expected, match };

      if (!match) {
        errors.push(`${table}: expected ${expected}, got ${count}`);
      }
    } catch (err) {
      errors.push(`${table}: ${(err as Error).message}`);
      tables[table] = { count: -1, match: false };
    }
  }

  try {
    const testKey = `migration-verify-${Date.now()}`;
    await db('m_context_keys').insert({ key_name: testKey });
    const inserted = await db('m_context_keys').where({ key_name: testKey }).first();
    if (!inserted) {
      errors.push('CRUD test failed: Could not read inserted context key');
    }
    await db('m_context_keys').where({ key_name: testKey }).del();
  } catch (err) {
    errors.push(`CRUD test failed: ${(err as Error).message}`);
  }

  return {
    success: errors.length === 0,
    tables,
    errors,
  };
}

/**
 * Get row counts for all v4 tables
 *
 * @param db - Knex database connection
 * @returns Record of table names to row counts
 */
export async function getTableCounts(db: Knex): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const tables = [
    'm_projects',
    'm_layers',
    'm_tags',
    'm_scopes',
    'm_context_keys',
    't_decisions',
    't_decision_tags',
    't_decision_scopes',
    't_constraints',
  ];

  for (const table of tables) {
    try {
      const result = await db(table).count('* as count').first();
      counts[table] = Number(result?.count || 0);
    } catch {
      counts[table] = -1; // Table doesn't exist or error
    }
  }

  return counts;
}

