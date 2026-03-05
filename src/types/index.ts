/**
 * Barrel exports for types module
 * All types re-exported from domain-specific modules
 */

// Database connection type
import { Database } from 'better-sqlite3';
export type { Database };

// Enums
export { Status, MessageType, Priority } from './enums.js';
export type { StatusString } from './enums.js';

// Master entities
export type { ContextKey, ConstraintCategory, Layer, Tag, Scope } from './master-entities.js';

// Transaction entities
export type {
  Decision, DecisionNumeric, DecisionHistory,
  DecisionTag, DecisionScope,
  Constraint, ConstraintTag,
  ActivityLog, DecisionTemplate,
} from './transaction-entities.js';

// View entities
export type {
  TaggedDecision, ActiveContext, LayerSummary,
  UnreadMessagesByPriority, TaggedConstraint, ActivityLogEntry,
} from './view-entities.js';

// Validation
export type { ValidationError, ActionNotFoundError } from './validation.js';

// Actions
export type { DecisionAction, ConstraintAction, ConfigAction, ExampleAction } from './actions.js';

// Import/Export system
export type {
  JsonImportOptions, ImportValidationResult,
  IdMapping, ImportIdMappings, ImportContext,
  ImportStats, JsonImportResult,
} from './import-export.js';

// Decision params
export type {
  SetDecisionParams, QuickSetDecisionParams,
  GetContextParams, GetDecisionParams, HardDeleteDecisionParams,
  SearchByTagsParams, GetVersionsParams, SearchByLayerParams,
  SearchAdvancedParams, HasUpdatesParams,
} from './decision/params.js';

// Decision responses
export type {
  SetDecisionResponse, QuickSetDecisionResponse,
  GetContextResponse, GetDecisionResponse, HardDeleteDecisionResponse,
  SearchByTagsResponse, GetVersionsResponse, SearchByLayerResponse,
  SearchAdvancedResponse, HasUpdatesResponse,
  GetStatsResponse, FlushWALResponse,
} from './decision/responses.js';

// Decision templates
export type {
  SetFromTemplateParams, CreateTemplateParams, ListTemplatesParams,
  SetFromTemplateResponse, CreateTemplateResponse, ListTemplatesResponse,
} from './decision/templates.js';

// Decision batch
export type { SetDecisionBatchParams, SetDecisionBatchResponse } from './decision/batch.js';

// Constraint params
export type {
  AddConstraintParams, GetConstraintsParams, DeactivateConstraintParams,
} from './constraint/params.js';

// Constraint responses
export type {
  AddConstraintResponse, GetConstraintsResponse, DeactivateConstraintResponse,
} from './constraint/responses.js';
