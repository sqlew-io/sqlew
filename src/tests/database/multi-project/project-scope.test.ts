/**
 * Desktop AI agent project resolution tests (v5.4)
 *
 * Covers:
 * - resolveProjectScope: root (create), name (find / not-found), ref, collision
 * - AsyncLocalStorage request-scope isolation (concurrency-safe project switch)
 * - P0 unbound guard: fail-closed writes, help allowed, recovery via _sqlew_project
 * - Per-call project targeting end-to-end through LocalBackend.execute
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { initializeDatabase, closeDatabase, getAdapter } from '../../../database.js';
import type { DatabaseAdapter } from '../../../adapters/types.js';
import {
  ProjectContext,
  getProjectContext,
  runWithProjectScope,
} from '../../../utils/project-context.js';
import {
  resolveProjectScope,
  makeProjectRef,
} from '../../../utils/project-scope-resolver.js';
import { LocalBackend } from '../../../backend/local-backend.js';

let testDb: DatabaseAdapter;
let tempDir: string;
let tempDbPath: string;

/** Parse a JSON-encoded sqlew error thrown as an Error message. */
function parseError(error: unknown): { error?: string; message?: string } {
  const msg = error instanceof Error ? error.message : String(error);
  try {
    return JSON.parse(msg);
  } catch {
    return { message: msg };
  }
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlew-scope-'));
  tempDbPath = path.join(tempDir, 'test.db');
  testDb = await initializeDatabase({ connection: { filename: tempDbPath } });
});

afterEach(async () => {
  ProjectContext.reset();
  await closeDatabase();
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('resolveProjectScope', () => {
  it('creates a project from a root path on write', async () => {
    const repo = fs.mkdtempSync(path.join(tempDir, 'repo-'));
    const meta = await resolveProjectScope({ root: repo }, { forWrite: true });
    assert.ok(meta.id > 0);
    assert.strictEqual(meta.name, path.basename(repo));
    assert.ok(meta.project_root_path);
  });

  it('finds an existing project by name', async () => {
    const repo = fs.mkdtempSync(path.join(tempDir, 'repo-'));
    const created = await resolveProjectScope({ root: repo }, { forWrite: true });
    const found = await resolveProjectScope({ name: created.name }, { forWrite: false });
    assert.strictEqual(found.id, created.id);
  });

  it('errors on read when a name does not exist', async () => {
    await assert.rejects(
      () => resolveProjectScope({ name: 'does-not-exist' }, { forWrite: false }),
      (err: unknown) => parseError(err).error === 'SQLEW_PROJECT_NOT_FOUND'
    );
  });

  it('resolves by ref', async () => {
    const repo = fs.mkdtempSync(path.join(tempDir, 'repo-'));
    const created = await resolveProjectScope({ root: repo }, { forWrite: true });
    const byRef = await resolveProjectScope(
      { ref: makeProjectRef(created.id) },
      { forWrite: false }
    );
    assert.strictEqual(byRef.id, created.id);
  });

  it('rejects a name collision (same name, different root) on write', async () => {
    const knex = getAdapter().getKnex();
    const now = Math.floor(Date.now() / 1000);
    // Pre-register a project named "myproj" rooted elsewhere.
    await knex('m_projects').insert({
      name: 'myproj',
      display_name: 'myproj',
      detection_source: 'config',
      project_root_path: '/somewhere/else/myproj',
      created_ts: now,
      last_active_ts: now,
      metadata: null,
    });
    // A different directory whose basename is also "myproj".
    const repo = path.join(tempDir, 'myproj');
    fs.mkdirSync(repo);

    await assert.rejects(
      () => resolveProjectScope({ root: repo }, { forWrite: true }),
      (err: unknown) => parseError(err).error === 'SQLEW_PROJECT_NAME_COLLISION'
    );
  });
});

describe('AsyncLocalStorage request-scope isolation', () => {
  it('keeps concurrent scopes from cross-contaminating', async () => {
    const ctxA = ProjectContext.createScoped({
      id: 101, name: 'alpha', detection_source: 'metadata',
    });
    const ctxB = ProjectContext.createScoped({
      id: 202, name: 'beta', detection_source: 'metadata',
    });

    const [a, b] = await Promise.all([
      runWithProjectScope(ctxA, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getProjectContext().getProjectId();
      }),
      runWithProjectScope(ctxB, async () => {
        return getProjectContext().getProjectId();
      }),
    ]);

    assert.strictEqual(a, 101);
    assert.strictEqual(b, 202);
  });

  it('falls back to the singleton when no scope is active', async () => {
    const knex = getAdapter().getKnex();
    await ProjectContext.getInstance().ensureProject(knex, 'singleton-proj', 'config');
    assert.strictEqual(getProjectContext().getProjectName(), 'singleton-proj');
  });
});

describe('P0 unbound guard (LocalBackend.execute)', () => {
  let backend: LocalBackend;

  beforeEach(() => {
    backend = new LocalBackend();
    ProjectContext.getInstance().markUnbound('test: ambiguous launch directory');
  });

  it('fails closed on a project-scoped write', async () => {
    await assert.rejects(
      () => backend.execute('decision', 'set', { key: 'k', value: 'v' }),
      (err: unknown) => parseError(err).error === 'SQLEW_PROJECT_REQUIRED'
    );
  });

  it('allows help even when unbound', async () => {
    const result = await backend.execute('decision', 'help', {});
    assert.ok(result, 'help should return content while unbound');
  });

  it('allows the project tool even when unbound', async () => {
    const result = (await backend.execute('project', 'current', {})) as { bound: boolean };
    assert.strictEqual(result.bound, false);
  });

  it('recovers with an explicit _sqlew_project', async () => {
    const repo = fs.mkdtempSync(path.join(tempDir, 'repo-'));
    const result = (await backend.execute('decision', 'set', {
      key: 'auth/method',
      value: 'JWT',
      _sqlew_project: { root: repo },
    })) as { success?: boolean };
    assert.ok(result, 'scoped write should succeed');

    // The decision must be readable from the same targeted project.
    const listed = (await backend.execute('decision', 'list', {
      _sqlew_project: { root: repo },
    })) as { decisions: Array<{ value: string }>; count: number };
    assert.strictEqual(listed.count, 1);
    assert.strictEqual(listed.decisions[0].value, 'JWT');
  });
});

describe('project tool', () => {
  it('resolve returns a reusable ref and usage hint', async () => {
    const backend = new LocalBackend();
    const repo = fs.mkdtempSync(path.join(tempDir, 'repo-'));
    const result = (await backend.execute('project', 'resolve', { root: repo })) as {
      project: { id: number; ref: string };
      usage: { _sqlew_project: { ref: string } };
    };
    assert.ok(result.project.id > 0);
    assert.match(result.project.ref, /^sqlew_proj_\d+$/);
    assert.strictEqual(result.usage._sqlew_project.ref, result.project.ref);
  });

  it('list returns registered projects', async () => {
    const backend = new LocalBackend();
    const repo = fs.mkdtempSync(path.join(tempDir, 'repo-'));
    await backend.execute('project', 'resolve', { root: repo });
    const listed = (await backend.execute('project', 'list', {})) as { count: number };
    assert.ok(listed.count >= 1);
  });

  it('validate reports ok/false without creating', async () => {
    const backend = new LocalBackend();
    const ok = (await backend.execute('project', 'validate', { name: 'never-registered' })) as {
      ok: boolean; error?: string;
    };
    assert.strictEqual(ok.ok, false);
    assert.strictEqual(ok.error, 'SQLEW_PROJECT_NOT_FOUND');
  });

  it('help loads from project.toml (guards the loader tool list)', async () => {
    const backend = new LocalBackend();
    const help = (await backend.execute('project', 'help', {})) as { tool?: string };
    assert.strictEqual(help.tool, 'project');
  });
});

describe('Per-call project targeting (bound singleton)', () => {
  it('routes a write to the _sqlew_project, not the singleton project', async () => {
    const knex = getAdapter().getKnex();
    await ProjectContext.getInstance().ensureProject(knex, 'home-proj', 'config');

    const backend = new LocalBackend();
    const repo = fs.mkdtempSync(path.join(tempDir, 'repo-'));

    // Write targeting a different project via root.
    await backend.execute('decision', 'set', {
      key: 'db/engine',
      value: 'PostgreSQL',
      _sqlew_project: { root: repo },
    });

    // Singleton project should have no decisions.
    const home = (await backend.execute('decision', 'list', {})) as { count: number };
    assert.strictEqual(home.count, 0);

    // Targeted project should have exactly one.
    const targeted = (await backend.execute('decision', 'list', {
      _sqlew_project: { root: repo },
    })) as { count: number; decisions: Array<{ value: string }> };
    assert.strictEqual(targeted.count, 1);
    assert.strictEqual(targeted.decisions[0].value, 'PostgreSQL');
  });
});
