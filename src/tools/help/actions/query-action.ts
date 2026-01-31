/**
 * Help Tool - query_action Action
 * Get action documentation with parameters and examples
 *
 * TOML-based implementation (v5.0+)
 * Loads from src/help-data/*.toml instead of database
 *
 * v5.0.1: Environment-aware example filtering (sqlite/cloud/all)
 */

import { getHelpLoader } from '../../../help-loader.js';
import { filterExamplesByEnvironment } from '../../../utils/example-filter.js';
import { HelpQueryActionParams, HelpActionResult } from '../types.js';

/**
 * Query single action with parameters and examples
 * Uses HelpSystemLoader (TOML-based)
 */
export async function queryAction(
  params: HelpQueryActionParams
): Promise<HelpActionResult | { error: string; available_actions?: string[] }> {
  const loader = await getHelpLoader();

  // Check if tool exists
  const tool = loader.getTool(params.tool);
  if (!tool) {
    return {
      error: `Tool "${params.tool}" not found`,
      available_actions: loader.getToolNames()
    };
  }

  // Get action
  const action = loader.getAction(params.tool, params.target_action);
  if (!action) {
    return {
      error: `Action "${params.target_action}" not found for tool "${params.tool}"`,
      available_actions: loader.getActionNames(params.tool)
    };
  }

  // Filter examples by current environment (sqlite/cloud)
  const filteredExamples = filterExamplesByEnvironment(action.examples);

  return {
    tool: params.tool,
    action: action.name,
    description: action.description,
    parameters: action.params,
    examples: filteredExamples
  };
}
