/**
 * Help System Test Suite (TOML-based)
 *
 * Tests for HelpSystemLoader and TOML-based help data:
 * 1. TOML files load correctly
 * 2. Search functionality works
 * 3. Use case retrieval works
 * 4. Token efficiency targets are met
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  HelpSystemLoader,
  getHelpLoader,
  resetHelpLoader
} from '../../../help-loader.js';
import { estimateTokens } from '../../../utils/token-estimation.js';

// Test configuration - current tools
const TEST_TOOLS = ['decision', 'constraint', 'suggest', 'help', 'example', 'use_case'];
const TEST_ACTIONS: Record<string, string[]> = {
  decision: ['set', 'get', 'list'],
  constraint: ['add', 'get'],
  suggest: ['by_key', 'by_tags'],
  help: ['query_action', 'query_tool'],
  example: ['get', 'search'],
  use_case: ['get', 'search']
};

describe('Help System (TOML-based)', () => {
  let loader: HelpSystemLoader;

  before(async () => {
    resetHelpLoader();
    loader = await getHelpLoader();
  });

  after(() => {
    resetHelpLoader();
  });

  describe('Tool loading', () => {
    it('should load all expected tools', () => {
      const toolNames = loader.getToolNames();
      for (const tool of TEST_TOOLS) {
        assert.ok(toolNames.includes(tool), `Tool ${tool} should be loaded`);
      }
    });

    for (const tool of TEST_TOOLS) {
      it(`should have valid data for ${tool}`, () => {
        const toolData = loader.getTool(tool);
        assert.ok(toolData, `Tool ${tool} should exist`);
        assert.ok(toolData.name === tool, `Tool name should match`);
        assert.ok(toolData.description, `Tool should have description`);
        assert.ok(toolData.actions.length > 0, `Tool should have actions`);
      });
    }
  });

  describe('Action queries', () => {
    for (const tool of TEST_TOOLS) {
      const actions = TEST_ACTIONS[tool] || ['set', 'get'];
      for (const action of actions) {
        it(`should return valid action for ${tool}.${action}`, () => {
          const result = loader.getAction(tool, action);

          assert.ok(result, `Action ${tool}.${action} should exist`);
          assert.ok(result.name === action, `Action name should match`);
          assert.ok(result.description, `Action should have description`);
          assert.ok(Array.isArray(result.params), `Action should have params array`);
          assert.ok(Array.isArray(result.examples), `Action should have examples array`);

          // Token estimation on action data
          const tokens = estimateTokens(result);
          assert.ok(tokens >= 10 && tokens <= 600,
            `Token count ${tokens} outside target range (10-600)`);
        });
      }
    }
  });

  describe('Decision help accuracy', () => {
    it('should document scopes parameter for decision.set instead of legacy scope', () => {
      const action = loader.getAction('decision', 'set');

      assert.ok(action, 'decision.set should exist');
      const paramNames = action.params.map((param) => param.name);

      assert.ok(paramNames.includes('scopes'), 'decision.set should document scopes');
      assert.ok(!paramNames.includes('scope'), 'decision.set should not document legacy scope');
    });

    it('should document required analytics parameters', () => {
      const action = loader.getAction('decision', 'analytics');

      assert.ok(action, 'decision.analytics should exist');
      const paramsByName = new Map(action.params.map((param) => [param.name, param]));

      assert.equal(paramsByName.get('key_pattern')?.required, true);
      assert.equal(paramsByName.get('aggregation')?.required, true);
      assert.match(paramsByName.get('aggregation')?.description ?? '', /avg/);
      assert.match(paramsByName.get('aggregation')?.description ?? '', /count/);
    });
  });

  describe('Example search', () => {
    it('should find examples by keyword', () => {
      const results = loader.searchExamples('decision');
      assert.ok(results.length > 0, 'Should find examples matching "decision"');
    });

    it('should filter examples by tool', () => {
      const results = loader.searchExamples('set', { tool: 'decision' });
      for (const r of results) {
        assert.equal(r.tool, 'decision', 'All results should be from decision tool');
      }
    });

    it('should respect limit', () => {
      const results = loader.searchExamples('', { limit: 5 });
      assert.ok(results.length <= 5, 'Should return at most 5 results');
    });
  });

  describe('Example listing', () => {
    it('should list all examples', () => {
      const result = loader.listExamples();
      assert.ok(result.total > 0, 'Should have examples');
      assert.ok(result.examples.length > 0, 'Should return examples');
    });

    it('should filter by tool', () => {
      const result = loader.listExamples({ tool: 'decision' });
      for (const e of result.examples) {
        assert.equal(e.tool, 'decision', 'All examples should be from decision tool');
      }
    });

    it('should support pagination', () => {
      const page1 = loader.listExamples({ limit: 2, offset: 0 });
      const page2 = loader.listExamples({ limit: 2, offset: 2 });

      assert.equal(page1.examples.length, 2, 'Page 1 should have 2 items');
      // Pages should be different (if enough data)
      if (page1.total > 4) {
        assert.notDeepEqual(page1.examples, page2.examples, 'Pages should be different');
      }
    });
  });

  describe('Use case queries', () => {
    it('should get use case by ID', () => {
      const useCase = loader.getUseCase(1);
      assert.ok(useCase, 'Use case 1 should exist');
      assert.equal(useCase.id, 1, 'ID should match');
      assert.ok(useCase.title, 'Should have title');
      assert.ok(useCase.description, 'Should have description');
    });

    it('should return undefined for non-existent ID', () => {
      const useCase = loader.getUseCase(9999);
      assert.equal(useCase, undefined, 'Should return undefined for non-existent ID');
    });

    it('should search use cases by keyword', () => {
      const results = loader.searchUseCases('decision');
      assert.ok(results.length > 0, 'Should find use cases matching "decision"');
    });

    it('should filter use cases by category', () => {
      const results = loader.searchUseCases('', { category: 'decision_tracking' });
      for (const uc of results) {
        assert.equal(uc.category, 'decision_tracking', 'Category should match');
      }
    });

    it('should filter use cases by complexity', () => {
      const results = loader.searchUseCases('', { complexity: 'basic' });
      for (const uc of results) {
        assert.equal(uc.complexity, 'basic', 'Complexity should match');
      }
    });
  });

  describe('Use case listing', () => {
    it('should list all use cases', () => {
      const result = loader.listUseCases();
      assert.ok(result.total > 0, 'Should have use cases');
      assert.ok(result.use_cases.length > 0, 'Should return use cases');
    });

    it('should include categories when no filter', () => {
      const result = loader.listUseCases();
      assert.ok(Array.isArray(result.categories), 'Should include categories array');
      assert.ok(result.categories!.length > 0, 'Should have categories');
    });

    it('should not include categories when filtered', () => {
      const result = loader.listUseCases({ category: 'decision_tracking' });
      assert.equal(result.categories, undefined, 'Should not include categories when filtered');
    });
  });

  describe('Workflow hints (next actions)', () => {
    it('should return next actions for decision.set', () => {
      const nextActions = loader.getNextActions('decision', 'set');
      // May be empty if no use cases define this sequence
      assert.ok(Array.isArray(nextActions), 'Should return array');
    });

    it('should return empty for non-existent action', () => {
      const nextActions = loader.getNextActions('decision', 'nonexistent_action');
      assert.deepEqual(nextActions, [], 'Should return empty array');
    });
  });

  describe('Categories', () => {
    it('should return all categories', () => {
      const categories = loader.getCategories();
      assert.ok(categories.length > 0, 'Should have categories');
      for (const cat of categories) {
        assert.ok(cat.name, 'Category should have name');
        assert.ok(cat.description, 'Category should have description');
      }
    });
  });

  describe('Token efficiency', () => {
    it('should meet token targets for tool queries', () => {
      for (const tool of TEST_TOOLS) {
        const toolData = loader.getTool(tool);
        if (toolData) {
          const tokens = estimateTokens(toolData);
          // Full tool data (all actions): 50-5000 tokens
          // Decision tool is largest with 23 actions
          assert.ok(tokens >= 50 && tokens <= 5000,
            `Tool ${tool} tokens (${tokens}) outside target range (50-5000)`);
        }
      }
    });

    it('should meet token targets for use case queries', () => {
      const result = loader.listUseCases({ limit: 10 });
      const tokens = estimateTokens(result);
      // List result: 50-500 tokens
      assert.ok(tokens >= 30 && tokens <= 600,
        `Use case list tokens (${tokens}) outside target range (30-600)`);
    });
  });
});
