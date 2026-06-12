/**
 * Codex transcript helpers for Plan-to-ADR extraction.
 *
 * Codex stores session rollouts as JSONL under ~/.codex/sessions/ rather than
 * a dedicated plan.md file. These helpers locate the transcript and extract
 * assistant plan text written during collaboration Plan mode.
 *
 * @since v5.2.1
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Recursively search ~/.codex/sessions for a rollout JSONL ending with sessionId.
 */
export function findCodexTranscriptPath(sessionId: string): string | null {
  if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) {
    return null;
  }

  const suffix = `${sessionId}.jsonl`;
  const root = join(homedir(), '.codex', 'sessions');
  if (!existsSync(root)) {
    return null;
  }

  return searchJsonlBySuffix(root, suffix);
}

function searchJsonlBySuffix(dir: string, suffix: string): string | null {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      const found = searchJsonlBySuffix(fullPath, suffix);
      if (found) {
        return found;
      }
      continue;
    }
    if (entry.endsWith(suffix)) {
      return fullPath;
    }
  }
  return null;
}

function isPlanCollaborationMode(mode: unknown): boolean {
  if (typeof mode === 'string') {
    return mode.toLowerCase() === 'plan';
  }
  if (mode && typeof mode === 'object') {
    const record = mode as Record<string, unknown>;
    if (typeof record.mode === 'string') {
      return record.mode.toLowerCase() === 'plan';
    }
    if (typeof record.kind === 'string') {
      return record.kind.toLowerCase() === 'plan';
    }
  }
  return false;
}

/**
 * Extract assistant plan text from a Codex rollout JSONL transcript.
 * Returns concatenated assistant output from turns that ran in Plan mode.
 */
export function extractPlanMarkdownFromCodexTranscript(transcriptPath: string): string | null {
  if (!existsSync(transcriptPath)) {
    return null;
  }

  const lines = readFileSync(transcriptPath, 'utf-8').split('\n').filter((line) => line.trim());
  const chunks: string[] = [];
  let inPlanMode = false;

  for (const line of lines) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = entry.type;
    const payload = entry.payload as Record<string, unknown> | undefined;
    if (!payload) {
      continue;
    }

    if (type === 'turn_context') {
      inPlanMode = isPlanCollaborationMode(payload.collaboration_mode);
      continue;
    }

    if (type === 'event_msg') {
      if (isPlanCollaborationMode(payload.collaboration_mode_kind)) {
        inPlanMode = true;
      }
      if (payload.type === 'task_complete' || payload.type === 'turn_complete') {
        // Keep plan mode sticky until an explicit default-mode turn_context arrives.
      }
      continue;
    }

    if (!inPlanMode || type !== 'response_item') {
      continue;
    }

    const item = payload;
    if (item.type !== 'message' || item.role !== 'assistant') {
      continue;
    }

    const content = item.content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      if (!part || typeof part !== 'object') {
        continue;
      }
      const block = part as Record<string, unknown>;
      if (block.type === 'output_text' && typeof block.text === 'string' && block.text.trim()) {
        chunks.push(block.text.trim());
      }
    }
  }

  if (chunks.length === 0) {
    return null;
  }

  return chunks.join('\n\n');
}

/**
 * Write extracted Codex plan text to a project-local temp markdown file.
 */
export function materializeCodexPlanFile(projectPath: string, sessionId: string, content: string): string {
  const dir = join(projectPath, '.sqlew', 'tmp');
  mkdirSync(dir, { recursive: true });
  const safeId = sessionId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'codex';
  const planPath = join(dir, `codex-plan-${safeId}.md`);
  writeFileSync(planPath, content, 'utf-8');
  return planPath;
}