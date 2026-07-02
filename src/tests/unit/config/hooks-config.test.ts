/**
 * Hooks configuration unit tests
 *
 * @since v5.4.0
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { loadConfigFile, validateConfig } from '../../../config/loader.js';
import { DEFAULT_CONFIG, DEFAULT_SESSION_CONTEXT_BUDGET } from '../../../config/types.js';

const TEST_DIR = join(process.cwd(), '.sqlew-test-hooks');
const TEST_CONFIG_PATH = join(TEST_DIR, 'config.toml');

describe('hooks-config', () => {
  before(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  after(() => {
    if (existsSync(TEST_CONFIG_PATH)) {
      unlinkSync(TEST_CONFIG_PATH);
    }
  });

  describe('loadConfigFile', () => {
    it('should merge [hooks] section with defaults', () => {
      writeFileSync(
        TEST_CONFIG_PATH,
        `[hooks]\nsession_context_budget = 250\n`,
        'utf-8',
      );
      const config = loadConfigFile(TEST_DIR, 'config.toml');
      assert.strictEqual(config.hooks?.session_context_budget, 250);
    });

    it('should apply default session_context_budget when [hooks] is absent', () => {
      writeFileSync(TEST_CONFIG_PATH, `[database]\npath = ".sqlew/test.db"\n`, 'utf-8');
      const config = loadConfigFile(TEST_DIR, 'config.toml');
      assert.strictEqual(
        config.hooks?.session_context_budget,
        DEFAULT_SESSION_CONTEXT_BUDGET,
      );
    });
  });

  describe('validateConfig', () => {
    it('should accept budget 0 (disabled)', () => {
      const result = validateConfig({
        ...DEFAULT_CONFIG,
        hooks: { session_context_budget: 0 },
      });
      assert.strictEqual(result.valid, true);
    });

    it('should accept default budget 500', () => {
      const result = validateConfig({
        ...DEFAULT_CONFIG,
        hooks: { session_context_budget: 500 },
      });
      assert.strictEqual(result.valid, true);
    });

    it('should reject budget -1', () => {
      const result = validateConfig({
        ...DEFAULT_CONFIG,
        hooks: { session_context_budget: -1 },
      });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('session_context_budget')));
    });

    it('should reject budget 10001', () => {
      const result = validateConfig({
        ...DEFAULT_CONFIG,
        hooks: { session_context_budget: 10001 },
      });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('session_context_budget')));
    });

    it('should reject non-integer budget', () => {
      const result = validateConfig({
        ...DEFAULT_CONFIG,
        hooks: { session_context_budget: 250.5 },
      });
      assert.strictEqual(result.valid, false);
    });
  });
});