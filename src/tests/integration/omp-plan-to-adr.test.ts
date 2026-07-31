/**
 * omp Plan-to-ADR integration tests (no omp binary required)
 *
 * @since v5.4.0
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { materializeOmpPlan, ensureOmpPlanTemplate } from '../../cli/hooks/omp-plan.js';
import { processPlanPatterns } from '../../cli/hooks/plan-processor.js';
import { hasFilledPatterns } from '../../cli/hooks/plan-pattern-extractor.js';
import { saveCurrentPlan, loadCurrentPlan } from '../../config/global-config.js';

const FILLED_PLAN = `# Demo plan

### 📌 Decision: harness/omp-adapter
- **Value**: in-process Extension + sqlew/hooks
- **Layer**: infrastructure
- **Rationale**: omp uses ExtensionAPI not shell hooks
`;

let testProjectPath: string;

describe('omp plan-to-adr', () => {
  beforeEach(() => {
    testProjectPath = join(
      tmpdir(),
      `sqlew-omp-adr-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(join(testProjectPath, '.sqlew', 'plans'), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testProjectPath)) {
      rmSync(testProjectPath, { recursive: true, force: true });
    }
  });

  it('processPlanPatterns enqueues decision from materialized plan', () => {
    const { planPath } = materializeOmpPlan({
      projectPath: testProjectPath,
      slug: 'demo',
      content: FILLED_PLAN,
    });
    assert.ok(existsSync(planPath));
    assert.equal(hasFilledPatterns(FILLED_PLAN), true);

    const result = processPlanPatterns(testProjectPath);
    assert.equal(result.processed, true, result.skipReason ?? 'expected processed');
    assert.ok(result.confirmationMessage);

    const plan = loadCurrentPlan(testProjectPath);
    assert.ok(plan);
    assert.equal(plan!.recorded, true);

    const queuePath = join(testProjectPath, '.sqlew', 'queue', 'pending.json');
    assert.ok(existsSync(queuePath), 'pending.json should exist');
    const queueRaw = readFileSync(queuePath, 'utf-8');
    assert.ok(
      queueRaw.includes('harness/omp-adapter') || queueRaw.includes('decision'),
      `queue should contain decision entry: ${queueRaw.slice(0, 200)}`,
    );
  });

  it('second processPlanPatterns returns already_recorded', () => {
    materializeOmpPlan({
      projectPath: testProjectPath,
      slug: 'demo',
      content: FILLED_PLAN,
    });
    const first = processPlanPatterns(testProjectPath);
    assert.equal(first.processed, true);

    const second = processPlanPatterns(testProjectPath);
    assert.equal(second.processed, false);
    assert.ok(
      second.skipReason === 'already_recorded' ||
        second.skipReason?.includes('recorded'),
      `skipReason=${second.skipReason}`,
    );
  });

  it('template-only plan fails hasFilledPatterns', () => {
    const { content } = ensureOmpPlanTemplate('# empty plan\n');
    assert.equal(hasFilledPatterns(content), false);

    // Propose gate uses hasFilledPatterns; processPlanPatterns still sees
    // raw 📌/🚫 headings via hasPatterns — gate is what blocks empty proposes.
    writeFileSync(join(testProjectPath, '.sqlew', 'plans', 'empty-plan.md'), content, 'utf-8');
    saveCurrentPlan(testProjectPath, {
      plan_id: 'empty-1',
      plan_file: 'empty-plan.md',
      plan_path: join(testProjectPath, '.sqlew', 'plans', 'empty-plan.md').replace(/\\/g, '/'),
      plan_updated_at: new Date().toISOString(),
      recorded: false,
      decision_pending: true,
    });

    // If extraction yields only placeholders, hasFilledPatterns remains the gate.
    assert.equal(hasFilledPatterns(readFileSync(join(testProjectPath, '.sqlew', 'plans', 'empty-plan.md'), 'utf-8')), false);
  });
});
