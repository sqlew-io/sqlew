/**
 * Constraint Operations - Native RDBMS Integration Tests
 *
 * Tests constraint CRUD, FK enforcement, tag associations, and filtering
 * via direct Knex operations on MySQL, MariaDB, and PostgreSQL.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { Knex } from 'knex';
import { runTestsOnAllDatabases, assertConstraintActive } from './test-harness.js';

runTestsOnAllDatabases('Constraint Operations', (getDb, dbType) => {
  let projectId: number;
  let businessLayerId: number;
  let dataLayerId: number;
  let presentationLayerId: number;
  let crossCuttingLayerId: number;
  let categoryArchitectureId: number;
  let categorySecurityId: number;
  let categoryTestingId: number;
  let categoryPerformanceId: number;
  let categoryStyleId: number;
  let categoryCodeStyleId: number;
  let categoryObsoleteId: number;
  let categoryTestId: number;
  let tagTestId: number;
  let tagApiId: number;
  let tagPerformanceId: number;
  let tagSecurityId: number;

  // PostgreSQL doesn't return insert ID like MySQL/MariaDB, so we query after insert
  async function insertConstraint(db: Knex, data: Record<string, any>): Promise<number> {
    const constraintText = data.constraint_text;
    await db('t_constraints').insert(data);
    const inserted = await db('t_constraints')
      .where({ constraint_text: constraintText, project_id: data.project_id })
      .orderBy('id', 'desc')
      .first();
    return inserted.id;
  }

  it('should get project ID and master data', async () => {
    const db = getDb();

    const project = await db('m_projects').where({ id: 1 }).first();
    assert.ok(project, 'Project should exist');
    projectId = project.id;

    const businessLayer = await db('m_layers').where({ name: 'business' }).first();
    assert.ok(businessLayer, 'Business layer should exist');
    businessLayerId = businessLayer.id;

    const dataLayer = await db('m_layers').where({ name: 'data' }).first();
    assert.ok(dataLayer, 'Data layer should exist');
    dataLayerId = dataLayer.id;

    const presentationLayer = await db('m_layers').where({ name: 'presentation' }).first();
    assert.ok(presentationLayer, 'Presentation layer should exist');
    presentationLayerId = presentationLayer.id;

    const crossCuttingLayer = await db('m_layers').where({ name: 'cross-cutting' }).first();
    assert.ok(crossCuttingLayer, 'Cross-cutting layer should exist');
    crossCuttingLayerId = crossCuttingLayer.id;

    // Note: Use query-after-insert pattern for cross-database compatibility
    // (PostgreSQL doesn't return insert ID like MySQL/MariaDB)
    const getOrCreateCategory = async (name: string): Promise<number> => {
      let category = await db('m_constraint_categories').where({ name }).first();
      if (!category) {
        await db('m_constraint_categories').insert({ name });
        category = await db('m_constraint_categories').where({ name }).first();
      }
      return category.id;
    };

    categoryArchitectureId = await getOrCreateCategory('architecture');
    categorySecurityId = await getOrCreateCategory('security');
    categoryTestingId = await getOrCreateCategory('testing');
    categoryPerformanceId = await getOrCreateCategory('performance');
    categoryStyleId = await getOrCreateCategory('style');
    categoryCodeStyleId = await getOrCreateCategory('code-style');
    categoryObsoleteId = await getOrCreateCategory('obsolete');
    categoryTestId = await getOrCreateCategory('critical');

    const testTag = await db('m_tags').where({ name: 'test', project_id: projectId }).first();
    assert.ok(testTag, 'Test tag should exist');
    tagTestId = testTag.id;

    const apiTag = await db('m_tags').where({ name: 'api', project_id: projectId }).first();
    assert.ok(apiTag, 'API tag should exist');
    tagApiId = apiTag.id;

    const performanceTag = await db('m_tags').where({ name: 'performance', project_id: projectId }).first();
    assert.ok(performanceTag, 'Performance tag should exist');
    tagPerformanceId = performanceTag.id;

    const securityTag = await db('m_tags').where({ name: 'security', project_id: projectId }).first();
    assert.ok(securityTag, 'Security tag should exist');
    tagSecurityId = securityTag.id;
  });

  describe('Basic constraint insertion', () => {
    it('should insert constraint with required fields', async () => {
      const db = getDb();

      const constraintText1 = 'All API endpoints must use async/await';
      const constraintId = await insertConstraint(db, {
        constraint_text: constraintText1,
        category_id: categoryCodeStyleId,
        priority: 3, // high
        layer_id: businessLayerId,
        project_id: projectId,
        active: 1,
        ts: Math.floor(Date.now() / 1000),
      });

      assert.ok(constraintId, 'Should return constraint ID');

      const constraint = await db('t_constraints')
        .where({ id: constraintId })
        .first();

      assert.strictEqual(constraint.constraint_text, 'All API endpoints must use async/await');
      assert.strictEqual(constraint.priority, 3);
      assert.strictEqual(constraint.active, 1);
    });

    it('should insert constraint with all fields', async () => {
      const db = getDb();

      const constraintTextDb = 'Database queries must use parameterized statements';
      const constraintId = await insertConstraint(db, {
        constraint_text: constraintTextDb,
        category_id: categorySecurityId,
        priority: 4, // critical
        layer_id: dataLayerId,
        project_id: projectId,
        active: 1,
        ts: Math.floor(Date.now() / 1000),
      });

      const constraint = await db('t_constraints')
        .where({ id: constraintId })
        .first();

      assert.strictEqual(constraint.constraint_text, 'Database queries must use parameterized statements');
      assert.strictEqual(constraint.priority, 4);
      assert.strictEqual(constraint.category_id, categorySecurityId);
    });

    it('should handle different priority levels', async () => {
      const db = getDb();

      const constraintTextLow = 'Low priority rule';
      const p1Id = await insertConstraint(db, {
        constraint_text: constraintTextLow,
        category_id: categoryStyleId,
        priority: 1,
        layer_id: presentationLayerId,
        project_id: projectId,
        active: 1,
        ts: Math.floor(Date.now() / 1000),
      });

      const constraintTextCritical = 'Critical security rule';
      const p4Id = await insertConstraint(db, {
        constraint_text: constraintTextCritical,
        category_id: categorySecurityId,
        priority: 4,
        layer_id: businessLayerId,
        project_id: projectId,
        active: 1,
        ts: Math.floor(Date.now() / 1000),
      });

      assert.ok(p1Id && p4Id, 'Both constraints should be created');

      const lowPriority = await db('t_constraints')
        .where({ id: p1Id })
        .first();

      const highPriority = await db('t_constraints')
        .where({ id: p4Id })
        .first();

      assert.strictEqual(lowPriority.priority, 1);
      assert.strictEqual(highPriority.priority, 4);
    });

    it('should have nullable reason column on t_constraints', async () => {
      const db = getDb();

      const hasReasonColumn = await db.schema.hasColumn('t_constraints', 'reason');
      assert.strictEqual(hasReasonColumn, true, 't_constraints should have reason column');

      const constraintTextNoReason = 'Constraint without reason';
      const constraintId = await insertConstraint(db, {
        constraint_text: constraintTextNoReason,
        category_id: categoryCodeStyleId,
        priority: 2,
        layer_id: businessLayerId,
        project_id: projectId,
        active: 1,
        ts: Math.floor(Date.now() / 1000),
      });

      const constraint = await db('t_constraints')
        .where({ id: constraintId })
        .first();

      assert.strictEqual(constraint.reason, null, 'reason should be NULL when not specified');
    });

    it('should store and retrieve reason text', async () => {
      const db = getDb();
      const reasonText = 'Prevents SQL injection via parameterized queries';

      const constraintTextWithReason = 'Must use parameterized SQL statements';
      const constraintId = await insertConstraint(db, {
        constraint_text: constraintTextWithReason,
        category_id: categorySecurityId,
        priority: 4,
        layer_id: dataLayerId,
        project_id: projectId,
        active: 1,
        ts: Math.floor(Date.now() / 1000),
        reason: reasonText,
      });

      const constraint = await db('t_constraints')
        .where({ id: constraintId })
        .first();

      assert.strictEqual(constraint.reason, reasonText);
    });
  });

  describe('Tag associations', () => {
    it('should associate constraint with tags', async () => {
      const db = getDb();

      const constraintTextUnitTests = 'All components must have unit tests';
      const constraintId = await insertConstraint(db, {
        constraint_text: constraintTextUnitTests,
        category_id: categoryTestingId,
        priority: 3,
        layer_id: crossCuttingLayerId,
        project_id: projectId,
        active: 1,
        ts: Math.floor(Date.now() / 1000),
      });

      await db('t_constraint_tags').insert([
        { constraint_id: constraintId, tag_id: tagTestId },
        { constraint_id: constraintId, tag_id: tagPerformanceId },
      ]);

      const tagAssociations = await db('t_constraint_tags')
        .where({ constraint_id: constraintId })
        .count('* as count')
        .first();

      assert.ok(tagAssociations, 'Tag associations query should return result');
      // Note: PostgreSQL returns count as BigInt (string), MySQL returns number
      assert.strictEqual(Number(tagAssociations.count), 2, 'Should have 2 tag associations');
    });
  });

  describe('Filtering constraints', () => {
    it('should filter constraints by layer', async () => {
      const db = getDb();

      // Note: v4 schema does not have constraint_text_hash column
      const constraintTextBusiness = 'Business layer rule';
      await db('t_constraints').insert({
        constraint_text: constraintTextBusiness,
        category_id: categoryArchitectureId,
        priority: 3,
        layer_id: businessLayerId,
        project_id: projectId,
        active: 1,
        ts: Math.floor(Date.now() / 1000),
      });

      const constraintTextData = 'Data layer rule';
      await db('t_constraints').insert({
        constraint_text: constraintTextData,
        category_id: categoryArchitectureId,
        priority: 3,
        layer_id: dataLayerId,
        project_id: projectId,
        active: 1,
        ts: Math.floor(Date.now() / 1000),
      });

      const businessConstraints = await db('t_constraints')
        .where({ layer_id: businessLayerId, active: 1, project_id: projectId })
        .select('*');

      const businessConstraint = businessConstraints.find(c => c.constraint_text === 'Business layer rule');
      assert.ok(businessConstraint, 'Should find business layer constraint');
    });

    it('should filter constraints by category', async () => {
      const db = getDb();

      const constraintTextSecurity = 'Security constraint';
      await db('t_constraints').insert({
        constraint_text: constraintTextSecurity,
        category_id: categorySecurityId,
        priority: 4,
        layer_id: businessLayerId,
        project_id: projectId,
        active: 1,
        ts: Math.floor(Date.now() / 1000),
      });

      const constraintTextPerformance = 'Performance constraint';
      await db('t_constraints').insert({
        constraint_text: constraintTextPerformance,
        category_id: categoryPerformanceId,
        priority: 3,
        layer_id: businessLayerId,
        project_id: projectId,
        active: 1,
        ts: Math.floor(Date.now() / 1000),
      });

      const securityConstraints = await db('t_constraints')
        .where({ category_id: categorySecurityId, active: 1, project_id: projectId })
        .select('*');

      const securityConstraint = securityConstraints.find(c => c.constraint_text === 'Security constraint');
      assert.ok(securityConstraint, 'Should find security constraint');
    });

    it('should filter constraints by priority', async () => {
      const db = getDb();

      const constraintTextHighPriority = 'High priority constraint';
      await db('t_constraints').insert({
        constraint_text: constraintTextHighPriority,
        category_id: categoryTestId,
        priority: 4,
        layer_id: businessLayerId,
        project_id: projectId,
        active: 1,
        ts: Math.floor(Date.now() / 1000),
      });

      const constraintTextLowPriority = 'Low priority constraint';
      await db('t_constraints').insert({
        constraint_text: constraintTextLowPriority,
        category_id: categoryStyleId,
        priority: 1,
        layer_id: presentationLayerId,
        project_id: projectId,
        active: 1,
        ts: Math.floor(Date.now() / 1000),
      });

      const highPriorityConstraints = await db('t_constraints')
        .where({ priority: 4, active: 1, project_id: projectId })
        .select('*');

      const highPriorityConstraint = highPriorityConstraints.find(c => c.constraint_text === 'High priority constraint');
      assert.ok(highPriorityConstraint, 'Should find high priority constraint');
    });

    it('should filter constraints by tags', async () => {
      const db = getDb();

      const constraintTextTagged = 'Tagged constraint 1';
      const constraintId = await insertConstraint(db, {
        constraint_text: constraintTextTagged,
        category_id: categoryTestingId,
        priority: 2,
        layer_id: businessLayerId,
        project_id: projectId,
        active: 1,
        ts: Math.floor(Date.now() / 1000),
      });

      await db('t_constraint_tags').insert([
        { constraint_id: constraintId, tag_id: tagApiId },
        { constraint_id: constraintId, tag_id: tagTestId },
      ]);

      const apiTaggedConstraints = await db('t_constraints')
        .join('t_constraint_tags', 't_constraints.id', 't_constraint_tags.constraint_id')
        .where({
          't_constraint_tags.tag_id': tagApiId,
          't_constraints.active': 1,
          't_constraints.project_id': projectId,
        })
        .select('t_constraints.*');

      const apiConstraint = apiTaggedConstraints.find(c => c.constraint_text === 'Tagged constraint 1');
      assert.ok(apiConstraint, 'Should find api-tagged constraint');
    });

    it('should exclude deactivated constraints', async () => {
      const db = getDb();

      const constraintTextDeactivated = 'Deactivated constraint';
      const constraintId = await insertConstraint(db, {
        constraint_text: constraintTextDeactivated,
        category_id: categoryObsoleteId,
        priority: 2,
        layer_id: businessLayerId,
        project_id: projectId,
        active: 1,
        ts: Math.floor(Date.now() / 1000),
      });

      await db('t_constraints')
        .where({ id: constraintId })
        .update({ active: 0 });

      const activeConstraints = await db('t_constraints')
        .where({ active: 1, project_id: projectId })
        .select('*');

      const deactivatedConstraint = activeConstraints.find(c => c.constraint_text === 'Deactivated constraint');
      assert.strictEqual(deactivatedConstraint, undefined, 'Should not include deactivated constraint');
    });
  });

  describe('Constraint deactivation', () => {
    it('should deactivate constraint by ID', async () => {
      const db = getDb();

      const constraintTextToDeactivate = 'Constraint to deactivate';
      const constraintId = await insertConstraint(db, {
        constraint_text: constraintTextToDeactivate,
        category_id: categoryTestingId,
        priority: 2,
        layer_id: businessLayerId,
        project_id: projectId,
        active: 1,
        ts: Math.floor(Date.now() / 1000),
      });

      const updateCount = await db('t_constraints')
        .where({ id: constraintId, project_id: projectId })
        .update({ active: 0 });

      assert.strictEqual(updateCount, 1, 'Should update 1 row');

      const constraint = await db('t_constraints')
        .where({ id: constraintId })
        .first();

      assert.strictEqual(constraint.active, 0, 'active should be 0');
    });

    it('should allow re-deactivating already deactivated constraint', async () => {
      const db = getDb();

      const constraintTextReDeactivate = 'Re-deactivate test';
      const constraintId = await insertConstraint(db, {
        constraint_text: constraintTextReDeactivate,
        category_id: categoryTestingId,
        priority: 2,
        layer_id: businessLayerId,
        project_id: projectId,
        active: 1,
        ts: Math.floor(Date.now() / 1000),
      });

      await db('t_constraints')
        .where({ id: constraintId })
        .update({ active: 0 });

      const updateCount = await db('t_constraints')
        .where({ id: constraintId })
        .update({ active: 0 });

      // Should succeed (no error thrown)
      assert.ok(updateCount >= 0, 'Should succeed on re-deactivation');
    });
  });

  describe('Database constraints', () => {
    it('should enforce foreign key constraint on category_id', async () => {
      const db = getDb();

      const constraintTextFkCategory = 'Test constraint';
      const insertPromise = db('t_constraints').insert({
        constraint_text: constraintTextFkCategory,
        category_id: 99999, // Non-existent category
        priority: 2,
        layer_id: businessLayerId,
        project_id: projectId,
        active: 1,
        ts: Math.floor(Date.now() / 1000),
      });

      await assert.rejects(
        insertPromise,
        (error: any) => {
          const msg = error.message.toLowerCase();
          return msg.includes('foreign key') ||
                 msg.includes('constraint') ||
                 msg.includes('violates') ||
                 msg.includes('cannot add');
        },
        'Should throw foreign key constraint error'
      );
    });

    // NOTE: v4 schema intentionally does NOT have UNIQUE constraint on (constraint_text, project_id)
    // In v3, uniqueness was enforced via constraint_text_hash column (SHA-256 hash of TEXT)
    // v4 relies on application-level duplicate detection via the suggest tool (check_duplicate action)
    // This test verifies that duplicate constraint texts ARE allowed at the database level
    it('should allow duplicate constraint_text in v4 schema (uniqueness via app layer)', async () => {
      const db = getDb();

      const constraintTextValue = `Duplicate allowed test ${Date.now()}`;

      // Insert first constraint
      await db('t_constraints').insert({
        constraint_text: constraintTextValue,
        category_id: categoryTestingId,
        priority: 3,
        layer_id: businessLayerId,
        project_id: projectId,
        active: 1,
        ts: Math.floor(Date.now() / 1000),
      });

      // Insert "duplicate" - should succeed in v4
      await db('t_constraints').insert({
        constraint_text: constraintTextValue, // Same constraint_text
        category_id: categoryTestingId,
        priority: 3,
        layer_id: businessLayerId,
        project_id: projectId, // Same project_id
        active: 1,
        ts: Math.floor(Date.now() / 1000),
      });

      const constraints = await db('t_constraints')
        .where({ constraint_text: constraintTextValue, project_id: projectId })
        .select('id');

      assert.strictEqual(constraints.length, 2, 'Should allow duplicate constraint_text in v4 schema');
    });
  });

  describe(`Cross-database compatibility - ${dbType}`, () => {
    it('should handle long rule text', async () => {
      const db = getDb();
      const longRule = 'A'.repeat(500) + ' - This is a very long constraint rule';

      const constraintId = await insertConstraint(db, {
        constraint_text: longRule,
        category_id: categoryTestingId,
        priority: 2,
        layer_id: businessLayerId,
        project_id: projectId,
        active: 1,
        ts: Math.floor(Date.now() / 1000),
      });

      assert.ok(constraintId, 'Should handle long rule text');

      const constraint = await db('t_constraints')
        .where({ id: constraintId })
        .first();

      assert.strictEqual(constraint.constraint_text, longRule);
    });

    it('should handle special characters in rules', async () => {
      const db = getDb();
      const specialRule = "Rule with 'quotes', \"double quotes\", and \\backslashes";

      const constraintId = await insertConstraint(db, {
        constraint_text: specialRule,
        category_id: categoryTestingId,
        priority: 2,
        layer_id: businessLayerId,
        project_id: projectId,
        active: 1,
        ts: Math.floor(Date.now() / 1000),
      });

      assert.ok(constraintId);

      const constraint = await db('t_constraints')
        .where({ id: constraintId })
        .first();

      assert.strictEqual(constraint.constraint_text, specialRule);
    });

    it('should handle unicode characters in constraint_text', async () => {
      const db = getDb();
      const unicodeText = '日本語のルール: Unicode support test 🎯';

      const constraintId = await insertConstraint(db, {
        constraint_text: unicodeText,
        category_id: categoryTestingId,
        priority: 2,
        layer_id: businessLayerId,
        project_id: projectId,
        active: 1,
        ts: Math.floor(Date.now() / 1000),
      });

      assert.ok(constraintId);

      const constraint = await db('t_constraints')
        .where({ id: constraintId })
        .first();

      assert.strictEqual(constraint.constraint_text, unicodeText);
    });
  });

  describe('View functionality', () => {
    it('should query active constraints via v_tagged_constraints view (if exists)', async () => {
      const db = getDb();

      // Check if view exists (may not exist in all database versions)
      const hasView = await db.schema.hasTable('v_tagged_constraints');

      if (!hasView) {
        // Skip test if view doesn't exist
        return;
      }

      const constraintTextViewTest = 'View test constraint';
      const constraintId = await insertConstraint(db, {
        constraint_text: constraintTextViewTest,
        category_id: categoryArchitectureId,
        priority: 3,
        layer_id: businessLayerId,
        project_id: projectId,
        active: 1,
        ts: Math.floor(Date.now() / 1000),
      });

      const viewResults = await db('v_tagged_constraints')
        .where({ active: 1 })
        .select('*');

      const viewConstraint = viewResults.find((c: any) => c.constraint_text === 'View test constraint');
      assert.ok(viewConstraint, 'Should find constraint in view');
      assert.strictEqual(viewConstraint.priority, 3);
    });
  });
});
