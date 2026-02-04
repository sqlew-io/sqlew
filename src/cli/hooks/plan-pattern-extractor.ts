/**
 * Plan Pattern Extractor
 *
 * Extracts decisions and constraints from plan markdown using regex patterns.
 * Looks for specific markers: 📌 Decision and 🚫 Constraint
 *
 * Expected format in plan files:
 *
 * ## 📌 Decision: [hierarchical/key]
 * - **Value**: Decision description
 * - **Layer**: presentation | business | data | infrastructure | cross-cutting
 * - **Tags**: Why this decision was made
 *
 * ## 🚫 Constraint: [category]
 * - **Rule**: Constraint description
 * - **Priority**: critical | high | medium | low
 * - **Tags**: Why this constraint exists
 *
 * @since v4.2.2
 * @modified v4.2.3 - Added resolvePlanPath and buildConfirmationMessage
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ============================================================================
// Types
// ============================================================================

/**
 * Extracted decision from plan
 */
export interface ExtractedDecision {
  /** Hierarchical key (e.g., "auth/jwt-strategy") */
  key: string;
  /** Decision description */
  value: string;
  /** Layer (presentation, business, data, infrastructure, cross-cutting) */
  layer?: string;
  /** Tags for the decision (comma-separated) */
  tags?: string;
  /** Why this decision was made (for decision context) */
  rationale?: string;
  /** Alternatives considered (comma-separated) */
  alternatives?: string;
  /** Tradeoffs description */
  tradeoffs?: string;
}

/**
 * Extracted constraint from plan
 */
export interface ExtractedConstraint {
  /** Category (architecture, security, code-style, performance) */
  category: string;
  /** Constraint rule text */
  rule: string;
  /** Priority (critical, high, medium, low) */
  priority?: string;
  /** Tags for the constraint (comma-separated) */
  tags?: string;
}

/**
 * Result of pattern extraction
 */
export interface ExtractionResult {
  /** Extracted decisions */
  decisions: ExtractedDecision[];
  /** Extracted constraints */
  constraints: ExtractedConstraint[];
}

// ============================================================================
// Constants
// ============================================================================

/** Valid layer values */
const VALID_LAYERS = ['presentation', 'business', 'data', 'infrastructure', 'cross-cutting'];

/** Valid constraint categories */
const VALID_CATEGORIES = ['architecture', 'security', 'code-style', 'performance'];

/** Valid priority values */
const VALID_PRIORITIES = ['critical', 'high', 'medium', 'low'];

/** User's global plans directory */
const GLOBAL_PLANS_DIR = join(homedir(), '.claude', 'plans');

// ============================================================================
// Main Extraction Function
// ============================================================================

/**
 * Extract decisions and constraints from plan content using regex patterns
 *
 * @param content - Plan markdown content
 * @returns Extraction result with decisions and constraints
 */
export function extractPatternsFromPlan(content: string): ExtractionResult {
  const decisions: ExtractedDecision[] = [];
  const constraints: ExtractedConstraint[] = [];

  // Decision pattern: ## or ### 📌 Decision: [key]
  // Supports both h2 (##) and h3 (###) headings for flexibility
  // Captures: key, then body until next ## or ### or end
  // Note: \r?\n handles both Windows (CRLF) and Unix (LF) line endings
  const decisionRegex = /#{2,3}\s*📌\s*Decision:\s*(.+?)\r?\n([\s\S]*?)(?=#{2,3}\s|$)/gi;

  // Constraint pattern: ## or ### 🚫 Constraint: [category]
  // Supports both h2 (##) and h3 (###) headings for flexibility
  // Captures: category, then body until next ## or ### or end
  // Note: \r?\n handles both Windows (CRLF) and Unix (LF) line endings
  const constraintRegex = /#{2,3}\s*🚫\s*Constraint:\s*(.+?)\r?\n([\s\S]*?)(?=#{2,3}\s|$)/gi;

  // Parse decisions
  let match;
  while ((match = decisionRegex.exec(content)) !== null) {
    const key = match[1].trim();
    const body = match[2];

    const value = extractField(body, 'Value');
    if (!value) continue; // Skip if no value

    decisions.push({
      key: normalizeKey(key),
      value,
      layer: normalizeLayer(extractField(body, 'Layer')),
      tags: extractField(body, 'Tags'),
      rationale: extractField(body, 'Rationale') || undefined,
      alternatives: extractField(body, 'Alternatives') || undefined,
      tradeoffs: extractField(body, 'Tradeoffs') || undefined,
    });
  }

  // Parse constraints
  while ((match = constraintRegex.exec(content)) !== null) {
    const category = match[1].trim();
    const body = match[2];

    const rule = extractField(body, 'Rule');
    if (!rule) continue; // Skip if no rule

    constraints.push({
      category: normalizeCategory(category),
      rule,
      priority: normalizePriority(extractField(body, 'Priority')),
      tags: extractField(body, 'Tags'),
    });
  }

  return { decisions, constraints };
}

// ============================================================================
// Field Extraction
// ============================================================================

/**
 * Extract a field value from the body text
 *
 * Matches patterns like:
 * - **Field**: Value
 * - **Field**: Value (with more text)
 *
 * @param body - Body text containing fields
 * @param fieldName - Name of the field to extract
 * @returns Field value or empty string
 */
function extractField(body: string, fieldName: string): string {
  // Match: - **FieldName**: value (until newline or end)
  // Double backslashes needed in template literals for regex escapes
  // \r?\n handles both Windows (CRLF) and Unix (LF) line endings
  const regex = new RegExp(
    `-\\s*\\*\\*${fieldName}\\*\\*:\\s*(.+?)(?=\\r?\\n-\\s*\\*\\*|\\r?\\n\\r?\\n|$)`,
    'is'
  );
  const match = body.match(regex);
  return match ? match[1].trim() : '';
}

// ============================================================================
// Normalization
// ============================================================================

/**
 * Normalize decision key
 * Removes extra whitespace, converts to lowercase path format
 */
function normalizeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-\/]/g, '');
}

/**
 * Normalize layer value
 */
function normalizeLayer(layer: string | undefined): string {
  if (!layer) return 'cross-cutting';
  const normalized = layer.toLowerCase().trim();
  return VALID_LAYERS.includes(normalized) ? normalized : 'cross-cutting';
}

/**
 * Normalize category value
 * Handles bracket notation: [code-style] → code-style
 */
function normalizeCategory(category: string | undefined): string {
  if (!category) return 'architecture';
  // Strip brackets: [code-style] → code-style
  const stripped = category.replace(/^\[|\]$/g, '');
  const normalized = stripped.toLowerCase().trim();
  return VALID_CATEGORIES.includes(normalized) ? normalized : 'architecture';
}

/**
 * Normalize priority value
 */
function normalizePriority(priority: string | undefined): string {
  if (!priority) return 'medium';
  const normalized = priority.toLowerCase().trim();
  return VALID_PRIORITIES.includes(normalized) ? normalized : 'medium';
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if content contains any decision/constraint patterns
 *
 * @param content - Plan content
 * @returns true if patterns detected
 */
export function hasPatterns(content: string): boolean {
  return /#{2,3}\s*📌\s*Decision:/i.test(content) || /#{2,3}\s*🚫\s*Constraint:/i.test(content);
}

// ============================================================================
// Path Resolution
// ============================================================================

/**
 * Resolve plan file path
 * Plans are stored in user's global ~/.claude/plans/ directory
 *
 * @param planFileName - Plan file name (e.g., "my-plan.md")
 * @returns Full path to plan file, or null if not found
 */
export function resolvePlanPath(planFileName: string): string | null {
  const globalPath = join(GLOBAL_PLANS_DIR, planFileName);
  if (existsSync(globalPath)) {
    return globalPath;
  }
  return null;
}

// ============================================================================
// Message Formatting
// ============================================================================

/**
 * Build confirmation message for user after pattern extraction
 *
 * @param extracted - Extraction result
 * @param planFile - Plan file name
 * @returns Formatted confirmation message
 */
export function buildConfirmationMessage(extracted: ExtractionResult, planFile: string): string {
  const lines: string[] = [
    '',
    `📋 **Extracted from plan "${planFile}"**`,
    '',
  ];

  if (extracted.decisions.length > 0) {
    lines.push(`### ✅ Decisions (${extracted.decisions.length}) → auto-registered as draft`);
    for (const d of extracted.decisions) {
      const contextParts: string[] = [];
      if (d.rationale) contextParts.push('rationale');
      if (d.alternatives) {
        const count = d.alternatives.split(',').filter(s => s.trim()).length;
        contextParts.push(`${count} alternative${count > 1 ? 's' : ''}`);
      }
      if (d.tradeoffs) contextParts.push('tradeoffs');
      const contextSuffix = contextParts.length > 0 ? ` + context (${contextParts.join(', ')})` : '';
      lines.push(`- **${d.key}**: ${d.value}${contextSuffix}`);
      if (d.layer) lines.push(`  - Layer: ${d.layer}`);
    }
    lines.push('');
  }

  if (extracted.constraints.length > 0) {
    lines.push(`### ✅ Constraints (${extracted.constraints.length}) → auto-registered as active`);
    for (const c of extracted.constraints) {
      lines.push(`- **[${c.category}]** ${c.rule} (${c.priority || 'medium'})`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('💡 Decisions will be promoted to active when implementation files are edited.');
  lines.push('Check manually: `mcp__sqlew__decision({ action: "list", status: "draft" })`');

  return lines.join('\n');
}
