/**
 * Unit Tests for Case-Insensitive Validator Utility
 *
 * @see src/utils/case-insensitive-validator.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import knex, { Knex } from 'knex';
import {
  normalizeIdentifier,
  checkNormalizedDuplicate,
  validateNoNormalizedDuplicate,
  findNormalizedMatch,
  NormalizedDuplicateResult
} from '../../utils/case-insensitive-validator.js';

describe('normalizeIdentifier()', () => {
  it('should convert to lowercase', () => {
    assert.strictEqual(normalizeIdentifier('DRY'), 'dry');
    assert.strictEqual(normalizeIdentifier('API'), 'api');
    assert.strictEqual(normalizeIdentifier('SOLID'), 'solid');
  });

  it('should handle kebab-case', () => {
    assert.strictEqual(normalizeIdentifier('api-design'), 'apidesign');
    assert.strictEqual(normalizeIdentifier('test-case-name'), 'testcasename');
    assert.strictEqual(normalizeIdentifier('dry-principle'), 'dryprinciple');
  });

  it('should handle snake_case', () => {
    assert.strictEqual(normalizeIdentifier('api_design'), 'apidesign');
    assert.strictEqual(normalizeIdentifier('test_case_name'), 'testcasename');
    assert.strictEqual(normalizeIdentifier('dry_principle'), 'dryprinciple');
  });

  it('should handle camelCase', () => {
    assert.strictEqual(normalizeIdentifier('apiDesign'), 'apidesign');
    assert.strictEqual(normalizeIdentifier('testCaseName'), 'testcasename');
    assert.strictEqual(normalizeIdentifier('dryPrinciple'), 'dryprinciple');
  });

  it('should handle PascalCase', () => {
    assert.strictEqual(normalizeIdentifier('ApiDesign'), 'apidesign');
    assert.strictEqual(normalizeIdentifier('TestCaseName'), 'testcasename');
    assert.strictEqual(normalizeIdentifier('DryPrinciple'), 'dryprinciple');
  });

  it('should handle mixed formats', () => {
    assert.strictEqual(normalizeIdentifier('API-Design_Test'), 'apidesigntest');
    assert.strictEqual(normalizeIdentifier('test_Case-Name'), 'testcasename');
    assert.strictEqual(normalizeIdentifier('DRY_Principle-Test'), 'dryprincipletest');
  });

  it('should remove spaces', () => {
    assert.strictEqual(normalizeIdentifier('api design'), 'apidesign');
    assert.strictEqual(normalizeIdentifier('test case name'), 'testcasename');
    assert.strictEqual(normalizeIdentifier('dry principle'), 'dryprinciple');
  });

  it('should handle all normalization at once', () => {
    // Test: "API-Design_Test Case" → "apidesigntestcase"
    // - Uppercase → lowercase
    // - Hyphens removed
    // - Underscores removed
    // - Spaces removed
    assert.strictEqual(normalizeIdentifier('API-Design_Test Case'), 'apidesigntestcase');
  });

  it('should be consistent for equivalent values', () => {
    const variants = [
      'apiDesign',
      'api-design',
      'api_design',
      'API_DESIGN',
      'API-DESIGN',
      'ApiDesign',
      'api design'
    ];
    const normalized = variants.map(normalizeIdentifier);
    const expected = 'apidesign';

    // All should normalize to the same value
    normalized.forEach((value, index) => {
      assert.strictEqual(
        value,
        expected,
        `"${variants[index]}" should normalize to "${expected}"`
      );
    });
  });
});

describe('checkNormalizedDuplicate()', () => {
  let db: Knex;

  before(async () => {
    // Setup in-memory SQLite database
    db = knex({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true
    });

    // Create test table
    await db.schema.createTable('test_tags', (table) => {
      table.increments('id').primary();
      table.integer('project_id').notNullable();
      table.string('name', 255).notNullable();
    });

    // Insert test data
    await db('test_tags').insert([
      { project_id: 1, name: 'DRY' },
      { project_id: 1, name: 'api-design' },
      { project_id: 1, name: 'testCase' },
      { project_id: 2, name: 'SOLID' }, // Different project
      { project_id: 2, name: 'API_DESIGN' } // Different project
    ]);
  });

  after(async () => {
    await db.destroy();
  });

  it('should return no duplicate for non-existing value', async () => {
    const result = await checkNormalizedDuplicate(
      db,
      'test_tags',
      'name',
      'new-tag',
      { project_id: 1 }
    );

    assert.strictEqual(result.isDuplicate, false);
    assert.strictEqual(result.existingValue, undefined);
    assert.strictEqual(result.existingId, undefined);
    assert.strictEqual(result.matchType, undefined);
  });

  it('should return no duplicate for exact match (same value)', async () => {
    // Exact match should NOT be considered a duplicate
    // (e.g., updating existing record with same name)
    const result = await checkNormalizedDuplicate(
      db,
      'test_tags',
      'name',
      'DRY',
      { project_id: 1 }
    );

    assert.strictEqual(result.isDuplicate, false, 'Exact match should not be duplicate');
  });

  it('should detect case-only difference (matchType: case)', async () => {
    const result = await checkNormalizedDuplicate(
      db,
      'test_tags',
      'name',
      'dry', // lowercase vs uppercase "DRY"
      { project_id: 1 }
    );

    assert.strictEqual(result.isDuplicate, true);
    assert.strictEqual(result.existingValue, 'DRY');
    assert.strictEqual(result.matchType, 'case');
    assert.strictEqual(typeof result.existingId, 'number');
  });

  it('should detect naming convention difference (matchType: naming-convention)', async () => {
    const result = await checkNormalizedDuplicate(
      db,
      'test_tags',
      'name',
      'api_design', // snake_case vs kebab-case "api-design"
      { project_id: 1 }
    );

    assert.strictEqual(result.isDuplicate, true);
    assert.strictEqual(result.existingValue, 'api-design');
    assert.strictEqual(result.matchType, 'naming-convention');
    assert.strictEqual(typeof result.existingId, 'number');
  });

  it('should detect camelCase vs kebab-case difference', async () => {
    const result = await checkNormalizedDuplicate(
      db,
      'test_tags',
      'name',
      'test-case', // kebab-case vs camelCase "testCase"
      { project_id: 1 }
    );

    assert.strictEqual(result.isDuplicate, true);
    assert.strictEqual(result.existingValue, 'testCase');
    assert.strictEqual(result.matchType, 'naming-convention');
  });

  it('should respect additionalWhere conditions (project isolation)', async () => {
    // "SOLID" exists in project_id: 2, should not conflict with project_id: 1
    const result = await checkNormalizedDuplicate(
      db,
      'test_tags',
      'name',
      'solid', // lowercase vs "SOLID" in different project
      { project_id: 1 }
    );

    assert.strictEqual(result.isDuplicate, false);
  });

  it('should detect duplicate in same project only', async () => {
    // "SOLID" exists in project_id: 2
    const result = await checkNormalizedDuplicate(
      db,
      'test_tags',
      'name',
      'solid',
      { project_id: 2 }
    );

    assert.strictEqual(result.isDuplicate, true);
    assert.strictEqual(result.existingValue, 'SOLID');
    assert.strictEqual(result.matchType, 'case');
  });

  it('should work without additionalWhere (global check)', async () => {
    const result = await checkNormalizedDuplicate(
      db,
      'test_tags',
      'name',
      'dry' // Should find "DRY" in project_id: 1
    );

    assert.strictEqual(result.isDuplicate, true);
    assert.strictEqual(result.existingValue, 'DRY');
  });

  it('should handle complex naming variations', async () => {
    // "api-design" exists in project_id: 1
    const variants = ['apiDesign', 'API_DESIGN', 'api_design', 'ApiDesign'];

    for (const variant of variants) {
      const result = await checkNormalizedDuplicate(
        db,
        'test_tags',
        'name',
        variant,
        { project_id: 1 }
      );

      assert.strictEqual(
        result.isDuplicate,
        true,
        `"${variant}" should be detected as duplicate of "api-design"`
      );
      assert.strictEqual(result.existingValue, 'api-design');
    }
  });
});

describe('validateNoNormalizedDuplicate()', () => {
  let db: Knex;

  before(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true
    });

    await db.schema.createTable('test_scopes', (table) => {
      table.increments('id').primary();
      table.integer('project_id').notNullable();
      table.string('name', 255).notNullable();
    });

    await db('test_scopes').insert([
      { project_id: 1, name: 'database' },
      { project_id: 1, name: 'API-Gateway' }
    ]);
  });

  after(async () => {
    await db.destroy();
  });

  it('should not throw for non-duplicate value', async () => {
    await assert.doesNotReject(async () => {
      await validateNoNormalizedDuplicate(
        db,
        'test_scopes',
        'name',
        'new-scope',
        'scope',
        { project_id: 1 }
      );
    });
  });

  it('should throw for case-only duplicate', async () => {
    await assert.rejects(
      async () => {
        await validateNoNormalizedDuplicate(
          db,
          'test_scopes',
          'name',
          'Database', // vs "database"
          'scope',
          { project_id: 1 }
        );
      },
      {
        name: 'Error',
        message: /Scope "database" already exists \(case-insensitive match with "Database"\)/
      }
    );
  });

  it('should throw for naming convention duplicate', async () => {
    await assert.rejects(
      async () => {
        await validateNoNormalizedDuplicate(
          db,
          'test_scopes',
          'name',
          'api_gateway', // vs "API-Gateway"
          'scope',
          { project_id: 1 }
        );
      },
      {
        name: 'Error',
        message: /Scope "API-Gateway" already exists \(naming conflict with "api_gateway"\)/
      }
    );
  });

  it('should include entity type in error message (capitalized)', async () => {
    await assert.rejects(
      async () => {
        await validateNoNormalizedDuplicate(
          db,
          'test_scopes',
          'name',
          'DATABASE',
          'policy', // Different entity type
          { project_id: 1 }
        );
      },
      {
        name: 'Error',
        message: /Policy "database" already exists/
      }
    );
  });

  it('should respect project isolation', async () => {
    // "database" exists in project_id: 1, but we're checking project_id: 2
    await assert.doesNotReject(async () => {
      await validateNoNormalizedDuplicate(
        db,
        'test_scopes',
        'name',
        'DATABASE',
        'scope',
        { project_id: 2 }
      );
    });
  });

  it('should work without additionalWhere', async () => {
    await assert.rejects(
      async () => {
        await validateNoNormalizedDuplicate(
          db,
          'test_scopes',
          'name',
          'DATABASE',
          'scope'
        );
      },
      {
        name: 'Error',
        message: /Scope "database" already exists/
      }
    );
  });
});

describe('findNormalizedMatch()', () => {
  let db: Knex;

  interface TestLayer {
    id: number;
    project_id: number;
    name: string;
  }

  before(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true
    });

    await db.schema.createTable('test_layers', (table) => {
      table.increments('id').primary();
      table.integer('project_id').notNullable();
      table.string('name', 255).notNullable();
    });

    await db('test_layers').insert([
      { project_id: 1, name: 'presentation' },
      { project_id: 1, name: 'Business-Layer' },
      { project_id: 2, name: 'dataLayer' }
    ]);
  });

  after(async () => {
    await db.destroy();
  });

  it('should find exact match', async () => {
    const result = await findNormalizedMatch<TestLayer>(
      db,
      'test_layers',
      'name',
      'presentation',
      { project_id: 1 }
    );

    assert.notStrictEqual(result, null);
    assert.strictEqual(result!.name, 'presentation');
    assert.strictEqual(result!.project_id, 1);
  });

  it('should find case-insensitive match', async () => {
    const result = await findNormalizedMatch<TestLayer>(
      db,
      'test_layers',
      'name',
      'PRESENTATION', // vs "presentation"
      { project_id: 1 }
    );

    assert.notStrictEqual(result, null);
    assert.strictEqual(result!.name, 'presentation');
  });

  it('should find naming convention match', async () => {
    const result = await findNormalizedMatch<TestLayer>(
      db,
      'test_layers',
      'name',
      'business_layer', // vs "Business-Layer"
      { project_id: 1 }
    );

    assert.notStrictEqual(result, null);
    assert.strictEqual(result!.name, 'Business-Layer');
  });

  it('should find camelCase match', async () => {
    const result = await findNormalizedMatch<TestLayer>(
      db,
      'test_layers',
      'name',
      'data-layer', // vs "dataLayer"
      { project_id: 2 }
    );

    assert.notStrictEqual(result, null);
    assert.strictEqual(result!.name, 'dataLayer');
    assert.strictEqual(result!.project_id, 2);
  });

  it('should return null for non-existing value', async () => {
    const result = await findNormalizedMatch<TestLayer>(
      db,
      'test_layers',
      'name',
      'non-existing',
      { project_id: 1 }
    );

    assert.strictEqual(result, null);
  });

  it('should respect project isolation', async () => {
    // "dataLayer" exists in project_id: 2, but not in project_id: 1
    const result = await findNormalizedMatch<TestLayer>(
      db,
      'test_layers',
      'name',
      'dataLayer',
      { project_id: 1 }
    );

    assert.strictEqual(result, null);
  });

  it('should work without additionalWhere (global search)', async () => {
    const result = await findNormalizedMatch<TestLayer>(
      db,
      'test_layers',
      'name',
      'PRESENTATION'
    );

    assert.notStrictEqual(result, null);
    assert.strictEqual(result!.name, 'presentation');
  });

  it('should return complete record with all fields', async () => {
    const result = await findNormalizedMatch<TestLayer>(
      db,
      'test_layers',
      'name',
      'business-layer',
      { project_id: 1 }
    );

    assert.notStrictEqual(result, null);
    assert.strictEqual(typeof result!.id, 'number');
    assert.strictEqual(result!.project_id, 1);
    assert.strictEqual(result!.name, 'Business-Layer');
  });
});

describe('Integration: Real-world scenarios', () => {
  let db: Knex;

  before(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true
    });

    await db.schema.createTable('test_policies', (table) => {
      table.increments('id').primary();
      table.integer('project_id').notNullable();
      table.string('name', 255).notNullable();
    });
  });

  after(async () => {
    await db.destroy();
  });

  it('should prevent duplicate policy creation with different formats', async () => {
    // Create initial policy
    await db('test_policies').insert({
      project_id: 1,
      name: 'api-design-pattern'
    });

    // Try to create duplicates with different formats
    const duplicateVariants = [
      'apiDesignPattern',
      'API_DESIGN_PATTERN',
      'api_design_pattern',
      'ApiDesignPattern'
    ];

    for (const variant of duplicateVariants) {
      await assert.rejects(
        async () => {
          await validateNoNormalizedDuplicate(
            db,
            'test_policies',
            'name',
            variant,
            'policy',
            { project_id: 1 }
          );
        },
        {
          name: 'Error',
          message: /Policy "api-design-pattern" already exists/
        },
        `Should reject duplicate: ${variant}`
      );
    }
  });

  it('should allow same name in different projects', async () => {
    // Policy exists in project_id: 1
    await assert.doesNotReject(async () => {
      await validateNoNormalizedDuplicate(
        db,
        'test_policies',
        'name',
        'apiDesignPattern', // Same normalized value, different project
        'policy',
        { project_id: 2 }
      );
    });

    // Insert should succeed
    await db('test_policies').insert({
      project_id: 2,
      name: 'apiDesignPattern'
    });
  });

  it('should find existing record regardless of format', async () => {
    interface TestPolicy {
      id: number;
      project_id: number;
      name: string;
    }

    // Original: "api-design-pattern" in project_id: 1
    const searchVariants = [
      'api-design-pattern',
      'apiDesignPattern',
      'API_DESIGN_PATTERN',
      'api_design_pattern'
    ];

    for (const variant of searchVariants) {
      const result = await findNormalizedMatch<TestPolicy>(
        db,
        'test_policies',
        'name',
        variant,
        { project_id: 1 }
      );

      assert.notStrictEqual(result, null, `Should find match for: ${variant}`);
      assert.strictEqual(result!.name, 'api-design-pattern');
      assert.strictEqual(result!.project_id, 1);
    }
  });
});
