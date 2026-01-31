import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('environment-detector', () => {
  describe('detectEnvironment', () => {
    it('should return a valid environment type', async () => {
      const { detectEnvironment } = await import('../../../utils/environment-detector.js');
      const env = detectEnvironment();

      const validEnvironments = ['windows', 'macos', 'linux', 'wsl', 'docker', 'unknown'];
      assert.ok(
        validEnvironments.includes(env),
        `Expected environment to be one of ${validEnvironments.join(', ')}, got ${env}`
      );
    });

    it('should return consistent results on multiple calls', async () => {
      const { detectEnvironment } = await import('../../../utils/environment-detector.js');
      const env1 = detectEnvironment();
      const env2 = detectEnvironment();

      assert.strictEqual(env1, env2, 'Environment detection should be deterministic');
    });

    it('should detect current platform correctly', async () => {
      const { detectEnvironment } = await import('../../../utils/environment-detector.js');
      const env = detectEnvironment();

      // On Windows (not WSL, not Docker), should return 'windows'
      if (process.platform === 'win32') {
        // Could be 'windows' or 'docker' if running in container
        assert.ok(
          env === 'windows' || env === 'docker',
          `On Windows, expected 'windows' or 'docker', got '${env}'`
        );
      }

      // On macOS, should return 'macos' or 'docker'
      if (process.platform === 'darwin') {
        assert.ok(
          env === 'macos' || env === 'docker',
          `On macOS, expected 'macos' or 'docker', got '${env}'`
        );
      }
    });
  });

  describe('getEnvironmentDisplayName', () => {
    it('should return human-readable names', async () => {
      const { getEnvironmentDisplayName } = await import('../../../utils/environment-detector.js');

      assert.strictEqual(getEnvironmentDisplayName('windows'), 'Windows');
      assert.strictEqual(getEnvironmentDisplayName('macos'), 'macOS');
      assert.strictEqual(getEnvironmentDisplayName('linux'), 'Linux');
      assert.strictEqual(getEnvironmentDisplayName('wsl'), 'WSL');
      assert.strictEqual(getEnvironmentDisplayName('docker'), 'Docker');
      assert.strictEqual(getEnvironmentDisplayName('unknown'), 'Unknown');
    });
  });
});
