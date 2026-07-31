/**
 * omp plan tracking helpers.
 *
 * omp plans live as session-local `local://<slug>-plan.md` artifacts on disk
 * under the session artifacts dir (`<sessionFile-without-.jsonl>/local/`).
 * processPlanPatterns needs an absolute plan_path, so we resolve local:// to
 * that real path and store it on CurrentPlanInfo — no project .sqlew/plans copy.
 *
 * Fallback: if resolve fails, legacy-write under `.sqlew/plans/` (rare).
 *
 * @since v5.4.0
 * @modified v5.4.2 — session-local plan_path; drop default project mirror
 */

import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, isAbsolute, join, resolve as pathResolve, sep } from 'path';
import { tmpdir } from 'os';
import {
  loadCurrentPlan,
  saveCurrentPlan,
  type CurrentPlanInfo,
} from '../../config/global-config.js';
import { debugLog } from '../../utils/debug-logger.js';
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

/** Match pi-coding-agent local-protocol WINDOWS_LOCAL_ROOT_MAX_CHARS */
const WINDOWS_LOCAL_ROOT_MAX_CHARS = 180;

export type OmpLocalResolveOpts = {
  /** Absolute path to session transcript (…/<ts>_<id>.jsonl) */
  sessionFile?: string | null;
  /** Fallback session id for Win short root / missing sessionFile */
  sessionId?: string | null;
  /** Override platform (tests); default process.platform */
  platform?: NodeJS.Platform;
};

/** Legacy project mirror dir (fallback only). */
export function ompPlansDir(projectPath: string): string {
  return join(projectPath, '.sqlew', 'plans');
}

function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function normalizeFsPath(p: string): string {
  return p.replace(/\\/g, '/');
}

function safeSessionId(sessionId?: string | null): string {
  const raw = sessionId && sessionId.length > 0 ? sessionId : 'session';
  const safe = raw.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return safe.length > 0 ? safe : 'session';
}

/**
 * Resolve session-scoped local:// root (mirrors pi-coding-agent resolveLocalRoot).
 */
export function resolveOmpLocalRoot(
  opts: OmpLocalResolveOpts,
  platform: NodeJS.Platform = opts.platform ?? process.platform,
): string {
  const sessionFile = opts.sessionFile;
  if (sessionFile) {
    const artifactsDir = sessionFile.replace(/\.jsonl$/i, '');
    const candidate = pathResolve(artifactsDir, 'local');
    if (platform === 'win32' && candidate.length >= WINDOWS_LOCAL_ROOT_MAX_CHARS) {
      return join(tmpdir(), 'omp-local', safeSessionId(opts.sessionId));
    }
    return candidate;
  }
  return join(tmpdir(), 'omp-local', safeSessionId(opts.sessionId));
}

function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
  const root = pathResolve(rootPath);
  const target = pathResolve(targetPath);
  if (target === root) return true;
  const prefix = root.endsWith(sep) ? root : root + sep;
  // Windows: compare case-insensitively
  if (process.platform === 'win32') {
    return target.toLowerCase().startsWith(prefix.toLowerCase());
  }
  return target.startsWith(prefix);
}

/**
 * Resolve local://rel or absolute path to a normalized absolute FS path.
 * Returns null if unresolvable or path escapes the local root.
 */
export function resolveOmpPlanFsPath(
  filePath: string,
  opts: OmpLocalResolveOpts = {},
): string | null {
  if (!filePath) return null;
  const p = filePath.replace(/\\/g, '/').trim();
  if (!p) return null;

  const localMatch = /^local:\/\/(.+)$/i.exec(p);
  if (!localMatch) {
    if (isAbsolute(filePath) || /^[A-Za-z]:[\\/]/.test(filePath)) {
      return normalizeFsPath(pathResolve(filePath));
    }
    return null;
  }

  let rel = localMatch[1] ?? '';
  rel = rel.split('?')[0].split('#')[0];
  rel = rel.replace(/^\/+/, '');
  if (!rel || rel.includes('\0')) return null;

  const platform = opts.platform ?? process.platform;
  const localRoot = pathResolve(resolveOmpLocalRoot(opts, platform));
  const resolved = pathResolve(localRoot, rel);
  if (!isPathInsideRoot(resolved, localRoot)) {
    return null;
  }
  return normalizeFsPath(resolved);
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

  name = name.split('?')[0].split('#')[0];

  if (!name.toLowerCase().endsWith('.md')) {
    if (name.length > 0 && !name.includes('/')) {
      return name.replace(/-plan$/i, '') || null;
    }
    return null;
  }

  const base = name.slice(0, -3);
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
 * Track an omp plan at an absolute FS path (session local). Does NOT write the
 * plan body — harness owns local:// content. Updates CurrentPlanInfo only.
 *
 * Name kept for API compatibility with older callers that expected a project mirror.
 */
export function materializeOmpPlan(opts: {
  projectPath: string;
  slug: string;
  content?: string;
  /** Absolute FS path of the plan body (session local or legacy). Required. */
  planPath: string;
  sessionId?: string;
}): { planPath: string; planInfo: CurrentPlanInfo } {
  const { projectPath, planPath, content } = opts;
  if (!planPath) {
    throw new Error('materializeOmpPlan: planPath is required');
  }

  const normalizedPath = normalizeFsPath(planPath);
  const planFile = basename(normalizedPath);

  let newHash: string | undefined;
  if (content !== undefined) {
    newHash = contentHash(content);
  } else if (existsSync(planPath)) {
    try {
      newHash = contentHash(readFileSync(planPath, 'utf-8'));
    } catch {
      newHash = undefined;
    }
  }

  const existing = loadCurrentPlan(projectPath);
  const samePath =
    existing?.plan_path?.replace(/\\/g, '/') === normalizedPath ||
    existing?.plan_file === planFile;

  let previousHash: string | undefined;
  if (samePath && existing?.plan_path && existsSync(existing.plan_path)) {
    try {
      previousHash = contentHash(readFileSync(existing.plan_path, 'utf-8'));
    } catch {
      previousHash = undefined;
    }
  } else if (samePath && existsSync(planPath)) {
    try {
      previousHash = contentHash(readFileSync(planPath, 'utf-8'));
    } catch {
      previousHash = undefined;
    }
  }

  let recorded = false;
  let planId: string = randomUUID();
  let decisionPending = true;
  let enforcementShownAt: string | undefined;

  if (samePath && existing) {
    planId = existing.plan_id;
    enforcementShownAt = existing.enforcement_shown_at;

    if (existing.recorded && newHash !== undefined && previousHash !== undefined) {
      if (previousHash === newHash) {
        recorded = true;
        decisionPending = existing.decision_pending ?? false;
      } else {
        // content changed after recorded → allow re-extract
        recorded = false;
        decisionPending = true;
      }
    } else if (existing.recorded && newHash !== undefined && previousHash === undefined) {
      // No prior disk bytes to compare — treat as pending re-extract
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
    plan_path: normalizedPath,
    plan_updated_at: new Date().toISOString(),
    recorded,
    decision_pending: decisionPending,
    enforcement_shown_at: enforcementShownAt,
  };
  saveCurrentPlan(projectPath, planInfo);
  return { planPath: normalizedPath, planInfo };
}

/**
 * Legacy fallback: write content under .sqlew/plans and track.
 * Only used when local:// cannot be resolved.
 */
function legacyMaterializeToProject(opts: {
  projectPath: string;
  slug: string;
  content: string;
}): CurrentPlanInfo {
  const { projectPath, slug, content } = opts;
  const safeSlug =
    slug.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '') || 'plan';
  const planFile = `${safeSlug}-plan.md`;
  const dir = ompPlansDir(projectPath);
  mkdirSync(dir, { recursive: true });
  const planPath = normalizeFsPath(join(dir, planFile));
  writeFileSync(planPath, content, 'utf-8');
  debugLog('DEBUG', '[omp-plan] local resolve failed; fallback materialize to .sqlew/plans', {
    planPath,
  });
  return materializeOmpPlan({
    projectPath,
    slug: safeSlug,
    content,
    planPath,
  }).planInfo;
}

/**
 * Track omp plan from a path (local:// or absolute).
 * Prefer resolving local:// to the session file; no project copy on success.
 */
export function trackOmpPlanFromPath(opts: {
  projectPath: string;
  filePath: string;
  content?: string;
  sessionId?: string;
  sessionFile?: string | null;
}): CurrentPlanInfo {
  const { projectPath, filePath, content, sessionId, sessionFile } = opts;
  const slug = extractSlugFromOmpPlanPath(filePath) ?? 'plan';
  const abs = resolveOmpPlanFsPath(filePath, { sessionFile, sessionId });

  if (abs) {
    return materializeOmpPlan({
      projectPath,
      slug,
      content,
      planPath: abs,
      sessionId,
    }).planInfo;
  }

  // Resolve failed — legacy project mirror
  const body =
    content !== undefined ? content : ensureOmpPlanTemplate('').content;
  return legacyMaterializeToProject({ projectPath, slug, content: body });
}

export { isOmpPlanPath, OMP_PLAN_TEMPLATE, PLAN_TEMPLATE_MARKER };
