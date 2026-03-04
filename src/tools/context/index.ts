/**
 * Context/Decision tool - Barrel export
 *
 * Exports all decision-related actions from modular structure
 */

// Action exports
export { setDecision } from './actions/set.js';
export { getDecision } from './actions/get.js';
export { getContext } from './actions/list.js';
export { searchByTags } from './actions/search-tags.js';
export { searchByLayer } from './actions/search-layer.js';
export { searchAdvanced } from './actions/search-advanced.js';
export { getVersions } from './actions/versions.js';
export { quickSetDecision } from './actions/quick-set.js';
export { setDecisionBatch } from './actions/batch-set.js';
export { hasUpdates } from './actions/has-updates.js';
export { setFromTemplate } from './actions/set-from-template.js';
export { createTemplate } from './actions/create-template.js';
export { listTemplates } from './actions/list-templates.js';
export { hardDeleteDecision } from './actions/hard-delete.js';
export { addDecisionContextAction } from './actions/add-context.js';
export { listDecisionContextsAction } from './actions/list-contexts.js';
export { handleAnalytics } from './actions/analytics.js';
// Policy actions (v3.9.0)
export { createPolicy } from './actions/create-policy.js';
export { listPolicies } from './actions/list-policies.js';
export { setFromPolicy } from './actions/set-from-policy.js';
// Help exports
export { decisionHelp } from './help/help.js';
export { decisionExample } from './help/example.js';

// Type re-exports
export type {
  SetDecisionParams,
  GetContextParams,
  GetDecisionParams,
  SetDecisionResponse,
  GetContextResponse,
  GetDecisionResponse,
  TaggedDecision,
  Status,
  SearchByTagsParams,
  SearchByTagsResponse,
  GetVersionsParams,
  GetVersionsResponse,
  SearchByLayerParams,
  SearchByLayerResponse,
  QuickSetDecisionParams,
  QuickSetDecisionResponse,
  SearchAdvancedParams,
  SearchAdvancedResponse,
  SetDecisionBatchParams,
  SetDecisionBatchResponse,
  SetFromTemplateParams,
  SetFromTemplateResponse,
  CreateTemplateParams,
  CreateTemplateResponse,
  ListTemplatesParams,
  ListTemplatesResponse,
  HasUpdatesParams,
  HasUpdatesResponse,
  HardDeleteDecisionParams,
  HardDeleteDecisionResponse,
  DecisionAction
} from './types.js';

// Analytics type exports
export type { AnalyticsParams, AnalyticsResponse } from './actions/analytics.js';
