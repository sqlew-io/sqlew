/**
 * Grok Build plan.md template injection unit tests
 *
 * @since v5.2.0
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  injectGrokPlanTemplate,
  PLAN_TEMPLATE_MARKER,
} from '../../../cli/hooks/track-plan.js';

describe('injectGrokPlanTemplate', () => {
  let testDir: string;
  let planPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `sqlew-grok-plan-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    planPath = join(testDir, 'plan.md');
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should create plan.md with template when file does not exist', () => {
    const injected = injectGrokPlanTemplate(planPath);
    assert.strictEqual(injected, true);
    assert.ok(existsSync(planPath));
    const content = readFileSync(planPath, 'utf-8');
    assert.ok(content.includes(PLAN_TEMPLATE_MARKER));
    assert.ok(content.includes('### 📌 Decision:'));
    assert.ok(content.includes('### 🚫 Constraint:'));
  });

  it('should append template when plan exists without marker or patterns', () => {
    writeFileSync(planPath, '# My Plan\n\nSome content.\n', 'utf-8');
    const injected = injectGrokPlanTemplate(planPath);
    assert.strictEqual(injected, true);
    const content = readFileSync(planPath, 'utf-8');
    assert.ok(content.startsWith('# My Plan'));
    assert.ok(content.includes(PLAN_TEMPLATE_MARKER));
  });

  it('should skip when template marker already present', () => {
    writeFileSync(planPath, `# Plan\n\n${PLAN_TEMPLATE_MARKER}\n`, 'utf-8');
    const injected = injectGrokPlanTemplate(planPath);
    assert.strictEqual(injected, false);
    const content = readFileSync(planPath, 'utf-8');
    assert.strictEqual((content.match(new RegExp(PLAN_TEMPLATE_MARKER, 'g')) || []).length, 1);
  });

  it('should skip when real decision patterns already exist', () => {
    writeFileSync(
      planPath,
      '### 📌 Decision: auth/strategy\n- **Value**: Use JWT\n- **Layer**: business\n',
      'utf-8',
    );
    const injected = injectGrokPlanTemplate(planPath);
    assert.strictEqual(injected, false);
  });
});