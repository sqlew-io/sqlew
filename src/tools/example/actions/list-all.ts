/**
 * Example Tool - list_all Action
 * List all available examples with filtering
 *
 * TOML-based implementation (v5.0+)
 * Loads from src/help-data/*.toml instead of database
 *
 * v5.0.1: Environment-aware example filtering (sqlite/cloud/all)
 */

import { getHelpLoader } from '../../../help-loader.js';
import { shouldShowExample } from '../../../utils/example-filter.js';
import { ExampleListAllParams, ExampleListAllResult } from '../types.js';

/**
 * List all examples with optional filtering and pagination
 * Uses HelpSystemLoader (TOML-based)
 * Filters by current environment before pagination
 */
export async function listAllExamples(
  params: ExampleListAllParams
): Promise<ExampleListAllResult | { error: string }> {
  const loader = await getHelpLoader();

  // Get all examples first (we need to filter before pagination)
  const allResult = loader.listExamples({
    tool: params.tool,
    limit: 1000,  // Get all for filtering
    offset: 0
  });

  // Get full examples to access target_type
  const fullExamples = loader.getExamples({
    tool: params.tool,
    limit: 1000
  });

  // Filter by environment
  const filtered = fullExamples.filter(e => shouldShowExample(e.example.target_type));

  // Apply pagination
  const offset = params.offset || 0;
  const limit = params.limit || 20;
  const paginated = filtered.slice(offset, offset + limit);

  return {
    total: filtered.length,
    filtered: paginated.length,
    examples: paginated.map((e, index) => ({
      example_id: offset + index + 1,
      title: e.example.title,
      tool: e.tool,
      action: e.action
    }))
  };
}
