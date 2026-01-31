/**
 * Auto-initialize sqlew on server startup
 *
 * As of v5.1.0, this module handles:
 * - Global CLAUDE.md injection (~/.claude/CLAUDE.md)
 * - Project .gitignore updates
 *
 * Skills and Hooks are managed by the sqlew-plugin (Claude Code Plugin).
 * @see https://github.com/sqlew-io/sqlew-plugin for Skills/Hooks/Agents
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { debugLog } from './utils/debug-logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get path to assets directory (relative to dist/)
 */
function getAssetsPath(): string {
  const distDir = __dirname; // .../dist
  const packageRoot = path.dirname(distDir); // .../mcp-sqlew
  return path.join(packageRoot, 'assets');
}

/** Marker for sqlew auto-injected section in CLAUDE.md */
const CLAUDE_MD_MARKER_START = '<!-- sqlew:auto-injected:start -->';
const CLAUDE_MD_MARKER_END = '<!-- sqlew:auto-injected:end -->';

/**
 * Inject sqlew snippets into global ~/.claude/CLAUDE.md
 *
 * As of v5.1.0, snippets are injected directly into CLAUDE.md instead of
 * being copied to ~/.claude/rules/sqlew/. This ensures higher priority
 * and better compatibility with other CLI tools (Codex, Gemini CLI).
 *
 * The injected section is wrapped with HTML comment markers for:
 * - Easy identification of auto-managed content
 * - Safe updates (replace existing section)
 * - No impact on Markdown rendering
 *
 * TODO: Add client detection to conditionally inject based on CLI type
 * Use server.getClientVersion() after MCP initialization
 */
export function injectToGlobalClaudeMd(): void {
  const home = os.homedir();
  const claudeDir = path.join(home, '.claude');
  const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');
  const snippetsDir = path.join(getAssetsPath(), 'claude-md-snippets');

  // Check if snippets directory exists
  if (!fs.existsSync(snippetsDir)) {
    debugLog('WARN', 'Claude MD snippets directory not found', { snippetsDir });
    return;
  }

  // Create ~/.claude/ directory if needed
  if (!fs.existsSync(claudeDir)) {
    try {
      fs.mkdirSync(claudeDir, { recursive: true });
      debugLog('INFO', 'Created ~/.claude directory', { claudeDir });
    } catch (error) {
      debugLog('WARN', 'Failed to create ~/.claude directory', { error });
      return;
    }
  }

  // Read current CLAUDE.md content (or empty string if doesn't exist)
  let content = '';
  if (fs.existsSync(claudeMdPath)) {
    content = fs.readFileSync(claudeMdPath, 'utf-8');
  } else {
    debugLog('INFO', 'Creating new ~/.claude/CLAUDE.md', { claudeMdPath });
  }

  // Find all .md files in snippets directory
  const snippetFiles = fs.readdirSync(snippetsDir).filter(f => f.endsWith('.md'));

  if (snippetFiles.length === 0) {
    debugLog('WARN', 'No snippet files found', { snippetsDir });
    return;
  }

  // Concatenate all snippet contents
  const snippetContent = snippetFiles
    .map(f => fs.readFileSync(path.join(snippetsDir, f), 'utf-8'))
    .join('\n\n');

  // Build the injected section
  const injectedSection = `${CLAUDE_MD_MARKER_START}\n${snippetContent}\n${CLAUDE_MD_MARKER_END}`;

  // Check if section already exists
  if (content.includes(CLAUDE_MD_MARKER_START)) {
    // Check if content is the same (no update needed)
    const regex = new RegExp(`${escapeRegex(CLAUDE_MD_MARKER_START)}[\\s\\S]*?${escapeRegex(CLAUDE_MD_MARKER_END)}`, 'g');
    const existingMatch = content.match(regex);

    if (existingMatch && existingMatch[0] === injectedSection) {
      debugLog('DEBUG', 'CLAUDE.md sqlew section is up-to-date');
      return;
    }

    // Replace existing section
    content = content.replace(regex, injectedSection);
    debugLog('INFO', 'Updated sqlew section in CLAUDE.md', { files: snippetFiles.length });
  } else {
    // Append new section
    content = content.trimEnd() + '\n\n' + injectedSection + '\n';
    debugLog('INFO', 'Injected sqlew section into CLAUDE.md', { files: snippetFiles.length });
  }

  // Write updated content
  try {
    fs.writeFileSync(claudeMdPath, content, 'utf-8');
  } catch (error) {
    debugLog('WARN', 'Failed to write CLAUDE.md', { error });
  }
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Initialize sqlew on MCP server startup
 *
 * As of v5.1.0:
 * - Injects snippets into ~/.claude/CLAUDE.md (not rules/)
 * - Updates project .gitignore
 *
 * @param projectRoot - Project root directory (for .gitignore updates)
 */
export function initializeSqlewRules(projectRoot: string): void {
  debugLog('DEBUG', 'Initializing sqlew', { projectRoot });

  // Inject snippets into global ~/.claude/CLAUDE.md
  // TODO: Add client detection to conditionally inject
  injectToGlobalClaudeMd();

  // Initialize .gitignore entries for sqlew-generated files
  initializeGitignore(projectRoot);
}

/**
 * Files/directories auto-generated by sqlew that should be gitignored
 *
 * As of v5.0.0:
 * - Skills and Hooks are managed by sqlew-plugin (not per-project)
 * - Gitignore is placed inside .sqlew/ directory
 *
 * Note: *.db* catches .db, .db-journal, .db-wal, .db-shm files
 */
const SQLEW_GITIGNORE_ENTRIES = [
  'queue/',
  'tmp/',
  '*.db*',
];

/** Marker comment for sqlew gitignore */
const SQLEW_GITIGNORE_MARKER = '# sqlew auto-generated files';

/**
 * Initialize .sqlew/.gitignore with sqlew auto-generated file entries
 * Creates .sqlew/.gitignore if it doesn't exist, adds missing entries if sqlew section exists
 */
export function initializeGitignore(projectRoot: string): void {
  const sqlewDir = path.join(projectRoot, '.sqlew');
  const gitignorePath = path.join(sqlewDir, '.gitignore');

  // Create .sqlew directory if needed
  if (!fs.existsSync(sqlewDir)) {
    try {
      fs.mkdirSync(sqlewDir, { recursive: true });
    } catch (error) {
      debugLog('WARN', 'Failed to create .sqlew directory', { error });
      return;
    }
  }

  // Read current .gitignore content (or empty string if doesn't exist)
  let content = '';
  if (fs.existsSync(gitignorePath)) {
    content = fs.readFileSync(gitignorePath, 'utf-8');
  } else {
    debugLog('INFO', '.sqlew/.gitignore not found, creating new file', { gitignorePath });
  }

  // Check if sqlew section already exists
  if (content.includes(SQLEW_GITIGNORE_MARKER)) {
    // Find missing entries
    const missingEntries = SQLEW_GITIGNORE_ENTRIES.filter(entry => !content.includes(entry));

    if (missingEntries.length === 0) {
      debugLog('DEBUG', 'sqlew gitignore section is up-to-date');
      return;
    }

    // Append missing entries after the marker
    try {
      const markerIndex = content.indexOf(SQLEW_GITIGNORE_MARKER);
      const afterMarker = markerIndex + SQLEW_GITIGNORE_MARKER.length;
      const newContent =
        content.slice(0, afterMarker) +
        '\n' + missingEntries.join('\n') +
        content.slice(afterMarker);
      fs.writeFileSync(gitignorePath, newContent, 'utf-8');
      debugLog('INFO', 'Added missing sqlew entries to .sqlew/.gitignore', {
        entries: missingEntries
      });
    } catch (error) {
      debugLog('WARN', 'Failed to update .sqlew/.gitignore', { error });
    }
    return;
  }

  // Build section to add (fresh install)
  const sectionLines = [
    SQLEW_GITIGNORE_MARKER,
    ...SQLEW_GITIGNORE_ENTRIES,
  ];

  // Write to .sqlew/.gitignore
  try {
    const newContent = content.trimEnd() + (content ? '\n' : '') + sectionLines.join('\n') + '\n';
    fs.writeFileSync(gitignorePath, newContent, 'utf-8');
    debugLog('INFO', 'Created .sqlew/.gitignore', {
      entries: SQLEW_GITIGNORE_ENTRIES.length
    });
  } catch (error) {
    debugLog('WARN', 'Failed to create .sqlew/.gitignore', { error });
  }
}
