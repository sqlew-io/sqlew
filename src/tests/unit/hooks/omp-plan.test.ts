/**
 * omp plan materialize helpers unit tests
 *
 * @since v5.4.0
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  extractSlugFromOmpPlanPath,
  materializeOmpPlan,
  ensureOmpPlanTemplate,
  ompPlansDir,
} from '../../../cli/hooks/omp-plan.js';
import { isOmpPlanPath } from '../../../cli/hooks/stdin-parser.js';
import { loadCurrentPlan, saveCurrentPlan } from '../../../config/global-config.js';
import { PLAN_TEMPLATE_MARKER } from '../../../cli/hooks/grok-plan-template.js';

let testProjectPath: string;

describe('omp-plan helpers', () => {
  beforeEach(() => {
    testProjectPath = join(
      tmpdir(),
      `sqlew-omp-plan-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testProjectPath, { recursive: true });
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

  describe('materializeOmpPlan', () => {
    it('writes file and CurrentPlanInfo with absolute plan_path', () => {
      const content = '# demo\n';
      const { planPath, planInfo } = materializeOmpPlan({
        projectPath: testProjectPath,
        slug: 'demo',
        content,
      });

      assert.ok(existsSync(planPath));
      assert.equal(readFileSync(planPath, 'utf-8'), content);
      assert.ok(planPath.replace(/\\/g, '/').endsWith('.sqlew/plans/demo-plan.md'));

      const loaded = loadCurrentPlan(testProjectPath);
      assert.ok(loaded);
      assert.equal(loaded.plan_file, 'demo-plan.md');
      assert.equal(loaded.plan_path?.replace(/\\/g, '/'), planPath.replace(/\\/g, '/'));
      assert.equal(loaded.recorded, false);
      assert.equal(loaded.decision_pending, true);
      assert.equal(planInfo.plan_id, loaded.plan_id);
      assert.ok(existsSync(ompPlansDir(testProjectPath)));
    });

    it('keeps recorded when content hash unchanged', () => {
      const content = '# same\n';
      const first = materializeOmpPlan({
        projectPath: testProjectPath,
        slug: 'same',
        content,
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
      });
      assert.equal(second.planInfo.recorded, true);
      assert.equal(second.planInfo.plan_id, first.planInfo.plan_id);
    });

    it('resets recorded when content changes', () => {
      const first = materializeOmpPlan({
        projectPath: testProjectPath,
        slug: 'rev',
        content: '# v1\n',
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
      });
      assert.equal(second.planInfo.recorded, false);
      assert.equal(second.planInfo.decision_pending, true);
    });
  });
});
