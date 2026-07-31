/**
 * omp plan materialization helpers.
 *
 * omp plans live as session-local `local://<slug>-plan.md` artifacts.
 * processPlanPatterns needs an absolute plan_path, so we mirror content under
 * `<project>/.sqlew/plans/<slug>-plan.md` (same idea as Grok/Codex materialize).
 *
 * @since v5.4.0
 */

import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  loadCurrentPlan,
  saveCurrentPlan,
  type CurrentPlanInfo,
} from '../../config/global-config.js';
import { hasPatterns } from './plan-pattern-extractor.js';
import { PLAN_TEMPLATE_MARKER } from './grok-plan-template.js';
import { isOmpPlanPath } from './stdin-parser.js';

/** Decision/Constraint template body (shared wording with Grok). */
const OMP_PLAN_TEMPLATE = `
---
## 📝 Decision/Constraint Recording (auto-detected on ExitPlanMode)

### 📌 Decision: [key/path]
- **Value**: Description
- **Layer**: presentation | business | data | infrastructure | cross-cutting
- **Rationale**: Why this decision was made

### 🚫 Constraint: [category]
- **Rule**: Description (category: architecture | security | code-style | performance)
- **Priority**: critical | high | medium | low
- **Tags**: comma-separated tags

---
`.trim();

export function ompPlansDir(projectPath: string): string {
  return join(projectPath, '.sqlew', 'plans');
}

function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Extract slug from omp plan path forms:
 * - local://foo-plan.md → foo
 * - /abs/.sqlew/plans/foo-plan.md → foo
 * - foo-plan.md → foo
 * - xd://propose / slug body → null (caller handles propose separately)
 */
export function extractSlugFromOmpPlanPath(filePath: string): string | null {
  if (!filePath) return null;
  const p = filePath.replace(/\\/g, '/').trim();

  // propose devices are not plan slugs
  if (
    p === 'xd://propose' ||
    p === '/xdev/propose' ||
    p.endsWith('/xdev/propose')
  ) {
    return null;
  }

  let name = p;
  const localMatch = /^local:\/\/(.+)$/i.exec(p);
  if (localMatch) {
    name = localMatch[1];
  } else {
    const slash = p.lastIndexOf('/');
    if (slash >= 0) name = p.slice(slash + 1);
  }

  // strip query/hash if any
  name = name.split('?')[0].split('#')[0];

  if (!name.toLowerCase().endsWith('.md')) {
    // bare slug without -plan.md
    if (name.length > 0 && !name.includes('/')) {
      return name.replace(/-plan$/i, '') || null;
    }
    return null;
  }

  const base = name.slice(0, -3); // drop .md
  const withoutPlan = base.replace(/-plan$/i, '');
  return withoutPlan.length > 0 ? withoutPlan : null;
}

/**
 * Append Decision/Constraint template when marker and real patterns are absent.
 */
export function ensureOmpPlanTemplate(content: string): {
  content: string;
  injected: boolean;
} {
  if (!content) {
    return { content: `${OMP_PLAN_TEMPLATE}\n`, injected: true };
  }
  if (content.includes(PLAN_TEMPLATE_MARKER) || hasPatterns(content)) {
    return { content, injected: false };
  }
  const sep = content.endsWith('\n') ? '\n' : '\n\n';
  return { content: `${content}${sep}${OMP_PLAN_TEMPLATE}\n`, injected: true };
}

/**
 * Write plan content under .sqlew/plans and update CurrentPlanInfo.
 */
export function materializeOmpPlan(opts: {
  projectPath: string;
  slug: string;
  content: string;
  sessionId?: string;
}): { planPath: string; planInfo: CurrentPlanInfo } {
  const { projectPath, slug, content } = opts;
  const safeSlug = slug.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '') || 'plan';
  const planFile = `${safeSlug}-plan.md`;
  const dir = ompPlansDir(projectPath);
  mkdirSync(dir, { recursive: true });
  const planPath = join(dir, planFile).replace(/\\/g, '/');

  const existing = loadCurrentPlan(projectPath);
  const samePath =
    existing?.plan_path?.replace(/\\/g, '/') === planPath ||
    existing?.plan_file === planFile;

  let previousHash: string | undefined;
  if (samePath && existsSync(planPath)) {
    try {
      previousHash = contentHash(readFileSync(planPath, 'utf-8'));
    } catch {
      previousHash = undefined;
    }
  }

  writeFileSync(planPath, content, 'utf-8');
  const newHash = contentHash(content);

  let recorded = false;
  let planId: string = randomUUID();
  let decisionPending = true;
  let enforcementShownAt: string | undefined;

  if (samePath && existing) {
    planId = existing.plan_id;
    enforcementShownAt = existing.enforcement_shown_at;
    if (existing.recorded && previousHash === newHash) {
      recorded = true;
      decisionPending = existing.decision_pending ?? false;
    } else if (existing.recorded && previousHash !== newHash) {
      // content changed after recorded → allow re-extract
      recorded = false;
      decisionPending = true;
    } else {
      recorded = existing.recorded;
      decisionPending = existing.decision_pending ?? true;
    }
  }

  const planInfo: CurrentPlanInfo = {
    plan_id: planId,
    plan_file: planFile,
    plan_path: planPath,
    plan_updated_at: new Date().toISOString(),
    recorded,
    decision_pending: decisionPending,
    enforcement_shown_at: enforcementShownAt,
  };
  saveCurrentPlan(projectPath, planInfo);
  return { planPath, planInfo };
}

/**
 * Track omp plan from a path (local:// or absolute materialized).
 * When content is provided, materializes/updates the file.
 */
export function trackOmpPlanFromPath(opts: {
  projectPath: string;
  filePath: string;
  content?: string;
  sessionId?: string;
}): CurrentPlanInfo {
  const { projectPath, filePath, content, sessionId } = opts;
  const slug = extractSlugFromOmpPlanPath(filePath) ?? 'plan';

  if (content !== undefined) {
    return materializeOmpPlan({ projectPath, slug, content, sessionId }).planInfo;
  }

  // No content: if already materialized, just refresh tracking metadata
  const planFile = `${slug}-plan.md`;
  const planPath = join(ompPlansDir(projectPath), planFile).replace(/\\/g, '/');

  if (existsSync(planPath)) {
    const existingContent = readFileSync(planPath, 'utf-8');
    return materializeOmpPlan({
      projectPath,
      slug,
      content: existingContent,
      sessionId,
    }).planInfo;
  }

  // Absolute path that is already a real file
  const normalized = filePath.replace(/\\/g, '/');
  if (!normalized.startsWith('local://') && existsSync(filePath)) {
    const fileContent = readFileSync(filePath, 'utf-8');
    return materializeOmpPlan({
      projectPath,
      slug,
      content: fileContent,
      sessionId,
    }).planInfo;
  }

  // Create empty tracked plan with template
  const { content: templated } = ensureOmpPlanTemplate('');
  return materializeOmpPlan({
    projectPath,
    slug,
    content: templated,
    sessionId,
  }).planInfo;
}

export { isOmpPlanPath, OMP_PLAN_TEMPLATE, PLAN_TEMPLATE_MARKER };
