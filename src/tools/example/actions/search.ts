/**
 * Example Tool - search Action
 * Search examples by keyword
 *
 * TOML-based implementation (v5.0+)
 * Loads from src/help-data/*.toml instead of database
 *
 * v5.0.1: Environment-aware example filtering (sqlite/cloud/all)
 */

import { getHelpLoader } from '../../../help-loader.js';
import { shouldShowExample } from '../../../utils/example-filter.js';
import { ExampleSearchParams, ExampleSearchResult } from '../types.js';

/**
 * Search examples by keyword with optional filters
 * Uses HelpSystemLoader (TOML-based)
 * Filters results by current environment
 */
export async function searchExamples(
  params: ExampleSearchParams
): Promise<ExampleSearchResult | { error: string }> {
  const loader = await getHelpLoader();

  const results = loader.searchExamples(params.keyword, {
    tool: params.tool,
    limit: 40  // Fetch more to account for filtering
  });

  // Filter by environment (sqlite/cloud)
  const filtered = results.filter(r => shouldShowExample(r.example.target_type));

  // Apply original limit after filtering
  const limited = filtered.slice(0, 20);

  return {
    total: limited.length,
    examples: limited.map((r, index) => ({
      example_id: index + 1,
      title: r.example.title,
      tool: r.tool,
      action: r.action,
      preview: r.example.code.substring(0, 100) + (r.example.code.length > 100 ? '...' : '')
    }))
  };
}
