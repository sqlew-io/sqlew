/**
 * Public library surface for harness adapters (omp Extension, etc.).
 *
 * Import as `sqlew/hooks`. Must NOT boot the MCP server or CLI entry.
 *
 * @since v5.4.0
 */

export {
  buildSessionContext,
  formatContextBlock,
  loadSnapshot,
  resolveBudget,
  shouldInjectOnPrompt,
  resolveGrokRequirePatterns,
  resolveOmpRequirePatterns,
} from './cli/hooks/session-context.js';

export {
  processPlanPatterns,
  type ProcessPlanResult,
} from './cli/hooks/plan-processor.js';

export {
  extractPatternsFromPlan,
  hasPatterns,
  hasFilledPatterns,
  buildConfirmationMessage,
} from './cli/hooks/plan-pattern-extractor.js';

export {
  loadCurrentPlan,
  saveCurrentPlan,
  clearCurrentPlan,
  loadSessionContextMarker,
  saveSessionContextMarker,
  type CurrentPlanInfo,
  type SessionContextMarker,
} from './config/global-config.js';

export {
  enqueueDecisionCreate,
  enqueueConstraintCreate,
  enqueueDecisionContextCreate,
  enqueueDecisionUpdate,
  enqueueConstraintActivate,
} from './utils/hook-queue.js';

export {
  ENFORCEMENT_FULL,
  ENFORCEMENT_SHORT,
} from './cli/hooks/on-prompt.js';

export {
  ompPlansDir,
  materializeOmpPlan,
  trackOmpPlanFromPath,
  extractSlugFromOmpPlanPath,
  ensureOmpPlanTemplate,
  resolveOmpPlanFsPath,
  resolveOmpLocalRoot,
  type OmpLocalResolveOpts,
} from './cli/hooks/omp-plan.js';

export {
  isOmpPlanPath,
  OMP_TOOL_MAP,
} from './cli/hooks/stdin-parser.js';
