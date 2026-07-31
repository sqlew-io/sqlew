/**
 * Session context injection helpers for hooks
 *
 * Reads .sqlew/session-context.json (written by MCP server) and formats
 * a budget-trimmed context block for hook injection. Hooks never open the DB.
 *
 * @since v5.4.0
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { GitAdapter } from '../../utils/vcs-adapter.js';
import { resolveConfigPath, loadConfigFile } from '../../config/loader.js';
import {
  loadGlobalConfig,
  loadSessionContextMarker,
  type SessionContextMarker,
} from '../../config/global-config.js';
import {
  DEFAULT_SESSION_CONTEXT_BUDGET,
  DEFAULT_GROK_REQUIRE_PATTERNS,
  DEFAULT_OMP_REQUIRE_PATTERNS,
} from '../../config/types.js';
import {
  SESSION_SNAPSHOT_VERSION,
  type SessionSnapshot,
} from '../../utils/session-snapshot.js';
import { estimateTokens } from '../../utils/token-estimation.js';

const STALENESS_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Resolve candidate snapshot paths (local + worktree parent fallback)
 */
async function resolveSnapshotPaths(projectPath: string): Promise<string[]> {
  const paths: string[] = [
    join(projectPath, '.sqlew', 'session-context.json'),
  ];

  const gitAdapter = new GitAdapter(projectPath);
  if (await gitAdapter.isWorktree()) {
    const mainRoot = await gitAdapter.getMainRepositoryRoot();
    if (mainRoot) {
      paths.push(join(mainRoot, '.sqlew', 'session-context.json'));
    }
  }

  return paths;
}

/**
 * Load session snapshot from disk. Returns null if missing, stale, or invalid.
 */
export async function loadSnapshot(projectPath: string): Promise<SessionSnapshot | null> {
  const candidates = await resolveSnapshotPaths(projectPath);

  for (const snapshotPath of candidates) {
    if (!existsSync(snapshotPath)) {
      continue;
    }

    try {
      const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8')) as SessionSnapshot;

      if (snapshot.version !== SESSION_SNAPSHOT_VERSION) {
        continue;
      }

      const generatedAt = new Date(snapshot.generated_at).getTime();
      if (Number.isNaN(generatedAt)) {
        continue;
      }

      const ageMs = Date.now() - generatedAt;
      if (ageMs > STALENESS_DAYS * MS_PER_DAY) {
        continue;
      }

      return snapshot;
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Resolve session context token budget from config (local → global → default).
 */
export async function resolveBudget(projectPath: string): Promise<number> {
  const configPath = await resolveConfigPath(projectPath);
  if (configPath) {
    const configDir = dirname(configPath);
    const configFile = configPath.slice(configDir.length + 1);
    const config = loadConfigFile(configDir, configFile);
    return config.hooks?.session_context_budget ?? DEFAULT_SESSION_CONTEXT_BUDGET;
  }

  const globalConfig = loadGlobalConfig();
  return globalConfig.hooks?.session_context_budget ?? DEFAULT_SESSION_CONTEXT_BUDGET;
}

/**
 * Resolve hooks.grok_require_patterns (local → global → default true).
 * Sync for PreToolUse exit gate (no async in track-plan path).
 */
export function resolveGrokRequirePatterns(projectPath?: string): boolean {
  try {
    if (projectPath) {
      const localConfig = join(projectPath, '.sqlew', 'config.toml');
      if (existsSync(localConfig)) {
        const config = loadConfigFile(projectPath, '.sqlew/config.toml');
        if (config.hooks?.grok_require_patterns !== undefined) {
          return config.hooks.grok_require_patterns;
        }
      }
    }
    const globalConfig = loadGlobalConfig();
    if (globalConfig.hooks?.grok_require_patterns !== undefined) {
      return globalConfig.hooks.grok_require_patterns;
    }
  } catch {
    // fail-open to default
  }
  return DEFAULT_GROK_REQUIRE_PATTERNS;
}

/**
 * Resolve hooks.omp_require_patterns (local → global → default true).
 * Sync for omp propose exit gate.
 */
export function resolveOmpRequirePatterns(projectPath?: string): boolean {
  try {
    if (projectPath) {
      const localConfig = join(projectPath, '.sqlew', 'config.toml');
      if (existsSync(localConfig)) {
        const config = loadConfigFile(projectPath, '.sqlew/config.toml');
        if (config.hooks?.omp_require_patterns !== undefined) {
          return config.hooks.omp_require_patterns;
        }
      }
    }
    const globalConfig = loadGlobalConfig();
    if (globalConfig.hooks?.omp_require_patterns !== undefined) {
      return globalConfig.hooks.omp_require_patterns;
    }
  } catch {
    // fail-open to default
  }
  return DEFAULT_OMP_REQUIRE_PATTERNS;
}

/**
 * Format snapshot into an English Markdown context block, trimmed to budget.
 * Returns null when budget is 0 or both lists are empty.
 */
export function formatContextBlock(snapshot: SessionSnapshot, budget: number): string | null {
  if (budget <= 0) {
    return null;
  }

  if (snapshot.decisions.length === 0 && snapshot.constraints.length === 0) {
    return null;
  }

  const lines: string[] = ['[sqlew] Session context (auto-injected)'];

  if (snapshot.constraints.length > 0) {
    lines.push('', '### Active Constraints');
    for (const c of snapshot.constraints) {
      lines.push(`- **${c.category}** (${c.priority}): ${c.rule}`);
      if (c.reason) {
        lines.push(`  Reason: ${c.reason}`);
      }
    }
  }

  if (snapshot.decisions.length > 0) {
    lines.push('', '### Recent Decisions');
    for (const d of snapshot.decisions) {
      const meta = [d.layer, d.updated].filter(Boolean).join(', ');
      lines.push(`- **${d.key}**: ${d.value}${meta ? ` (${meta})` : ''}`);
    }
  }

  let block = lines.join('\n');

  while (estimateTokens(block) > budget && block.includes('\n')) {
    const trimmed = block.slice(0, block.lastIndexOf('\n'));
    if (trimmed === block) {
      break;
    }
    block = trimmed;
  }

  if (estimateTokens(block) > budget) {
    const maxChars = budget * 4;
    block = block.slice(0, maxChars);
  }

  return block.trim().length > 0 ? block : null;
}

/**
 * Whether on-prompt should inject session context (Codex/Hermes fallback).
 * Returns false when session_id is unavailable to prevent per-prompt spam.
 */
export function shouldInjectOnPrompt(
  projectPath: string,
  sessionId: string | undefined,
): boolean {
  if (sessionId == null) {
    return false;
  }

  const marker = loadSessionContextMarker(projectPath);
  return marker?.session_id !== sessionId;
}

/**
 * Build formatted session context block for injection.
 */
export async function buildSessionContext(projectPath: string): Promise<string | null> {
  const budget = await resolveBudget(projectPath);
  const snapshot = await loadSnapshot(projectPath);
  if (!snapshot) {
    return null;
  }
  return formatContextBlock(snapshot, budget);
}

export type { SessionContextMarker };