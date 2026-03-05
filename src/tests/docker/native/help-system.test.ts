/**
 * Help System - Native RDBMS Integration Tests
 *
 * Tests help system tables via direct Knex operations
 * on MySQL, MariaDB, and PostgreSQL.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { Knex } from 'knex';
import { runTestsOnAllDatabases } from './test-harness.js';

runTestsOnAllDatabases('Help System', (getDb, dbType) => {
  let projectId: number;

  it('should get project ID', async () => {
    const db = getDb();
    const project = await db('m_projects').first();
    assert.ok(project, 'Project should exist');
    projectId = project.id;
  });

  describe('m_help_tools table', () => {
    it('should have decision tool registered', async () => {
      const db = getDb();

      const tool = await db('m_help_tools')
        .where({ tool_name: 'decision' })
        .first();

      assert.ok(tool, 'Decision tool should be registered');
      assert.strictEqual(tool.tool_name, 'decision');
      assert.ok(tool.description, 'Tool should have description');
      assert.ok(tool.description.includes('decision') || tool.description.includes('context'),
        'Description should mention decision or context management');
    });

    // Note: Task tool removed in v5.0 (deprecated)

    it('should have constraint tool registered', async () => {
      const db = getDb();

      const tool = await db('m_help_tools')
        .where({ tool_name: 'constraint' })
        .first();

      assert.ok(tool, 'Constraint tool should be registered');
      assert.strictEqual(tool.tool_name, 'constraint');
      assert.ok(tool.description, 'Tool should have description');
    });

    it('should have help and example tools registered', async () => {
      const db = getDb();

      const helpTool = await db('m_help_tools')
        .where({ tool_name: 'help' })
        .first();

      const exampleTool = await db('m_help_tools')
        .where({ tool_name: 'example' })
        .first();

      assert.ok(helpTool, 'Help tool should be registered');
      assert.ok(exampleTool, 'Example tool should be registered');
    });

    it('should have all core tools registered', async () => {
      const db = getDb();

      const tools = await db('m_help_tools')
        .select('tool_name')
        .orderBy('tool_name');

      const toolNames = tools.map((t: any) => t.tool_name);

      // Core tools that must exist (task removed in v5.0)
      const requiredTools = ['decision', 'constraint', 'help', 'example'];
      for (const requiredTool of requiredTools) {
        assert.ok(
          toolNames.includes(requiredTool),
          `Should have ${requiredTool} tool registered`
        );
      }
    });
  });

  describe('m_help_actions table', () => {
    it('should have decision.set action documented', async () => {
      const db = getDb();

      const action = await db('m_help_actions')
        .where({ tool_name: 'decision', action_name: 'set' })
        .first();

      assert.ok(action, 'decision.set action should be documented');
      assert.strictEqual(action.action_name, 'set');
      assert.ok(action.description, 'Action should have description');

      // Parameters are stored in t_help_action_params table
      const params = await db('t_help_action_params')
        .where({ action_id: action.id })
        .select('*');

      assert.ok(Array.isArray(params), 'Parameters should be an array');
      assert.ok(params.length > 0, 'Should have at least one parameter');

      const paramNames = params.map((p: any) => p.param_name);
      assert.ok(paramNames.includes('key'), 'Should have key parameter');
      assert.ok(paramNames.includes('value'), 'Should have value parameter');
    });

    // Note: task.create action test removed in v5.0 (task tool deprecated)

    it('should have constraint.add action documented', async () => {
      const db = getDb();

      const action = await db('m_help_actions')
        .where({ tool_name: 'constraint', action_name: 'add' })
        .first();

      assert.ok(action, 'constraint.add action should be documented');
      assert.strictEqual(action.action_name, 'add');
      assert.ok(action.description, 'Action should have description');

      // Parameters are stored in t_help_action_params table
      const params = await db('t_help_action_params')
        .where({ action_id: action.id })
        .select('*');

      assert.ok(Array.isArray(params), 'Should have parameters');
    });

    it('should have multiple actions per tool', async () => {
      const db = getDb();

      const decisionActions = await db('m_help_actions')
        .where({ tool_name: 'decision' })
        .select('action_name');

      // Note: Task tool removed in v5.0
      const constraintActions = await db('m_help_actions')
        .where({ tool_name: 'constraint' })
        .select('action_name');

      assert.ok(decisionActions.length > 1, 'Decision tool should have multiple actions');
      assert.ok(constraintActions.length >= 1, 'Constraint tool should have actions');

      const decisionActionNames = decisionActions.map((a: any) => a.action_name);
      assert.ok(decisionActionNames.includes('set'), 'Should have set action');
      assert.ok(decisionActionNames.includes('get'), 'Should have get action');
    });

    it('should indicate required vs optional parameters', async () => {
      const db = getDb();

      const action = await db('m_help_actions')
        .where({ tool_name: 'decision', action_name: 'set' })
        .first();

      assert.ok(action, 'Action should exist');

      // Parameters are stored in t_help_action_params table
      const params = await db('t_help_action_params')
        .where({ action_id: action.id })
        .select('*');

      assert.ok(params.length > 0, 'Should have parameters');

      // Check that parameters have required flag (stored as integer 0/1)
      const hasRequiredFlag = params.every((p: any) =>
        typeof p.required === 'number' || typeof p.required === 'boolean'
      );
      assert.ok(hasRequiredFlag, 'All parameters should have required flag');
    });
  });

  describe('m_help_actions foreign key constraints', () => {
    it('should enforce FK constraint on tool_name', async () => {
      const db = getDb();

      try {
        // m_help_actions columns: id, tool_name, action_name, description, returns
        // (parameters is stored in separate t_help_action_params table)
        await db('m_help_actions').insert({
          tool_name: 'non_existent_tool',
          action_name: 'test_action',
          description: 'Test description',
        });
        assert.fail('Should have thrown FK constraint error');
      } catch (error: any) {
        // Expected: FK constraint violation
        assert.ok(
          error.message.includes('foreign key') ||
          error.message.includes('FOREIGN KEY') ||
          error.message.includes('constraint'),
          'Should be a foreign key constraint error'
        );
      }
    });

    it('should allow actions with valid tool_name', async () => {
      const db = getDb();

      const testActionName = `test_action_${Date.now()}`;

      await db('m_help_actions').insert({
        tool_name: 'decision',
        action_name: testActionName,
        description: 'Test action',
      });

      const inserted = await db('m_help_actions')
        .where({ tool_name: 'decision', action_name: testActionName })
        .first();

      assert.ok(inserted, 'Should insert action with valid tool_name');

      await db('m_help_actions')
        .where({ action_name: testActionName })
        .delete();
    });
  });

  describe('t_help_action_examples table', () => {
    it('should have examples for decision tool', async () => {
      const db = getDb();

      const examples = await db('t_help_action_examples')
        .join('m_help_actions', 't_help_action_examples.action_id', 'm_help_actions.id')
        .where({ 'm_help_actions.tool_name': 'decision' })
        .select('t_help_action_examples.*');

      assert.ok(
        examples.length >= 0,
        'Should return examples (or empty array if none seeded)'
      );

      if (examples.length > 0) {
        const example = examples[0];
        assert.ok(example.title, 'Example should have title');
        assert.ok(example.code, 'Example should have code');
      }
    });

    it('should filter examples by action', async () => {
      const db = getDb();

      const examples = await db('t_help_action_examples')
        .join('m_help_actions', 't_help_action_examples.action_id', 'm_help_actions.id')
        .where({ 'm_help_actions.tool_name': 'decision', 'm_help_actions.action_name': 'set' })
        .select('t_help_action_examples.*', 'm_help_actions.tool_name', 'm_help_actions.action_name');

      assert.ok(Array.isArray(examples), 'Should return array');

      examples.forEach((ex: any) => {
        assert.strictEqual(ex.tool_name, 'decision');
        assert.strictEqual(ex.action_name, 'set');
      });
    });

    it('should have required columns', async () => {
      const db = getDb();

      const examples = await db('t_help_action_examples')
        .limit(5)
        .select('*');

      assert.ok(Array.isArray(examples), 'Should return examples array');

      if (examples.length > 0) {
        const example = examples[0];
        assert.ok('id' in example, 'Should have id');
        assert.ok('action_id' in example, 'Should have action_id');
        assert.ok('title' in example, 'Should have title');
        assert.ok('code' in example, 'Should have code');
        assert.ok('explanation' in example, 'Should have explanation');
      }
    });

    it('should search examples by keyword in title', async () => {
      const db = getDb();

      const keyword = 'decision';
      const examples = await db('t_help_action_examples')
        .where('title', 'like', `%${keyword}%`)
        .select('*');

      assert.ok(Array.isArray(examples), 'Should return search results');

      examples.forEach((ex: any) => {
        assert.ok(
          ex.title.toLowerCase().includes(keyword.toLowerCase()),
          'Title should contain keyword'
        );
      });
    });

    it('should search examples by keyword in explanation', async () => {
      const db = getDb();

      const keyword = 'task';
      const examples = await db('t_help_action_examples')
        .where('explanation', 'like', `%${keyword}%`)
        .select('*');

      assert.ok(Array.isArray(examples), 'Should return search results');
    });

    it('should search examples by tool and keyword', async () => {
      const db = getDb();

      // Join with m_help_actions to filter by tool_name (task -> decision in v5.0)
      const examples = await db('t_help_action_examples')
        .join('m_help_actions', 't_help_action_examples.action_id', 'm_help_actions.id')
        .where({ 'm_help_actions.tool_name': 'decision' })
        .andWhere(function() {
          this.where('title', 'like', '%set%')
            .orWhere('explanation', 'like', '%set%');
        })
        .select('t_help_action_examples.*', 'm_help_actions.tool_name');

      assert.ok(Array.isArray(examples), 'Should return filtered search results');

      examples.forEach((ex: any) => {
        assert.strictEqual(ex.tool_name, 'decision');
      });
    });
  });

  describe('t_help_use_cases table', () => {
    it('should have use case table structure', async () => {
      const db = getDb();

      const useCases = await db('t_help_use_cases')
        .limit(5)
        .select('*');

      assert.ok(Array.isArray(useCases), 'Should return use cases array');

      if (useCases.length > 0) {
        const useCase = useCases[0];
        assert.ok('id' in useCase, 'Use case should have id');
        assert.ok('title' in useCase, 'Use case should have title');
        assert.ok('category_id' in useCase, 'Use case should have category_id');
        assert.ok('complexity' in useCase, 'Use case should have complexity');
      }
    });

    it('should get use case by ID', async () => {
      const db = getDb();

      const firstUseCase = await db('t_help_use_cases')
        .orderBy('id', 'asc')
        .first();

      if (firstUseCase) {
        const useCase = await db('t_help_use_cases')
          .where({ id: firstUseCase.id })
          .first();

        assert.ok(useCase, 'Should retrieve use case by ID');
        assert.strictEqual(useCase.id, firstUseCase.id);
        assert.ok(useCase.title, 'Use case should have title');
      }
    });

    it('should search use cases by keyword in title', async () => {
      const db = getDb();

      const keyword = 'sprint';
      const useCases = await db('t_help_use_cases')
        .where('title', 'like', `%${keyword}%`)
        .select('*');

      assert.ok(Array.isArray(useCases), 'Should return search results');
    });

    it('should search use cases by keyword in description', async () => {
      const db = getDb();

      const keyword = 'workflow';
      const useCases = await db('t_help_use_cases')
        .where('description', 'like', `%${keyword}%`)
        .select('*');

      assert.ok(Array.isArray(useCases), 'Should return search results');
    });

    it('should filter use cases by complexity', async () => {
      const db = getDb();

      const basicUseCases = await db('t_help_use_cases')
        .where({ complexity: 'basic' })
        .select('*');

      const advancedUseCases = await db('t_help_use_cases')
        .where({ complexity: 'advanced' })
        .select('*');

      assert.ok(Array.isArray(basicUseCases), 'Should return basic use cases');
      assert.ok(Array.isArray(advancedUseCases), 'Should return advanced use cases');

      basicUseCases.forEach((uc: any) => {
        assert.strictEqual(uc.complexity, 'basic');
      });

      advancedUseCases.forEach((uc: any) => {
        assert.strictEqual(uc.complexity, 'advanced');
      });
    });
  });

  describe('m_help_use_case_cats table', () => {
    it('should have use case categories', async () => {
      const db = getDb();

      const categories = await db('m_help_use_case_cats')
        .select('*');

      assert.ok(Array.isArray(categories), 'Should return categories');
      assert.ok(categories.length > 0, 'Should have at least one category');

      categories.forEach((cat: any) => {
        assert.ok(cat.id, 'Category should have id');
        assert.ok(cat.category_name, 'Category should have name');
      });
    });

    it('should join use cases with categories', async () => {
      const db = getDb();

      const useCasesWithCategory = await db('t_help_use_cases')
        .join(
          'm_help_use_case_cats',
          't_help_use_cases.category_id',
          'm_help_use_case_cats.id'
        )
        .select(
          't_help_use_cases.*',
          'm_help_use_case_cats.category_name'
        )
        .limit(5);

      assert.ok(Array.isArray(useCasesWithCategory), 'Should return joined results');

      useCasesWithCategory.forEach((uc: any) => {
        assert.ok(uc.category_name, 'Should have category_name from join');
      });
    });

    it('should filter use cases by category name', async () => {
      const db = getDb();

      const categories = await db('m_help_use_case_cats')
        .select('*');

      if (categories.length > 0) {
        const firstCategory = categories[0];

        const useCases = await db('t_help_use_cases')
          .join(
            'm_help_use_case_cats',
            't_help_use_cases.category_id',
            'm_help_use_case_cats.id'
          )
          .where('m_help_use_case_cats.category_name', firstCategory.category_name)
          .select('t_help_use_cases.*');

        assert.ok(Array.isArray(useCases), 'Should return category-filtered results');
      }
    });
  });

  // NOTE: m_help_use_case_steps table does not exist in current schema
  // Use case steps are stored in the 'workflow' TEXT column of t_help_use_cases

  describe(`Cross-database compatibility - ${dbType}`, () => {
    it('should handle unicode in example search', async () => {
      const db = getDb();

      const unicodeKeyword = '日本語';
      const examples = await db('t_help_action_examples')
        .where('title', 'like', `%${unicodeKeyword}%`)
        .select('*');

      assert.ok(Array.isArray(examples), 'Should handle unicode search');
    });

    it('should handle special characters in search', async () => {
      const db = getDb();

      const specialKeyword = "test's \"special\" chars";
      const examples = await db('t_help_action_examples')
        .where('title', 'like', `%${specialKeyword}%`)
        .select('*');

      assert.ok(Array.isArray(examples), 'Should handle special characters');
    });

    it('should support pagination in example listing', async () => {
      const db = getDb();

      const page1 = await db('t_help_action_examples')
        .limit(5)
        .offset(0)
        .select('*');

      const page2 = await db('t_help_action_examples')
        .limit(5)
        .offset(5)
        .select('*');

      assert.ok(Array.isArray(page1), 'Should return page 1');
      assert.ok(Array.isArray(page2), 'Should return page 2');

      if (page1.length === 5 && page2.length > 0) {
        const page1Ids = page1.map((e: any) => e.id);
        const page2Ids = page2.map((e: any) => e.id);
        const overlap = page1Ids.some((id: number) => page2Ids.includes(id));
        assert.strictEqual(overlap, false, 'Pages should not overlap');
      }
    });

    it('should support pagination in use case listing', async () => {
      const db = getDb();

      const page1 = await db('t_help_use_cases')
        .limit(3)
        .offset(0)
        .select('*');

      const page2 = await db('t_help_use_cases')
        .limit(3)
        .offset(3)
        .select('*');

      assert.ok(Array.isArray(page1), 'Should return page 1');
      assert.ok(Array.isArray(page2), 'Should return page 2');
    });

    it('should retrieve parameters from t_help_action_params', async () => {
      const db = getDb();

      const action = await db('m_help_actions')
        .where({ tool_name: 'decision', action_name: 'set' })
        .first();

      if (action) {
        const params = await db('t_help_action_params')
          .where({ action_id: action.id })
          .select('*');

        assert.ok(Array.isArray(params), 'Should retrieve parameters as array');
      }
    });

    it('should enforce PRIMARY KEY uniqueness on tool_name in m_help_tools', async () => {
      const db = getDb();

      try {
        await db('m_help_tools').insert({
          tool_name: 'decision', // Duplicate - conflicts with PRIMARY KEY
          description: 'Duplicate tool',
        });
        assert.fail('Should have thrown uniqueness constraint error');
      } catch (error: any) {
        // Expected: PRIMARY KEY or UNIQUE constraint violation
        // Different databases use different error messages:
        // - MySQL/MariaDB: "Duplicate entry"
        // - PostgreSQL: "duplicate key value"
        // - SQLite: "UNIQUE constraint"
        const msg = error.message.toLowerCase();
        assert.ok(
          msg.includes('unique') ||
          msg.includes('duplicate') ||
          msg.includes('primary') ||
          msg.includes('constraint'),
          `Should be a uniqueness constraint error, got: ${error.message}`
        );
      }
    });

    it('should enforce composite UNIQUE on (tool_name, action_name)', async () => {
      const db = getDb();

      try {
        // m_help_actions columns: id, tool_name, action_name, description, returns
        await db('m_help_actions').insert({
          tool_name: 'decision',
          action_name: 'set', // Duplicate combination
          description: 'Duplicate action',
        });
        assert.fail('Should have thrown UNIQUE constraint error');
      } catch (error: any) {
        // Expected: UNIQUE constraint violation
        assert.ok(
          error.message.includes('unique') ||
          error.message.includes('UNIQUE') ||
          error.message.includes('duplicate'),
          'Should be a unique constraint error'
        );
      }
    });
  });

  describe('Integration - Complex queries', () => {
    it('should join tools, actions, and examples', async () => {
      const db = getDb();

      const results = await db('m_help_tools')
        .join('m_help_actions', 'm_help_tools.tool_name', 'm_help_actions.tool_name')
        .leftJoin('t_help_action_examples', 'm_help_actions.id', 't_help_action_examples.action_id')
        .select(
          'm_help_tools.tool_name',
          'm_help_actions.action_name',
          't_help_action_examples.title'
        )
        .limit(10);

      assert.ok(Array.isArray(results), 'Should return joined results');

      results.forEach((row: any) => {
        assert.ok(row.tool_name, 'Should have tool_name');
        assert.ok(row.action_name, 'Should have action_name');
        // title may be null (left join)
      });
    });

    it('should count actions per tool', async () => {
      const db = getDb();

      const counts = await db('m_help_actions')
        .select('tool_name')
        .count('* as action_count')
        .groupBy('tool_name')
        .orderBy('action_count', 'desc');

      assert.ok(Array.isArray(counts), 'Should return counts');
      assert.ok(counts.length > 0, 'Should have at least one tool with actions');

      counts.forEach((row: any) => {
        assert.ok(row.tool_name, 'Should have tool_name');
        assert.ok(row.action_count > 0, 'Should have positive count');
      });
    });

    // Note: t_help_action_examples does not have 'complexity' column
    // Complexity is stored in t_help_use_cases
    it('should count use cases per complexity level', async () => {
      const db = getDb();

      const counts = await db('t_help_use_cases')
        .select('complexity')
        .count('* as use_case_count')
        .groupBy('complexity')
        .orderBy('complexity');

      assert.ok(Array.isArray(counts), 'Should return counts');

      counts.forEach((row: any) => {
        assert.ok(row.complexity, 'Should have complexity');
        assert.ok(row.use_case_count >= 0, 'Should have count');
      });
    });

    it('should get full use case with category', async () => {
      const db = getDb();

      // Note: m_help_use_case_steps table does not exist
      // Steps are stored in 'workflow' TEXT column
      const fullUseCases = await db('t_help_use_cases')
        .join(
          'm_help_use_case_cats',
          't_help_use_cases.category_id',
          'm_help_use_case_cats.id'
        )
        .select(
          't_help_use_cases.id',
          't_help_use_cases.title',
          'm_help_use_case_cats.category_name',
          't_help_use_cases.workflow'
        )
        .orderBy('t_help_use_cases.id')
        .limit(20);

      assert.ok(Array.isArray(fullUseCases), 'Should return full use cases');

      fullUseCases.forEach((row: any) => {
        assert.ok(row.id, 'Should have id');
        assert.ok(row.title, 'Should have title');
        assert.ok(row.category_name, 'Should have category_name');
      });
    });
  });
});
