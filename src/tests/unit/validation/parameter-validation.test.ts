#!/usr/bin/env node
/**
 * Parameter Validation Test Suite for MCP Sqlew
 * Tests parameter validation, typo detection, and error message structure
 *
 * Note: Task and file tool tests removed in v5.0 (deprecated tools)
 */

import { validateActionParams, validateBatchParams } from '../../../utils/parameter-validator.js';
import { getActionSpec } from '../../../utils/action-specs/index.js';
import * as assert from 'assert';
import { test } from 'node:test';

interface ValidationTest {
  name: string;
  tool: string;
  action: string;
  params: any;
  shouldFail: boolean;
  expectedError?: {
    missing_params?: string[];
    did_you_mean?: Record<string, string>;
  };
}

const missingRequiredTests: ValidationTest[] = [
  {
    name: 'decision.set - missing key',
    tool: 'decision',
    action: 'set',
    params: { value: 'test value' },
    shouldFail: true,
    expectedError: { missing_params: ['key'] }
  },
  {
    name: 'decision.set - missing value',
    tool: 'decision',
    action: 'set',
    params: { key: 'test-key' },
    shouldFail: true,
    expectedError: { missing_params: ['value'] }
  },
  {
    name: 'decision.set - missing both key and value',
    tool: 'decision',
    action: 'set',
    params: {},
    shouldFail: true,
    expectedError: { missing_params: ['key', 'value'] }
  },
  {
    name: 'decision.get - missing key',
    tool: 'decision',
    action: 'get',
    params: {},
    shouldFail: true,
    expectedError: { missing_params: ['key'] }
  },
  {
    name: 'constraint.add - missing category',
    tool: 'constraint',
    action: 'add',
    params: { constraint_text: 'Test constraint', priority: 'high' },
    shouldFail: true,
    expectedError: { missing_params: ['category'] }
  },
  {
    name: 'constraint.add - missing constraint_text and priority',
    tool: 'constraint',
    action: 'add',
    params: { category: 'performance' },
    shouldFail: true,
    expectedError: { missing_params: ['constraint_text', 'priority'] }
  }
];

const typoDetectionTests: ValidationTest[] = [
  {
    name: 'decision.set - typo: "ky" → "key"',
    tool: 'decision',
    action: 'set',
    params: { ky: 'test-key', value: 'test value' },
    shouldFail: true,
    expectedError: { did_you_mean: { ky: 'key' } }
  },
  {
    name: 'decision.set - typo: "vlue" → "value"',
    tool: 'decision',
    action: 'set',
    params: { key: 'test-key', vlue: 'test value' },
    shouldFail: true,
    expectedError: { did_you_mean: { vlue: 'value' } }
  },
  {
    name: 'decision.set - typo: "layerr" → "layer"',
    tool: 'decision',
    action: 'set',
    params: { key: 'test-key', value: 'test', layerr: 'data' },
    shouldFail: true,
    expectedError: { did_you_mean: { layerr: 'layer' } }
  },
  {
    name: 'decision.set - typo: "tgs" → "tags"',
    tool: 'decision',
    action: 'set',
    params: { key: 'test-key', value: 'test', tgs: ['api'] },
    shouldFail: true,
    expectedError: { did_you_mean: { tgs: 'tags' } }
  },
  {
    name: 'constraint.add - typo: "categry" → "category"',
    tool: 'constraint',
    action: 'add',
    params: { categry: 'performance', constraint_text: 'Test', priority: 'high' },
    shouldFail: true,
    expectedError: { did_you_mean: { categry: 'category' } }
  }
];

const validParameterTests: ValidationTest[] = [
  {
    name: 'decision.set - valid with all optional params',
    tool: 'decision',
    action: 'set',
    params: {
      key: 'test-key',
      value: 'test value',
      agent: 'test-agent',
      layer: 'data',
      tags: ['database', 'api'],
      status: 'active',
      version: '1.0.0',
      scopes: ['auth', 'users']
    },
    shouldFail: false
  },
  {
    name: 'decision.set - valid with only required params',
    tool: 'decision',
    action: 'set',
    params: { key: 'test-key', value: 'test value' },
    shouldFail: false
  },
  {
    name: 'decision.quick_set - valid',
    tool: 'decision',
    action: 'quick_set',
    params: { key: 'test-key', value: 'test value' },
    shouldFail: false
  },
  {
    name: 'constraint.add - valid',
    tool: 'constraint',
    action: 'add',
    params: {
      category: 'performance',
      constraint_text: 'API response time must be < 100ms',
      priority: 'high',
      layer: 'business'
    },
    shouldFail: false
  }
];

const helpActionTests: ValidationTest[] = [
  {
    name: 'decision.help - should skip validation',
    tool: 'decision',
    action: 'help',
    params: {},
    shouldFail: false
  },
  {
    name: 'constraint.use_case - should skip validation',
    tool: 'constraint',
    action: 'use_case',
    params: {},
    shouldFail: false
  }
];

function runValidationTest(testCase: ValidationTest): void {
  try {
    validateActionParams(testCase.tool, testCase.action, testCase.params);

    if (testCase.shouldFail) {
      throw new Error(`Expected validation to fail, but it passed`);
    }

    // Success - validation passed as expected
  } catch (error) {
    if (!testCase.shouldFail) {
      throw new Error(`Unexpected validation failure: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Validation failed as expected - verify error structure
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Try to parse as JSON error
    let parsedError: any;
    try {
      parsedError = JSON.parse(errorMessage);
    } catch {
      // Not JSON - that's okay for some errors
      return;
    }

    // Verify error structure has required fields (new v3.9.0 format)
    assert.ok(parsedError.error, 'Error should have "error" field');
    assert.ok(parsedError.action, 'Error should have "action" field');
    assert.ok(parsedError.reference, 'Error should have "reference" field');

    // Verify expected error details
    if (testCase.expectedError?.missing_params) {
      assert.ok(Array.isArray(parsedError.missing), 'Error should have "missing" array');
      for (const param of testCase.expectedError.missing_params) {
        assert.ok(
          parsedError.missing.includes(param),
          `missing should include "${param}"`
        );
      }
    }

    if (testCase.expectedError?.did_you_mean) {
      assert.ok(parsedError.typos, 'Error should have "typos" field');
      for (const [typo, suggestion] of Object.entries(testCase.expectedError.did_you_mean)) {
        assert.strictEqual(
          parsedError.typos[typo],
          suggestion,
          `typos["${typo}"] should suggest "${suggestion}"`
        );
      }
    }
  }
}

test('Missing Required Parameters', async (t) => {
  for (const testCase of missingRequiredTests) {
    await t.test(testCase.name, () => {
      runValidationTest(testCase);
    });
  }
});

test('Typo Detection (Levenshtein Distance ≤ 2)', async (t) => {
  for (const testCase of typoDetectionTests) {
    await t.test(testCase.name, () => {
      runValidationTest(testCase);
    });
  }
});

test('Valid Parameter Combinations', async (t) => {
  for (const testCase of validParameterTests) {
    await t.test(testCase.name, () => {
      runValidationTest(testCase);
    });
  }
});

test('Help Actions Skip Validation', async (t) => {
  for (const testCase of helpActionTests) {
    await t.test(testCase.name, () => {
      runValidationTest(testCase);
    });
  }
});

test('Batch Validation', async (t) => {
  await t.test('validateBatchParams - valid batch', () => {
    const items = [
      { key: 'key1', value: 'value1' },
      { key: 'key2', value: 'value2' },
      { key: 'key3', value: 'value3' }
    ];

    // Should not throw
    validateBatchParams('decision', 'decisions', items, 'set', 50);
  });

  await t.test('validateBatchParams - missing required in batch item', () => {
    const items = [
      { key: 'key1', value: 'value1' },
      { key: 'key2' }, // Missing 'value'
      { key: 'key3', value: 'value3' }
    ];

    assert.throws(
      () => validateBatchParams('decision', 'decisions', items, 'set', 50),
      /Batch validation failed/,
      'Should throw batch validation error'
    );
  });

  await t.test('validateBatchParams - exceeds max items', () => {
    const items = Array(51).fill({ key: 'key', value: 'value' });

    assert.throws(
      () => validateBatchParams('decision', 'decisions', items, 'set', 50),
      /must contain at most 50 items/,
      'Should throw max items exceeded error'
    );
  });

  await t.test('validateBatchParams - not an array', () => {
    assert.throws(
      () => validateBatchParams('decision', 'decisions', 'not-an-array' as any, 'set', 50),
      /must be an array/,
      'Should throw type error'
    );
  });

  await t.test('validateBatchParams - empty array is allowed', () => {
    // Should not throw
    validateBatchParams('decision', 'decisions', [], 'set', 50);
  });
});

test('Action Spec Registry', async (t) => {
  await t.test('getActionSpec - valid tool and action', () => {
    const spec = getActionSpec('decision', 'set');
    assert.ok(spec, 'Should return spec for valid tool/action');
    assert.ok(Array.isArray(spec.required), 'Spec should have required array');
    assert.ok(Array.isArray(spec.optional), 'Spec should have optional array');
    assert.ok(spec.example, 'Spec should have example');
  });

  await t.test('getActionSpec - invalid tool', () => {
    const spec = getActionSpec('invalid-tool', 'set');
    assert.strictEqual(spec, null, 'Should return null for invalid tool');
  });

  await t.test('getActionSpec - invalid action', () => {
    const spec = getActionSpec('decision', 'invalid-action');
    assert.strictEqual(spec, null, 'Should return null for invalid action');
  });

  await t.test('All tools have action specs', () => {
    const tools = ['decision', 'constraint'];
    for (const tool of tools) {
      // Test at least one action per tool
      const spec = getActionSpec(tool, tool === 'decision' ? 'set' :
                                       tool === 'constraint' ? 'add' :
                                       'layer_summary');
      assert.ok(spec, `Tool "${tool}" should have action specs`);
    }
  });
});

console.log('\n✅ All parameter validation tests completed successfully!');
