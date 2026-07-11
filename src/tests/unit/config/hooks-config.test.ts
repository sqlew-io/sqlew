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

    it('should accept grok_require_patterns true/false', () => {
      assert.strictEqual(
        validateConfig({
          ...DEFAULT_CONFIG,
          hooks: { grok_require_patterns: false },
        }).valid,
        true,
      );
      assert.strictEqual(
        validateConfig({
          ...DEFAULT_CONFIG,
          hooks: { grok_require_patterns: true },
        }).valid,
        true,
      );
    });

    it('should reject non-boolean grok_require_patterns', () => {
      const result = validateConfig({
        ...DEFAULT_CONFIG,
        hooks: { grok_require_patterns: 'yes' as unknown as boolean },
      });
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('grok_require_patterns')));
    });
  });

  describe('loadConfigFile grok_require_patterns', () => {
    it('should merge grok_require_patterns from file', () => {
      writeFileSync(
        TEST_CONFIG_PATH,
        `[hooks]\ngrok_require_patterns = false\n`,
        'utf-8',
      );
      const config = loadConfigFile(TEST_DIR, 'config.toml');
      assert.strictEqual(config.hooks?.grok_require_patterns, false);
    });

    it('should default grok_require_patterns to true', () => {
      writeFileSync(TEST_CONFIG_PATH, `[database]\npath = ".sqlew/test.db"\n`, 'utf-8');
      const config = loadConfigFile(TEST_DIR, 'config.toml');
      assert.strictEqual(config.hooks?.grok_require_patterns, true);
    });
  });
});