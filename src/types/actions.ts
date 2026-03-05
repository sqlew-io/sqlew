/**
 * MCP tool action type unions for compile-time safety
 */

/**
 * Decision tool actions
 * Provides compile-time type checking for action parameters without breaking MCP wire protocol
 */
export type DecisionAction =
  | 'set' | 'get' | 'list' | 'search_tags' | 'search_layer'
  | 'versions' | 'quick_set' | 'search_advanced' | 'set_batch'
  | 'has_updates' | 'set_from_template' | 'create_template'
  | 'list_templates' | 'hard_delete' | 'add_decision_context'
  | 'list_decision_contexts'
  | 'create_policy' | 'list_policies' | 'set_from_policy'  // v3.9.0 policy actions
  | 'analytics'  // v3.9.0 analytics action
  | 'help' | 'example' | 'use_case';

/**
 * Constraint tool actions
 * Provides compile-time type checking for action parameters
 */
export type ConstraintAction =
  | 'add' | 'get' | 'activate' | 'deactivate' | 'suggest_pending'
  | 'help' | 'example' | 'use_case';

/**
 * Config tool actions
 * Provides compile-time type checking for action parameters
 */
export type ConfigAction =
  | 'get' | 'update'
  | 'help' | 'example' | 'use_case';

/**
 * Example tool actions
 * Provides compile-time type checking for action parameters
 */
export type ExampleAction =
  | 'get' | 'search' | 'list_all'
  | 'help' | 'example';
