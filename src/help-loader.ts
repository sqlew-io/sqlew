/**
 * Help System Loader - TOML-based help data management
 *
 * Loads help documentation from TOML files instead of database.
 * Provides fast in-memory search and retrieval.
 *
 * Features:
 * - Startup-time loading (all files loaded once)
 * - In-memory caching (Map-based O(1) lookups)
 * - Keyword search across all examples
 * - Version-controllable documentation
 */

import { parse as parseTOML } from 'smol-toml';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface HelpParameter {
  name: string;
  type: string;
  required: boolean;
  description: string;
  default?: string;
}

export type ExampleTargetType = 'sqlite' | 'cloud' | 'all';

export interface HelpExample {
  title: string;
  code: string;
  explanation: string;
  target_type?: ExampleTargetType;
}

export interface HelpAction {
  name: string;
  description: string;
  params: HelpParameter[];
  examples: HelpExample[];
}

export interface HelpTool {
  name: string;
  description: string;
  actions: HelpAction[];
}

export interface UseCaseCategory {
  id: number;
  name: string;
  description: string;
}

export interface ActionStep {
  order: number;
  tool: string;
  action: string;
  description: string;
}

export interface UseCase {
  id: number;
  category: string;
  title: string;
  complexity: 'basic' | 'intermediate' | 'advanced';
  description: string;
  workflow: string;
  action_sequence: ActionStep[];
  full_example?: any;
}

// TOML file structure types (raw parsed data)
interface TomlParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
  default?: string;
}

interface TomlExample {
  title: string;
  code: string;
  explanation: string;
  target_type?: 'sqlite' | 'cloud' | 'all';
}

interface TomlAction {
  name: string;
  description: string;
  params?: TomlParam[];
  examples?: TomlExample[];
}

interface TomlToolFile {
  tool: {
    name: string;
    description: string;
  };
  actions: TomlAction[];
}

interface TomlCategory {
  id: number;
  name: string;
  description: string;
}

interface TomlCategoriesFile {
  categories: TomlCategory[];
}

interface TomlActionSequence {
  order: number;
  tool: string;
  action: string;
  description?: string;
}

interface TomlUseCaseFile {
  use_case: {
    id: number;
    category: string;
    title: string;
    complexity: string;
    description: string;
    workflow: string;
  };
  action_sequence?: TomlActionSequence[];
  full_example?: any;
}

// =============================================================================
// HELP SYSTEM LOADER CLASS
// =============================================================================

export class HelpSystemLoader {
  private tools: Map<string, HelpTool> = new Map();
  private useCases: Map<number, UseCase> = new Map();
  private categories: Map<string, UseCaseCategory> = new Map();
  private loaded = false;
  private helpDataDir: string;

  constructor(helpDataDir?: string) {
    // Default to src/help-data relative to this file
    if (helpDataDir) {
      this.helpDataDir = helpDataDir;
    } else {
      // ESM: use import.meta.url to get current file path
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      this.helpDataDir = path.join(__dirname, 'help-data');
    }
  }

  /**
   * Load all help data from TOML files
   * Called once at startup
   */
  async loadAll(): Promise<void> {
    if (this.loaded) return;

    try {
      // Load tool files
      const toolFiles = ['decision', 'constraint', 'project', 'suggest', 'help', 'example', 'use_case', 'queue'];
      for (const toolName of toolFiles) {
        const filePath = path.join(this.helpDataDir, `${toolName}.toml`);
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf-8');
          const parsed = parseTOML(content) as unknown as TomlToolFile;
          this.tools.set(toolName, this.parseToolFile(parsed));
        }
      }

      // Load categories
      const categoriesPath = path.join(this.helpDataDir, 'use-cases', '_categories.toml');
      if (fs.existsSync(categoriesPath)) {
        const content = fs.readFileSync(categoriesPath, 'utf-8');
        const parsed = parseTOML(content) as unknown as TomlCategoriesFile;
        for (const cat of parsed.categories) {
          this.categories.set(cat.name, cat);
        }
      }

      // Load use case files
      const useCasesDir = path.join(this.helpDataDir, 'use-cases');
      if (fs.existsSync(useCasesDir)) {
        const files = fs.readdirSync(useCasesDir);
        for (const file of files) {
          if (file.endsWith('.toml') && file !== '_categories.toml') {
            const filePath = path.join(useCasesDir, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            const parsed = parseTOML(content) as unknown as TomlUseCaseFile;
            const useCase = this.parseUseCaseFile(parsed);
            this.useCases.set(useCase.id, useCase);
          }
        }
      }

      this.loaded = true;
    } catch (error) {
      console.error('Failed to load help data:', error);
      throw error;
    }
  }

  /**
   * Ensure data is loaded before accessing
   */
  private ensureLoaded(): void {
    if (!this.loaded) {
      throw new Error('Help data not loaded. Call loadAll() first.');
    }
  }

  // ===========================================================================
  // TOOL & ACTION QUERIES
  // ===========================================================================

  /**
   * Get a specific tool by name
   */
  getTool(toolName: string): HelpTool | undefined {
    this.ensureLoaded();
    return this.tools.get(toolName);
  }

  /**
   * Get all available tools
   */
  getAllTools(): HelpTool[] {
    this.ensureLoaded();
    return Array.from(this.tools.values());
  }

  /**
   * Get available tool names
   */
  getToolNames(): string[] {
    this.ensureLoaded();
    return Array.from(this.tools.keys());
  }

  /**
   * Get a specific action from a tool
   */
  getAction(toolName: string, actionName: string): HelpAction | undefined {
    this.ensureLoaded();
    const tool = this.tools.get(toolName);
    if (!tool) return undefined;
    return tool.actions.find(a => a.name === actionName);
  }

  /**
   * Get all actions for a tool
   */
  getActionsForTool(toolName: string): HelpAction[] {
    this.ensureLoaded();
    const tool = this.tools.get(toolName);
    return tool ? tool.actions : [];
  }

  /**
   * Get action names for a tool
   */
  getActionNames(toolName: string): string[] {
    this.ensureLoaded();
    const tool = this.tools.get(toolName);
    return tool ? tool.actions.map(a => a.name) : [];
  }

  // ===========================================================================
  // EXAMPLE QUERIES
  // ===========================================================================

  /**
   * Search examples by keyword
   * Searches title, explanation, and code
   */
  searchExamples(keyword: string, options?: {
    tool?: string;
    limit?: number;
  }): Array<{
    tool: string;
    action: string;
    example: HelpExample;
  }> {
    this.ensureLoaded();
    const results: Array<{ tool: string; action: string; example: HelpExample }> = [];
    const lowerKeyword = keyword.toLowerCase();
    const limit = options?.limit ?? 20;

    for (const [toolName, tool] of this.tools) {
      if (options?.tool && toolName !== options.tool) continue;

      for (const action of tool.actions) {
        for (const example of action.examples) {
          if (
            example.title.toLowerCase().includes(lowerKeyword) ||
            example.explanation.toLowerCase().includes(lowerKeyword) ||
            example.code.toLowerCase().includes(lowerKeyword)
          ) {
            results.push({ tool: toolName, action: action.name, example });
            if (results.length >= limit) return results;
          }
        }
      }
    }

    return results;
  }

  /**
   * Get examples for a specific tool/action
   */
  getExamples(options?: {
    tool?: string;
    action?: string;
    topic?: string;
    limit?: number;
  }): Array<{
    tool: string;
    action: string;
    example: HelpExample;
  }> {
    this.ensureLoaded();
    const results: Array<{ tool: string; action: string; example: HelpExample }> = [];
    const limit = options?.limit ?? 20;

    for (const [toolName, tool] of this.tools) {
      if (options?.tool && toolName !== options.tool) continue;

      for (const action of tool.actions) {
        if (options?.action && action.name !== options.action) continue;

        for (const example of action.examples) {
          // Topic filter (searches title and explanation)
          if (options?.topic) {
            const lowerTopic = options.topic.toLowerCase();
            if (
              !example.title.toLowerCase().includes(lowerTopic) &&
              !example.explanation.toLowerCase().includes(lowerTopic)
            ) {
              continue;
            }
          }

          results.push({ tool: toolName, action: action.name, example });
          if (results.length >= limit) return results;
        }
      }
    }

    return results;
  }

  /**
   * List all examples with pagination
   */
  listExamples(options?: {
    tool?: string;
    limit?: number;
    offset?: number;
  }): {
    total: number;
    examples: Array<{ tool: string; action: string; title: string }>;
  } {
    this.ensureLoaded();
    const all: Array<{ tool: string; action: string; title: string }> = [];

    for (const [toolName, tool] of this.tools) {
      if (options?.tool && toolName !== options.tool) continue;

      for (const action of tool.actions) {
        for (const example of action.examples) {
          all.push({ tool: toolName, action: action.name, title: example.title });
        }
      }
    }

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 20;
    const sliced = all.slice(offset, offset + limit);

    return { total: all.length, examples: sliced };
  }

  // ===========================================================================
  // USE CASE QUERIES
  // ===========================================================================

  /**
   * Get a use case by ID
   */
  getUseCase(id: number): UseCase | undefined {
    this.ensureLoaded();
    return this.useCases.get(id);
  }

  /**
   * Search use cases by keyword
   */
  searchUseCases(keyword: string, options?: {
    category?: string;
    complexity?: string;
    limit?: number;
  }): UseCase[] {
    this.ensureLoaded();
    const results: UseCase[] = [];
    const lowerKeyword = keyword.toLowerCase();
    const limit = options?.limit ?? 20;

    for (const useCase of this.useCases.values()) {
      if (options?.category && useCase.category !== options.category) continue;
      if (options?.complexity && useCase.complexity !== options.complexity) continue;

      if (
        useCase.title.toLowerCase().includes(lowerKeyword) ||
        useCase.description.toLowerCase().includes(lowerKeyword)
      ) {
        results.push(useCase);
        if (results.length >= limit) break;
      }
    }

    return results;
  }

  /**
   * List use cases with filtering and pagination
   */
  listUseCases(options?: {
    category?: string;
    complexity?: string;
    limit?: number;
    offset?: number;
  }): {
    total: number;
    filtered: number;
    use_cases: Array<{
      id: number;
      title: string;
      complexity: string;
      category: string;
    }>;
    categories?: string[];
  } {
    this.ensureLoaded();

    // Get all use cases
    const all = Array.from(this.useCases.values());
    const total = all.length;

    // Apply filters
    let filtered = all;
    if (options?.category) {
      filtered = filtered.filter(uc => uc.category === options.category);
    }
    if (options?.complexity) {
      filtered = filtered.filter(uc => uc.complexity === options.complexity);
    }

    // Sort by complexity (basic -> intermediate -> advanced) then by id
    const complexityOrder = { basic: 1, intermediate: 2, advanced: 3 };
    filtered.sort((a, b) => {
      const aOrder = complexityOrder[a.complexity] ?? 0;
      const bOrder = complexityOrder[b.complexity] ?? 0;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.id - b.id;
    });

    // Paginate
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 20;
    const paged = filtered.slice(offset, offset + limit);

    const result: {
      total: number;
      filtered: number;
      use_cases: Array<{ id: number; title: string; complexity: string; category: string }>;
      categories?: string[];
    } = {
      total,
      filtered: filtered.length,
      use_cases: paged.map(uc => ({
        id: uc.id,
        title: uc.title,
        complexity: uc.complexity,
        category: uc.category
      }))
    };

    // Include categories if no category filter
    if (!options?.category) {
      result.categories = Array.from(this.categories.keys()).sort();
    }

    return result;
  }

  /**
   * Get available categories
   */
  getCategories(): UseCaseCategory[] {
    this.ensureLoaded();
    return Array.from(this.categories.values());
  }

  // ===========================================================================
  // WORKFLOW HINTS
  // ===========================================================================

  /**
   * Get suggested next actions based on use case action sequences
   */
  getNextActions(toolName: string, actionName: string): Array<{
    action: string;
    frequency: 'very common' | 'common' | 'occasional';
    context: string;
  }> {
    this.ensureLoaded();

    // Count next actions from use case sequences
    const nextActionCounts: Map<string, { count: number; contexts: string[] }> = new Map();
    let totalOccurrences = 0;

    for (const useCase of this.useCases.values()) {
      const sequence = useCase.action_sequence;
      for (let i = 0; i < sequence.length - 1; i++) {
        if (sequence[i].tool === toolName && sequence[i].action === actionName) {
          totalOccurrences++;
          const nextStep = sequence[i + 1];
          const nextAction = `${nextStep.tool}:${nextStep.action}`;
          const existing = nextActionCounts.get(nextAction) || { count: 0, contexts: [] };
          existing.count++;
          if (existing.contexts.length < 3) {
            existing.contexts.push(useCase.title);
          }
          nextActionCounts.set(nextAction, existing);
        }
      }
    }

    if (totalOccurrences === 0) return [];

    // Sort by frequency
    const sorted = Array.from(nextActionCounts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5);

    return sorted.map(([action, data]) => {
      const percentage = (data.count / totalOccurrences) * 100;
      let frequency: 'very common' | 'common' | 'occasional';
      if (percentage >= 66) frequency = 'very common';
      else if (percentage >= 33) frequency = 'common';
      else frequency = 'occasional';

      return {
        action,
        frequency,
        context: data.contexts[0] || ''
      };
    });
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private parseToolFile(parsed: TomlToolFile): HelpTool {
    const actions: HelpAction[] = parsed.actions.map(action => ({
      name: action.name,
      description: action.description,
      params: (action.params ?? []).map(p => ({
        name: p.name,
        type: p.type,
        required: p.required,
        description: p.required
          ? `🔴 REQUIRED: ${p.description}`
          : `⚪ OPTIONAL: ${p.description}`,
        ...(p.default !== undefined && { default: p.default })
      })),
      examples: action.examples ?? []
    }));

    return {
      name: parsed.tool.name,
      description: parsed.tool.description,
      actions
    };
  }

  private parseUseCaseFile(parsed: TomlUseCaseFile): UseCase {
    return {
      id: parsed.use_case.id,
      category: parsed.use_case.category,
      title: parsed.use_case.title,
      complexity: parsed.use_case.complexity as 'basic' | 'intermediate' | 'advanced',
      description: parsed.use_case.description,
      workflow: parsed.use_case.workflow,
      action_sequence: (parsed.action_sequence ?? []).map(s => ({
        order: s.order,
        tool: s.tool,
        action: s.action,
        description: s.description ?? ''
      })),
      full_example: parsed.full_example
    };
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let loaderInstance: HelpSystemLoader | null = null;

/**
 * Get the singleton help loader instance
 * Automatically loads data on first access
 */
export async function getHelpLoader(): Promise<HelpSystemLoader> {
  if (!loaderInstance) {
    loaderInstance = new HelpSystemLoader();
    await loaderInstance.loadAll();
  }
  return loaderInstance;
}

/**
 * Reset the loader (useful for testing)
 */
export function resetHelpLoader(): void {
  loaderInstance = null;
}
