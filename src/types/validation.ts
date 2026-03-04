/**
 * Parameter validation error types
 */

/**
 * Concise validation error for MCP tool parameter validation
 * Designed for token efficiency - references examples via ID instead of embedding full objects
 *
 * Example output: "Missing: key, value. See: decision.set"
 */
export interface ValidationError {
  error: string;                   // Concise error message (e.g., "Missing: key, value")
  action: string;                  // Action name (e.g., "set")
  reference: string;               // Reference ID for full docs (e.g., "decision.set")
  missing?: string[];              // Missing required params (only if present)
  typos?: Record<string, string>;  // Typo suggestions: provided → correct (only if detected)
  hint?: string;                   // Short actionable hint from spec
}

/**
 * Action not found error
 * Thrown when an invalid action is specified
 */
export interface ActionNotFoundError {
  error: string;
  tool: string;
  action_provided: string;
  available_actions: string[];
  did_you_mean?: string[];  // Similar action suggestions
}
