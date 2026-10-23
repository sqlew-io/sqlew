import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  enhanceDriverLoadError,
  isMissingModuleError,
  withDriverLoadError,
} from '../../../utils/driver-error.js';

describe('driver-error', () => {
  it('detects MODULE_NOT_FOUND errors', () => {
    const err = new Error("Cannot find module 'pg'") as NodeJS.ErrnoException;
    err.code = 'MODULE_NOT_FOUND';
    assert.equal(isMissingModuleError(err), true);
    assert.equal(isMissingModuleError(new Error('connection refused')), false);
  });

  it('enhances missing pg driver with scoped package hint', () => {
    const err = new Error("Cannot find module 'pg'") as NodeJS.ErrnoException;
    err.code = 'MODULE_NOT_FOUND';
    const enhanced = enhanceDriverLoadError(err, 'pg') as Error;
    assert.match(enhanced.message, /@sqlew\/pg/);
    assert.match(enhanced.message, /sqlew/);
    assert.equal(enhanced.cause, err);
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
});
