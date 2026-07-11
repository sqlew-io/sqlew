/**
 * Grok Build plan.md template injection unit tests
 *
 * @since v5.2.0
 * @modified v5.5.x - multi-trigger ensure + plan_mode helpers
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import {
  injectGrokPlanTemplate,
  ensureGrokPlanTemplate,
  PLAN_TEMPLATE_MARKER,
} from '../../../cli/hooks/grok-plan-template.js';
import {
  computeGrokSessionDir,
  computeGrokPlanPath,
  readGrokPlanModeState,
  isGrokPlanModeActive,
  isGrokPlanFile,
  normalizeHookInput,
} from '../../../cli/hooks/stdin-parser.js';

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

  it('should re-append after full-file overwrite without template', () => {
    injectGrokPlanTemplate(planPath);
    writeFileSync(planPath, '# Overwritten plan\n\nNo template here.\n', 'utf-8');
    const reinjected = injectGrokPlanTemplate(planPath);
    assert.strictEqual(reinjected, true);
    const content = readFileSync(planPath, 'utf-8');
    assert.ok(content.includes('# Overwritten plan'));
    assert.ok(content.includes(PLAN_TEMPLATE_MARKER));
  });
});

describe('Grok plan path / plan_mode helpers', () => {
  const workspace = process.platform === 'win32'
    ? 'C:\\Users\\test\\proj'
    : '/Users/test/proj';
  const sessionId = '019f4fb0-79e8-7b12-8fa9-ee90c38fd340';

  it('computeGrokSessionDir should nest under ~/.grok/sessions', () => {
    const dir = computeGrokSessionDir(workspace, sessionId);
    assert.ok(dir);
    assert.strictEqual(
      dir,
      join(homedir(), '.grok', 'sessions', encodeURIComponent(workspace), sessionId),
    );
  });

  it('computeGrokPlanPath should end with plan.md under session dir', () => {
    const planPath = computeGrokPlanPath(workspace, sessionId);
    const sessionDir = computeGrokSessionDir(workspace, sessionId);
    assert.strictEqual(planPath, join(sessionDir!, 'plan.md'));
  });

  it('isGrokPlanFile should match session plan paths', () => {
    const planPath = computeGrokPlanPath(workspace, sessionId)!;
    assert.strictEqual(isGrokPlanFile(planPath), true);
    assert.strictEqual(isGrokPlanFile(planPath, workspace, sessionId), true);
    assert.strictEqual(isGrokPlanFile('/tmp/other.md'), false);
    assert.strictEqual(isGrokPlanFile('.claude/plans/foo.md'), false);
  });

  it('readGrokPlanModeState should parse plan_mode.json', () => {
    const sessionDir = computeGrokSessionDir(workspace, sessionId)!;
    // Use a temp workspace path under tmpdir so we do not touch real sessions
    const tmpWs = join(tmpdir(), `sqlew-ws-${Date.now()}`);
    const sid = 'test-session-abc';
    const dir = computeGrokSessionDir(tmpWs, sid)!;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'plan_mode.json'), JSON.stringify({ state: 'Active' }), 'utf-8');

    assert.strictEqual(readGrokPlanModeState(tmpWs, sid), 'Active');
    assert.strictEqual(isGrokPlanModeActive(tmpWs, sid), true);

    writeFileSync(join(dir, 'plan_mode.json'), JSON.stringify({ state: 'Pending' }), 'utf-8');
    assert.strictEqual(isGrokPlanModeActive(tmpWs, sid), true);

    writeFileSync(join(dir, 'plan_mode.json'), JSON.stringify({ state: 'Inactive' }), 'utf-8');
    assert.strictEqual(isGrokPlanModeActive(tmpWs, sid), false);

    rmSync(dir, { recursive: true, force: true });
    // silence unused
    void sessionDir;
  });

  it('normalizeHookInput should map write tool to Write', () => {
    const result = normalizeHookInput({
      hookEventName: 'post_tool_use',
      toolName: 'write',
      toolInput: { file_path: '/tmp/plan.md' },
      workspaceRoot: workspace,
      sessionId,
    });
    assert.strictEqual(result.client, 'grok');
    assert.strictEqual(result.tool_name, 'Write');
  });
});

describe('ensureGrokPlanTemplate', () => {
  let projectPath: string;
  let sessionId: string;
  let planPath: string;

  beforeEach(() => {
    projectPath = join(tmpdir(), `sqlew-proj-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(projectPath, { recursive: true });
    sessionId = `sess-${Date.now().toString(36)}`;
    // ensureGrokPlanTemplate uses computeGrokPlanPath(projectPath, sessionId)
    // which writes under ~/.grok/sessions — use override path for isolation
    planPath = join(projectPath, 'plan.md');
  });

  afterEach(() => {
    if (existsSync(projectPath)) {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it('should inject via planPathOverride without touching real sessions', () => {
    const injected = ensureGrokPlanTemplate(projectPath, sessionId, planPath);
    assert.strictEqual(injected, true);
    assert.ok(existsSync(planPath));
    assert.ok(readFileSync(planPath, 'utf-8').includes(PLAN_TEMPLATE_MARKER));
  });

  it('should not duplicate on second ensure', () => {
    ensureGrokPlanTemplate(projectPath, sessionId, planPath);
    const second = ensureGrokPlanTemplate(projectPath, sessionId, planPath);
    assert.strictEqual(second, false);
    const content = readFileSync(planPath, 'utf-8');
    assert.strictEqual((content.match(new RegExp(PLAN_TEMPLATE_MARKER, 'g')) || []).length, 1);
  });
});
