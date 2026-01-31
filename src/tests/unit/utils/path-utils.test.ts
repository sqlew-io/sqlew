import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  extractPathSuffix,
  normalizePathForHash,
  getProjectRoot,
} from '../../../utils/path-utils.js';

describe('path-utils', () => {
  describe('extractPathSuffix', () => {
    it('should extract last two segments from Windows path', () => {
      const result = extractPathSuffix('C:\\Users\\kitayama\\RustroverProjects\\my-app');
      assert.strictEqual(result, 'RustroverProjects/my-app');
    });

    it('should extract last two segments from Unix path', () => {
      const result = extractPathSuffix('/home/user/projects/my-app');
      assert.strictEqual(result, 'projects/my-app');
    });

    it('should handle single segment', () => {
      const result = extractPathSuffix('/single');
      assert.strictEqual(result, 'single');
    });

    it('should handle empty path', () => {
      const result = extractPathSuffix('');
      assert.strictEqual(result, '');
    });

    it('should handle trailing slash', () => {
      const result = extractPathSuffix('C:\\Users\\dev\\my-app\\');
      assert.strictEqual(result, 'dev/my-app');
    });

    it('should handle mixed separators', () => {
      const result = extractPathSuffix('C:/Users\\dev/my-app');
      assert.strictEqual(result, 'dev/my-app');
    });

    it('should output forward slashes regardless of input', () => {
      const result = extractPathSuffix('C:\\Parent\\Child');
      assert.ok(!result.includes('\\'), 'Should not contain backslashes');
      assert.strictEqual(result, 'Parent/Child');
    });
  });

  describe('normalizePathForHash', () => {
    it('should convert backslashes to forward slashes', () => {
      const result = normalizePathForHash('C:\\Users\\dev\\my-app');
      assert.strictEqual(result, 'c:/users/dev/my-app');
    });

    it('should convert to lowercase', () => {
      const result = normalizePathForHash('/Home/User/MyApp');
      assert.strictEqual(result, '/home/user/myapp');
    });

    it('should remove trailing slash', () => {
      const result = normalizePathForHash('/home/user/app/');
      assert.strictEqual(result, '/home/user/app');
    });

    it('should preserve root slash only', () => {
      const result = normalizePathForHash('/');
      assert.strictEqual(result, '/');
    });

    it('should produce consistent results for equivalent paths', () => {
      const paths = [
        'C:\\Users\\Dev\\MyApp',
        'C:/Users/Dev/MyApp',
        'c:\\users\\dev\\myapp',
        'c:/users/dev/myapp/',
      ];

      const normalized = paths.map(normalizePathForHash);
      const unique = new Set(normalized);

      assert.strictEqual(unique.size, 1, 'All paths should normalize to the same value');
    });
  });

  describe('getProjectRoot', () => {
    it('should return current working directory', () => {
      const result = getProjectRoot();
      assert.strictEqual(result, process.cwd());
    });
  });
});
