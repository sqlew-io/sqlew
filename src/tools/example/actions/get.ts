/**
 * Example Tool - get Action
 * Get examples by tool, action, or topic
 *
 * TOML-based implementation (v5.0+)
 * Loads from src/help-data/*.toml instead of database
 *
 * v5.0.1: Environment-aware example filtering (sqlite/cloud/all)
 */

import { getHelpLoader } from '../../../help-loader.js';
import { shouldShowExample } from '../../../utils/example-filter.js';
import { ExampleGetParams, ExampleResult } from '../types.js';

/**
 * Get examples for specific tool/action/topic
 * Uses HelpSystemLoader (TOML-based)
 * Filters examples by current environment
 */
export async function getExample(
  params: ExampleGetParams
): Promise<ExampleResult[] | { error: string }> {
  const loader = await getHelpLoader();

  const results = loader.getExamples({
    tool: params.tool,
    action: params.action_name,
    topic: params.topic,
    limit: 50
  });

  // Filter by environment (sqlite/cloud)
  const filtered = results.filter(r => shouldShowExample(r.example.target_type));

  if (filtered.length === 0) {
    return { error: 'No examples found matching the criteria' };
  }

  return filtered.map((r, index) => ({
    example_id: index + 1,
    title: r.example.title,
    tool: r.tool,
    action: r.action,
    code: r.example.code,
    explanation: r.example.explanation
  }));
}
