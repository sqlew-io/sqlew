import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  enhanceDriverLoadError,
  isMissingModuleError,
  isNativeBindingError,
  withDriverLoadError,
} from '../../../utils/driver-error.js';

describe('driver-error', () => {
  it('detects MODULE_NOT_FOUND errors', () => {
    const err = new Error("Cannot find module 'pg'") as NodeJS.ErrnoException;
    err.code = 'MODULE_NOT_FOUND';
    assert.equal(isMissingModuleError(err), true);
    assert.equal(isMissingModuleError(new Error('connection refused')), false);
  });

  it('detects better-sqlite3 native binding failures', () => {
    const bindingsErr = new Error(
      'Could not locate the bindings file. Tried:\n → C:\\Users\\kitayama\\AppData\\Roaming\\nvm\\v24.19.0\\node_modules\\sqlew\\node_modules\\better-sqlite3\\lib\\binding\\node-v137-win32-x64\\better_sqlite3.node'
    );
    assert.equal(isNativeBindingError(bindingsErr), true);
    assert.equal(isNativeBindingError(new Error('ECONNREFUSED')), false);

    const abiErr = new Error(
      'The module was compiled against a different Node.js version using NODE_MODULE_VERSION 127.'
    );
    assert.equal(isNativeBindingError(abiErr), true);
  });

  it('enhances missing pg driver with scoped package hint', () => {
    const err = new Error("Cannot find module 'pg'") as NodeJS.ErrnoException;
    err.code = 'MODULE_NOT_FOUND';
    const enhanced = enhanceDriverLoadError(err, 'pg') as Error;
    assert.match(enhanced.message, /@sqlew\/pg/);
    assert.match(enhanced.message, /sqlew/);
    assert.equal(enhanced.cause, err);
  });

  it('enhances Windows Node 24 better-sqlite3 bindings miss with allow-scripts hint', () => {
    const err = new Error(
      'Could not locate the bindings file. Tried:\n → ...\\node-v137-win32-x64\\better_sqlite3.node'
    );
    const enhanced = enhanceDriverLoadError(err, 'better-sqlite3') as Error;
    assert.match(enhanced.message, /allow-scripts=better-sqlite3/);
    assert.match(enhanced.message, /@sqlew\/pg/);
    assert.match(enhanced.message, /Node 22/);
    assert.equal(enhanced.cause, err);
  });

  it('does not rewrite native binding errors for non-sqlite clients', () => {
    const err = new Error('Could not locate the bindings file');
    assert.equal(enhanceDriverLoadError(err, 'pg'), err);
  });

  it('passes through unrelated errors', () => {
    const err = new Error('ECONNREFUSED');
    assert.equal(enhanceDriverLoadError(err, 'pg'), err);
  });

  it('withDriverLoadError wraps thrown missing-module errors', () => {
    assert.throws(
      () =>
        withDriverLoadError('mysql2', () => {
          const err = new Error("Cannot find package 'mysql2'") as NodeJS.ErrnoException;
          err.code = 'ERR_MODULE_NOT_FOUND';
          throw err;
        }),
      /@sqlew\/mysql/
    );
  });

  it('withDriverLoadError wraps sqlite native binding errors', () => {
    assert.throws(
      () =>
        withDriverLoadError('better-sqlite3', () => {
          throw new Error('Could not locate the bindings file. Tried:\n → better_sqlite3.node');
        }),
      /allow-scripts=better-sqlite3/
    );
  });
});
