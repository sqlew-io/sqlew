/**
 * Unit Tests for Batch Validation Utilities
 * Tests core validation functions and error formatting
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  validateRequiredField,
  validateEnum,
  validateType,
  validateRange,
  validateLength,
  validateLayerFileRequirement,
  formatBatchValidationError,
  type BatchValidationError,
  type BatchValidationResult
} from '../../../utils/batch-validation.js';
import { STANDARD_LAYERS } from '../../../constants.js';

describe('Batch Validation - Required Fields', () => {
  it('should detect missing required field (undefined)', () => {
    const errors: BatchValidationError[] = [];
    validateRequiredField(undefined, 'title', 0, 'Item 0', errors);

    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].field, 'title');
    assert.strictEqual(errors[0].issue, 'Field "title" is required but missing or empty');
    assert.strictEqual(errors[0].itemIndex, 0);
  });

  it('should detect missing required field (null)', () => {
    const errors: BatchValidationError[] = [];
    validateRequiredField(null, 'key', 1, 'Item 1', errors);

    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].field, 'key');
  });

  it('should detect missing required field (empty string)', () => {
    const errors: BatchValidationError[] = [];
    validateRequiredField('', 'value', 2, 'Item 2', errors);

    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].field, 'value');
  });

  it('should pass for non-empty value', () => {
    const errors: BatchValidationError[] = [];
    validateRequiredField('valid-title', 'title', 0, 'Item 0', errors);

    assert.strictEqual(errors.length, 0);
  });
});

describe('Batch Validation - Enum Values', () => {
  const validStatuses = ['active', 'deprecated', 'draft'] as const;

  it('should detect invalid enum value', () => {
    const errors: BatchValidationError[] = [];
    validateEnum('invalid', 'status', validStatuses, 0, 'Item 0', errors);

    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].field, 'status');
    assert.strictEqual(errors[0].issue, 'Invalid status: "invalid"');
    assert.ok(errors[0].validOptions);
    assert.deepStrictEqual(errors[0].validOptions, ['active', 'deprecated', 'draft']);
  });

  it('should suggest closest match for typo (busines → business)', () => {
    const errors: BatchValidationError[] = [];
    validateEnum('busines', 'layer', STANDARD_LAYERS, 0, 'Item 0', errors);

    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].fix.includes('business'));
    assert.ok(errors[0].fix.includes('closest match'));
  });

  it('should suggest closest match for typo (infra → infrastructure)', () => {
    const validLayers = STANDARD_LAYERS;
    const errors: BatchValidationError[] = [];
    validateEnum('infra', 'layer', validLayers, 0, 'Item 0', errors);

    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].fix.includes('infrastructure') || errors[0].fix.includes('Use one of'));
  });

  it('should pass for valid enum value', () => {
    const errors: BatchValidationError[] = [];
    validateEnum('active', 'status', validStatuses, 0, 'Item 0', errors);

    assert.strictEqual(errors.length, 0);
  });

  it('should skip validation for undefined (optional field)', () => {
    const errors: BatchValidationError[] = [];
    validateEnum(undefined, 'status', validStatuses, 0, 'Item 0', errors);

    assert.strictEqual(errors.length, 0);
  });
});

describe('Batch Validation - Type Checking', () => {
  it('should detect wrong type (string instead of array)', () => {
    const errors: BatchValidationError[] = [];
    validateType('not-an-array', 'tags', 'array', 0, 'Item 0', errors);

    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].field, 'tags');
    assert.ok(errors[0].issue.includes('must be array'));
    assert.ok(errors[0].fix.includes('array format'));
  });

  it('should detect wrong type (number instead of string)', () => {
    const errors: BatchValidationError[] = [];
    validateType(123, 'title', 'string', 0, 'Item 0', errors);

    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].field, 'title');
    assert.ok(errors[0].issue.includes('must be string'));
  });

  it('should pass for correct array type', () => {
    const errors: BatchValidationError[] = [];
    validateType(['tag1', 'tag2'], 'tags', 'array', 0, 'Item 0', errors);

    assert.strictEqual(errors.length, 0);
  });

  it('should pass for correct string type', () => {
    const errors: BatchValidationError[] = [];
    validateType('valid-string', 'title', 'string', 0, 'Item 0', errors);

    assert.strictEqual(errors.length, 0);
  });

  it('should pass for correct number type', () => {
    const errors: BatchValidationError[] = [];
    validateType(42, 'priority', 'number', 0, 'Item 0', errors);

    assert.strictEqual(errors.length, 0);
  });

  it('should skip validation for undefined (optional field)', () => {
    const errors: BatchValidationError[] = [];
    validateType(undefined, 'tags', 'array', 0, 'Item 0', errors);

    assert.strictEqual(errors.length, 0);
  });
});

describe('Batch Validation - Range Checking', () => {
  it('should detect out-of-range value (too high)', () => {
    const errors: BatchValidationError[] = [];
    validateRange(5, 'priority', 1, 4, 0, 'Item 0', errors);

    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].field, 'priority');
    assert.ok(errors[0].issue.includes('between 1 and 4'));
    assert.strictEqual(errors[0].current, 5);
  });

  it('should detect out-of-range value (too low)', () => {
    const errors: BatchValidationError[] = [];
    validateRange(0, 'priority', 1, 4, 0, 'Item 0', errors);

    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].field, 'priority');
  });

  it('should detect NaN value', () => {
    const errors: BatchValidationError[] = [];
    validateRange('not-a-number', 'priority', 1, 4, 0, 'Item 0', errors);

    assert.strictEqual(errors.length, 1);
  });

  it('should pass for value within range', () => {
    const errors: BatchValidationError[] = [];
    validateRange(3, 'priority', 1, 4, 0, 'Item 0', errors);

    assert.strictEqual(errors.length, 0);
  });

  it('should pass for boundary values', () => {
    const errors: BatchValidationError[] = [];
    validateRange(1, 'priority', 1, 4, 0, 'Item 0', errors);
    validateRange(4, 'priority', 1, 4, 1, 'Item 1', errors);

    assert.strictEqual(errors.length, 0);
  });
});

describe('Batch Validation - Length Checking', () => {
  it('should detect string too long', () => {
    const errors: BatchValidationError[] = [];
    const longString = 'a'.repeat(201);
    validateLength(longString, 'title', 200, 0, 'Item 0', errors);

    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].field, 'title');
    assert.ok(errors[0].issue.includes('maximum length of 200'));
    assert.ok(errors[0].fix.includes('currently 201 chars'));
  });

  it('should pass for string within limit', () => {
    const errors: BatchValidationError[] = [];
    validateLength('short-title', 'title', 200, 0, 'Item 0', errors);

    assert.strictEqual(errors.length, 0);
  });

  it('should pass for string exactly at limit', () => {
    const errors: BatchValidationError[] = [];
    const exactString = 'a'.repeat(200);
    validateLength(exactString, 'title', 200, 0, 'Item 0', errors);

    assert.strictEqual(errors.length, 0);
  });
});

describe('Batch Validation - Layer File Requirements', () => {
  it('should detect missing file_actions for FILE_REQUIRED layer (business)', () => {
    const errors: BatchValidationError[] = [];
    validateLayerFileRequirement('business', undefined, 0, 'Item 0', errors);

    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].field, 'file_actions');
    assert.ok(errors[0].issue.includes('requires file_actions'));
    assert.ok(errors[0].fix.includes('Add file_actions'));
  });

  it('should detect missing file_actions for FILE_REQUIRED layer (presentation)', () => {
    const errors: BatchValidationError[] = [];
    validateLayerFileRequirement('presentation', undefined, 0, 'Item 0', errors);

    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].field, 'file_actions');
  });

  it('should pass for FILE_REQUIRED layer with file_actions', () => {
    const errors: BatchValidationError[] = [];
    validateLayerFileRequirement('business', [{ action: 'edit', path: 'src/file.ts' }], 0, 'Item 0', errors);

    assert.strictEqual(errors.length, 0);
  });

  it('should pass for FILE_REQUIRED layer with empty file_actions array', () => {
    const errors: BatchValidationError[] = [];
    validateLayerFileRequirement('business', [], 0, 'Item 0', errors);

    assert.strictEqual(errors.length, 0);
  });

  it('should pass for FILE_OPTIONAL layer without file_actions', () => {
    const errors: BatchValidationError[] = [];
    validateLayerFileRequirement('planning', undefined, 0, 'Item 0', errors);

    assert.strictEqual(errors.length, 0);
  });

  it('should pass when layer is undefined', () => {
    const errors: BatchValidationError[] = [];
    validateLayerFileRequirement(undefined, undefined, 0, 'Item 0', errors);

    assert.strictEqual(errors.length, 0);
  });
});

describe('Batch Validation - Error Formatting', () => {
  it('should format single error correctly', () => {
    const result: BatchValidationResult = {
      valid: false,
      errors: [
        {
          itemIndex: 0,
          itemIdentifier: 'Test Task',
          field: 'title',
          issue: 'Field "title" is required but missing or empty',
          fix: 'Provide a non-empty value for "title"',
          current: undefined
        }
      ],
      validCount: 0,
      invalidCount: 1,
      summary: 'Found 1 validation error(s) in 1 item(s). 0 items are valid.'
    };

    const formatted = formatBatchValidationError(result);

    assert.ok(formatted.includes('Batch validation failed'));
    assert.ok(formatted.includes('Item 0 (Test Task)'));
    assert.ok(formatted.includes('❌ title'));
    assert.ok(formatted.includes('💡 Fix: Provide a non-empty value'));
    assert.ok(formatted.includes('💡 Result: 0 valid, 1 invalid'));
  });

  it('should format multiple errors for same item', () => {
    const result: BatchValidationResult = {
      valid: false,
      errors: [
        {
          itemIndex: 0,
          itemIdentifier: 'Test Task',
          field: 'title',
          issue: 'Field "title" is required but missing or empty',
          fix: 'Provide a non-empty value for "title"',
          current: undefined
        },
        {
          itemIndex: 0,
          itemIdentifier: 'Test Task',
          field: 'layer',
          issue: 'Invalid layer: "busines"',
          fix: 'Change to "business" (closest match)',
          current: 'busines',
          validOptions: ['presentation', 'business', 'data']
        }
      ],
      validCount: 0,
      invalidCount: 1,
      summary: 'Found 2 validation error(s) in 1 item(s). 0 items are valid.'
    };

    const formatted = formatBatchValidationError(result);

    assert.ok(formatted.includes('❌ title'));
    assert.ok(formatted.includes('❌ layer'));
    assert.ok(formatted.includes('Valid: presentation, business, data'));
  });

  it('should format errors for multiple items', () => {
    const result: BatchValidationResult = {
      valid: false,
      errors: [
        {
          itemIndex: 0,
          itemIdentifier: 'Task 1',
          field: 'title',
          issue: 'Field "title" is required but missing or empty',
          fix: 'Provide a non-empty value for "title"',
          current: undefined
        },
        {
          itemIndex: 1,
          itemIdentifier: 'Task 2',
          field: 'priority',
          issue: 'Field "priority" must be between 1 and 4',
          fix: 'Provide a number between 1 and 4',
          current: 5
        }
      ],
      validCount: 0,
      invalidCount: 2,
      summary: 'Found 2 validation error(s) in 2 item(s). 0 items are valid.'
    };

    const formatted = formatBatchValidationError(result);

    assert.ok(formatted.includes('Item 0 (Task 1)'));
    assert.ok(formatted.includes('Item 1 (Task 2)'));
    assert.ok(formatted.includes('💡 Result: 0 valid, 2 invalid'));
  });

  it('should return summary for valid batch', () => {
    const result: BatchValidationResult = {
      valid: true,
      errors: [],
      validCount: 3,
      invalidCount: 0,
      summary: 'All 3 items are valid'
    };

    const formatted = formatBatchValidationError(result);

    assert.strictEqual(formatted, 'All 3 items are valid');
  });
});
