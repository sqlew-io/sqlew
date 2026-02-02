// API endpoint is determined at build time for security
// OSS side cannot modify this value
export const API_ENDPOINT = 'https://api.sqlew.io';

// Retry configuration
export const MAX_RETRIES = 3;
export const INITIAL_RETRY_DELAY = 1000; // 1 second
export const MAX_RETRY_DELAY = 30000; // 30 seconds
export const REQUEST_TIMEOUT = 30000; // 30 seconds

// Supported tools for SaaS backend
// help, example, use_case are handled locally (TOML files, no DB access)
export const SUPPORTED_TOOLS = [
  'decision',
  'constraint',
  'suggest',
] as const;

export type SupportedTool = (typeof SUPPORTED_TOOLS)[number];

// Actions that should be handled locally (no DB access required)
// Format: "tool.action"
export const LOCAL_ONLY_ACTIONS = [
  // decision - TOML/hardcoded help
  'decision.help',
  'decision.example',
  'decision.use_case',
  // constraint - plan TOML cache + help
  'constraint.suggest_pending',
  'constraint.help',
  'constraint.example',
  'constraint.use_case',
  // suggest - help only
  'suggest.help',
] as const;

export type LocalOnlyAction = (typeof LOCAL_ONLY_ACTIONS)[number];

/**
 * Check if a tool.action combination should be handled locally
 */
export function isLocalOnlyAction(tool: string, action: string): boolean {
  return LOCAL_ONLY_ACTIONS.includes(`${tool}.${action}` as LocalOnlyAction);
}
