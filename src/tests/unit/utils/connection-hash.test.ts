import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  generateConnectionHash,
  getShortConnectionHash,
} from '../../../utils/connection-hash.js';

describe('connection-hash', () => {
  describe('generateConnectionHash', () => {
    it('should generate a 43-character Base64URL hash', () => {
      const hash = generateConnectionHash(
        'sk_test_key',
        'proj_123',
        'C:\\Users\\dev\\my-app'
      );

      // SHA256 in Base64URL is 43 chars (without padding)
      assert.strictEqual(hash.length, 43);
    });

    it('should generate consistent hashes for same input', () => {
      const hash1 = generateConnectionHash(
        'sk_test_key',
        'proj_123',
        'C:\\Users\\dev\\my-app'
      );
      const hash2 = generateConnectionHash(
        'sk_test_key',
        'proj_123',
        'C:\\Users\\dev\\my-app'
      );

      assert.strictEqual(hash1, hash2);
    });

    it('should generate different hashes for different paths', () => {
      const hash1 = generateConnectionHash(
        'sk_test_key',
        'proj_123',
        'C:\\Users\\dev\\app1'
      );
      const hash2 = generateConnectionHash(
        'sk_test_key',
        'proj_123',
        'C:\\Users\\dev\\app2'
      );

      assert.notStrictEqual(hash1, hash2);
    });

    it('should generate different hashes for different API keys', () => {
      const hash1 = generateConnectionHash(
        'sk_key_1',
        'proj_123',
        'C:\\Users\\dev\\my-app'
      );
      const hash2 = generateConnectionHash(
        'sk_key_2',
        'proj_123',
        'C:\\Users\\dev\\my-app'
      );

      assert.notStrictEqual(hash1, hash2);
    });

    it('should generate different hashes for different project IDs', () => {
      const hash1 = generateConnectionHash(
        'sk_test_key',
        'proj_1',
        'C:\\Users\\dev\\my-app'
      );
      const hash2 = generateConnectionHash(
        'sk_test_key',
        'proj_2',
        'C:\\Users\\dev\\my-app'
      );

      assert.notStrictEqual(hash1, hash2);
    });

    it('should handle undefined projectId', () => {
      const hash1 = generateConnectionHash(
        'sk_test_key',
        undefined,
        'C:\\Users\\dev\\my-app'
      );
      const hash2 = generateConnectionHash(
        'sk_test_key',
        undefined,
        'C:\\Users\\dev\\my-app'
      );

      assert.strictEqual(hash1, hash2);
      assert.strictEqual(hash1.length, 43);
    });

    it('should normalize Windows and Unix paths to same hash', () => {
      const hashWindows = generateConnectionHash(
        'sk_test_key',
        'proj_123',
        'C:\\Users\\dev\\my-app'
      );
      const hashUnix = generateConnectionHash(
        'sk_test_key',
        'proj_123',
        'C:/Users/dev/my-app'
      );

      assert.strictEqual(hashWindows, hashUnix);
    });

    it('should produce URL-safe characters only', () => {
      const hash = generateConnectionHash(
        'sk_test_key',
        'proj_123',
        'C:\\Users\\dev\\my-app'
      );

      // Base64URL uses only alphanumeric, hyphen, and underscore
      assert.match(hash, /^[A-Za-z0-9_-]+$/);
    });
  });

  describe('getShortConnectionHash', () => {
    it('should return first 12 characters', () => {
      const fullHash = generateConnectionHash(
        'sk_test_key',
        'proj_123',
        'C:\\Users\\dev\\my-app'
      );
      const shortHash = getShortConnectionHash(fullHash);

      assert.strictEqual(shortHash.length, 12);
      assert.strictEqual(shortHash, fullHash.slice(0, 12));
    });
  });
});
