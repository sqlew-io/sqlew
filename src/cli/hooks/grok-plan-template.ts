/**
 * Grok Build plan.md Decision/Constraint template injection.
 *
 * Grok passive hooks ignore stdout, so templates are written directly to
 * ~/.grok/sessions/.../plan.md (file side-effect). Used by:
 * - enter_plan_mode (track-plan)
 * - UserPromptSubmit when plan_mode is Active/Pending (on-prompt)
 * - PostToolUse re-inject after plan.md overwrites (track-plan)
 *
 * Kept separate from track-plan / on-prompt to avoid circular imports.
 *
 * @since v5.2.0 (logic lived in track-plan.ts)
 * @modified v5.5.x - extracted module + ensureGrokPlanTemplate multi-trigger
 */

import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { computeGrokPlanPath } from './stdin-parser.js';
import {
  saveCurrentPlan,
  loadCurrentPlan,
  type CurrentPlanInfo,
} from '../../config/global-config.js';
import { hasPatterns } from './plan-pattern-extractor.js';
import { debugLog } from '../../utils/debug-logger.js';

/**
 * Decision/Constraint template to inject on new plan creation
 * Compact format for context window efficiency
 */
const PLAN_TEMPLATE = `
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

/** Marker heading written with PLAN_TEMPLATE; used to avoid duplicate injection. */
export const PLAN_TEMPLATE_MARKER = '## 📝 Decision/Constraint Recording';

/**
 * Append Decision/Constraint template to a Grok Build plan.md (file side-effect).
 *
 * Skips when the template marker or real 📌/🚫 patterns are already present.
 *
 * @param planPath - Absolute path to ~/.grok/sessions/.../plan.md
 * @returns true if template was written or appended
 */
export function injectGrokPlanTemplate(planPath: string): boolean {
  const planDir = dirname(planPath);
  if (!existsSync(planDir)) {
    mkdirSync(planDir, { recursive: true });
  }

  if (!existsSync(planPath)) {
    writeFileSync(planPath, `${PLAN_TEMPLATE}\n`, 'utf-8');
    debugLog('DEBUG', '[grok-plan-template] Created plan.md with template', { planPath });
    return true;
  }

  const content = readFileSync(planPath, 'utf-8');
  if (content.includes(PLAN_TEMPLATE_MARKER) || hasPatterns(content)) {
    debugLog('DEBUG', '[grok-plan-template] Skipped injection', {
      planPath,
      hasMarker: content.includes(PLAN_TEMPLATE_MARKER),
      hasPatterns: hasPatterns(content),
    });
    return false;
  }

  appendFileSync(planPath, `\n\n${PLAN_TEMPLATE}\n`, 'utf-8');
  debugLog('DEBUG', '[grok-plan-template] Appended template to plan.md', { planPath });
  return true;
}

/**
 * Warm session cache and inject Decision/Constraint template for a Grok plan.md.
 *
 * @returns true if injectGrokPlanTemplate wrote or appended the template
 */
export function ensureGrokPlanTemplate(
  projectPath: string,
  sessionId: string | undefined,
  planPathOverride?: string,
): boolean {
  const planPath =
    planPathOverride ||
    (sessionId ? computeGrokPlanPath(projectPath, sessionId) : null);
  if (!planPath) {
    return false;
  }

  const existing = loadCurrentPlan(projectPath);
  const samePath = existing?.plan_path === planPath;
  const planInfo: CurrentPlanInfo = {
    plan_id: samePath && existing ? existing.plan_id : randomUUID(),
    plan_file: 'plan.md',
    plan_path: planPath,
    plan_updated_at: new Date().toISOString(),
    recorded: samePath ? (existing?.recorded ?? false) : false,
    decision_pending: samePath ? (existing?.decision_pending ?? true) : true,
    enforcement_shown_at: samePath ? existing?.enforcement_shown_at : undefined,
  };
  saveCurrentPlan(projectPath, planInfo);
  return injectGrokPlanTemplate(planPath);
}
