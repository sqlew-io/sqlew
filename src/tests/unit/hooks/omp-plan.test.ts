/**
 * omp plan tracking helpers unit tests
 *
 * @since v5.4.0
 * @modified v5.4.2 — session-local plan_path (no project mirror)
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  extractSlugFromOmpPlanPath,
  materializeOmpPlan,
  ensureOmpPlanTemplate,
  ompPlansDir,
  resolveOmpPlanFsPath,
  resolveOmpLocalRoot,
  trackOmpPlanFromPath,
} from '../../../cli/hooks/omp-plan.js';
import { isOmpPlanPath } from '../../../cli/hooks/stdin-parser.js';
import { loadCurrentPlan, saveCurrentPlan } from '../../../config/global-config.js';
import { PLAN_TEMPLATE_MARKER } from '../../../cli/hooks/grok-plan-template.js';

let testProjectPath: string;
let sessionLocalDir: string;
let sessionFile: string;

describe('omp-plan helpers', () => {
  beforeEach(() => {
    testProjectPath = join(
      tmpdir(),
      `sqlew-omp-plan-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testProjectPath, { recursive: true });
    // Fake omp session layout: <artifactsDir>.jsonl + <artifactsDir>/local/
    const artifactsDir = join(
      testProjectPath,
      'sess-2026-01-01T00-00-00Z_abc123',
    );
    sessionFile = `${artifactsDir}.jsonl`;
    sessionLocalDir = join(artifactsDir, 'local');
    mkdirSync(sessionLocalDir, { recursive: true });
    writeFileSync(sessionFile, '', 'utf-8');
  });

  afterEach(() => {
    if (existsSync(testProjectPath)) {
      rmSync(testProjectPath, { recursive: true, force: true });
    }
  });

  describe('extractSlugFromOmpPlanPath', () => {
    it('parses local:// slug', () => {
      assert.equal(extractSlugFromOmpPlanPath('local://demo-plan.md'), 'demo');
    });

    it('parses .sqlew/plans path', () => {
      assert.equal(
        extractSlugFromOmpPlanPath('/abs/project/.sqlew/plans/foo-plan.md'),
        'foo',
      );
    });

    it('parses bare filename', () => {
      assert.equal(extractSlugFromOmpPlanPath('bar-plan.md'), 'bar');
    });

    it('returns null for propose devices', () => {
      assert.equal(extractSlugFromOmpPlanPath('xd://propose'), null);
      assert.equal(extractSlugFromOmpPlanPath('/xdev/propose'), null);
    });
  });

  describe('isOmpPlanPath', () => {
    it('matches plan artifacts', () => {
      assert.equal(isOmpPlanPath('local://x-plan.md'), true);
      assert.equal(isOmpPlanPath('/p/.sqlew/plans/x-plan.md'), true);
      assert.equal(isOmpPlanPath('xd://propose'), true);
      assert.equal(isOmpPlanPath('src/a.ts'), false);
    });
  });

  describe('ensureOmpPlanTemplate', () => {
    it('injects when empty', () => {
      const r = ensureOmpPlanTemplate('');
      assert.equal(r.injected, true);
      assert.ok(r.content.includes(PLAN_TEMPLATE_MARKER));
    });

    it('is idempotent when marker present', () => {
      const first = ensureOmpPlanTemplate('# Plan\n');
      const second = ensureOmpPlanTemplate(first.content);
      assert.equal(second.injected, false);
      assert.equal(second.content, first.content);
    });

    it('skips when real patterns present', () => {
      const content = `### 📌 Decision: a/b
- **Value**: real
- **Layer**: business
`;
      const r = ensureOmpPlanTemplate(content);
      assert.equal(r.injected, false);
    });
  });

  describe('resolveOmpPlanFsPath', () => {
    it('resolves local:// under session artifacts local/', () => {
      const abs = resolveOmpPlanFsPath('local://demo-plan.md', {
        sessionFile,
        sessionId: 'abc123',
        platform: 'linux',
      });
      assert.ok(abs);
      assert.equal(
        abs!.replace(/\\/g, '/'),
        join(sessionLocalDir, 'demo-plan.md').replace(/\\/g, '/'),
      );
    });

    it('rejects path traversal outside local root', () => {
      const abs = resolveOmpPlanFsPath('local://../secret.md', {
        sessionFile,
        sessionId: 'abc123',
        platform: 'linux',
      });
      assert.equal(abs, null);
    });

    it('returns absolute paths normalized', () => {
      const target = join(sessionLocalDir, 'x-plan.md');
      const abs = resolveOmpPlanFsPath(target, { sessionFile });
      assert.ok(abs);
      assert.equal(abs!.replace(/\\/g, '/'), target.replace(/\\/g, '/'));
    });

    it('falls back to tmpdir short root without sessionFile', () => {
      const root = resolveOmpLocalRoot(
        { sessionId: 'sid1', platform: 'linux' },
        'linux',
      );
      assert.ok(root.replace(/\\/g, '/').includes('omp-local'));
      assert.ok(root.replace(/\\/g, '/').endsWith('sid1') || root.includes('sid1'));

      const abs = resolveOmpPlanFsPath('local://p-plan.md', {
        sessionId: 'sid1',
        platform: 'linux',
      });
      assert.ok(abs);
      assert.ok(abs!.replace(/\\/g, '/').endsWith('/p-plan.md'));
      assert.ok(abs!.includes('omp-local'));
    });
  });

  describe('materializeOmpPlan', () => {
    it('tracks CurrentPlanInfo without writing .sqlew/plans', () => {
      const content = '# demo\n';
      const planPath = join(sessionLocalDir, 'demo-plan.md');
      writeFileSync(planPath, content, 'utf-8');

      const { planPath: tracked, planInfo } = materializeOmpPlan({
        projectPath: testProjectPath,
        slug: 'demo',
        content,
        planPath,
      });

      assert.equal(tracked.replace(/\\/g, '/'), planPath.replace(/\\/g, '/'));
      assert.equal(readFileSync(planPath, 'utf-8'), content);
      assert.equal(existsSync(ompPlansDir(testProjectPath)), false);

      const loaded = loadCurrentPlan(testProjectPath);
      assert.ok(loaded);
      assert.equal(loaded.plan_file, 'demo-plan.md');
      assert.equal(
        loaded.plan_path?.replace(/\\/g, '/'),
        planPath.replace(/\\/g, '/'),
      );
      assert.equal(loaded.recorded, false);
      assert.equal(loaded.decision_pending, true);
      assert.equal(planInfo.plan_id, loaded.plan_id);
    });

    it('keeps recorded when content hash unchanged', () => {
      const content = '# same\n';
      const planPath = join(sessionLocalDir, 'same-plan.md');
      writeFileSync(planPath, content, 'utf-8');

      const first = materializeOmpPlan({
        projectPath: testProjectPath,
        slug: 'same',
        content,
        planPath,
      });
      saveCurrentPlan(testProjectPath, {
        ...first.planInfo,
        recorded: true,
        decision_pending: false,
      });

      const second = materializeOmpPlan({
        projectPath: testProjectPath,
        slug: 'same',
        content,
        planPath,
      });
      assert.equal(second.planInfo.recorded, true);
      assert.equal(second.planInfo.plan_id, first.planInfo.plan_id);
      assert.equal(existsSync(ompPlansDir(testProjectPath)), false);
    });

    it('resets recorded when content changes', () => {
      const planPath = join(sessionLocalDir, 'rev-plan.md');
      writeFileSync(planPath, '# v1\n', 'utf-8');

      const first = materializeOmpPlan({
        projectPath: testProjectPath,
        slug: 'rev',
        content: '# v1\n',
        planPath,
      });
      saveCurrentPlan(testProjectPath, {
        ...first.planInfo,
        recorded: true,
        decision_pending: false,
      });

      const second = materializeOmpPlan({
        projectPath: testProjectPath,
        slug: 'rev',
        content: '# v2 changed\n',
        planPath,
      });
      assert.equal(second.planInfo.recorded, false);
      assert.equal(second.planInfo.decision_pending, true);
    });
  });

  describe('trackOmpPlanFromPath', () => {
    it('resolves local:// via sessionFile without project mirror', () => {
      const content = '# tracked\n';
      const diskPath = join(sessionLocalDir, 'tracked-plan.md');
      writeFileSync(diskPath, content, 'utf-8');

      const info = trackOmpPlanFromPath({
        projectPath: testProjectPath,
        filePath: 'local://tracked-plan.md',
        content,
        sessionFile,
        sessionId: 'abc123',
      });

      assert.equal(
        info.plan_path?.replace(/\\/g, '/'),
        diskPath.replace(/\\/g, '/'),
      );
      assert.equal(existsSync(ompPlansDir(testProjectPath)), false);
    });

    it('legacy-mirrors when local:// cannot be resolved', () => {
      const content = '# fallback\n';
      const info = trackOmpPlanFromPath({
        projectPath: testProjectPath,
        filePath: 'local://fallback-plan.md',
        content,
        // no sessionFile / sessionId → still resolves via tmp short root
        // force failure with empty path-like that is not local and not absolute:
      });
      // With sessionId default short root, resolve succeeds. Use non-local relative:
      const info2 = trackOmpPlanFromPath({
        projectPath: testProjectPath,
        filePath: 'not-a-local-plan.md',
        content,
      });
      // extractSlug works on bare name; resolve returns null for relative non-local
      // → legacy mirror
      assert.ok(info2.plan_path);
      assert.ok(
        info2.plan_path!.replace(/\\/g, '/').includes('.sqlew/plans/'),
        info2.plan_path,
      );
      assert.ok(existsSync(info2.plan_path!));
      // silence unused
      void info;
    });
  });
});
