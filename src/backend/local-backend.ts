/**
 * LocalBackend - Direct database connection via Knex
 *
 * This backend executes tool actions directly against the local database.
 * All existing tool logic is wrapped here for the ToolBackend abstraction.
 */

import type { ToolBackend, HealthCheckResult, BackendType } from './types.js';
import { getAdapter } from '../database.js';
import {
  setDecision, getContext, getDecision, searchByTags, getVersions, searchByLayer,
  quickSetDecision, searchAdvanced, setDecisionBatch, hasUpdates, setFromTemplate,
  createTemplate, listTemplates, hardDeleteDecision, addDecisionContextAction,
  listDecisionContextsAction, handleAnalytics, decisionHelp, decisionExample
} from '../tools/context/index.js';
import {
  addConstraint, getConstraints, activateConstraint, deactivateConstraint, suggestPendingConstraints,
  constraintHelp, constraintExample, activateConstraintsByTag
} from '../tools/constraints/index.js';
import {
  queryAction, queryParams, queryTool, workflowHints, batchGuide, errorRecovery,
  helpHelp, helpExample
} from '../tools/help/index.js';
import {
  getUseCase, searchUseCases, listAllUseCases, useCaseHelp, useCaseExample
} from '../tools/use_case/index.js';
import {
  getExample, searchExamples, listAllExamples, exampleHelp, exampleExample
} from '../tools/example/index.js';
import { trackAndReturnHelp } from '../utils/help-tracking.js';
import { handleSuggestAction } from '../tools/suggest/index.js';
import {
  listQueue, clearQueue, removeFromQueue
} from '../tools/queue/index.js';
import { getHelpLoader } from '../help-loader.js';
import { ProjectContext } from '../utils/project-context.js';

/**
 * LocalBackend implementation
 *
 * Wraps all existing tool logic for the ToolBackend abstraction.
 */
export class LocalBackend implements ToolBackend {
  readonly backendType: BackendType = 'local';

  /**
   * Execute a tool action against the local database
   */
  async execute<TResponse = unknown>(
    tool: string,
    action: string,
    params: Record<string, unknown>
  ): Promise<TResponse> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = params as any;
    let result: unknown;

    switch (tool) {
      case 'decision':
        result = await this.executeDecision(action, p);
        break;
      case 'constraint':
        result = await this.executeConstraint(action, p);
        break;
      case 'help':
        result = await this.executeHelp(action, p);
        break;
      case 'example':
        result = await this.executeExample(action, p);
        break;
      case 'use_case':
        result = await this.executeUseCase(action, p);
        break;
      case 'suggest':
        result = await handleSuggestAction(p);
        break;
      case 'queue':
        result = this.executeQueue(action, p);
        break;
      default:
        throw new Error(`Unknown tool: ${tool}`);
    }

    return result as TResponse;
  }

  /**
   * Health check - verify database connection
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const adapter = getAdapter();
      // Simple query to verify connection
      await adapter.getKnex().raw('SELECT 1');
      return {
        ok: true,
        latency: Date.now() - start,
      };
    } catch (error) {
      return {
        ok: false,
        latency: Date.now() - start,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Disconnect from database
   */
  async disconnect(): Promise<void> {
    try {
      const adapter = getAdapter();
      await adapter.disconnect();
    } catch (error) {
      // Ignore "not initialized" errors - nothing to disconnect
      if (error instanceof Error && error.message.includes('not initialized')) {
        return;
      }
      throw error;
    }
  }

  // ========== Private execute methods for each tool ==========

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async executeDecision(action: string, params: any): Promise<unknown> {
    switch (action) {
      case 'set': return await setDecision(params);
      case 'get': return await getDecision(params);
      case 'list': return await getContext(params);
      case 'search_tags': return await searchByTags({
        tags: params.tags,
        match_mode: params.tag_match,
        status: params.status,
        layer: params.layer
      });
      case 'search_layer': return await searchByLayer({
        layer: params.layer,
        status: params.status,
        include_tags: params.include_tags
      });
      case 'versions': return await getVersions(params);
      case 'quick_set': return await quickSetDecision(params);
      case 'search_advanced': return await searchAdvanced({
        layers: params.layers,
        tags_all: params.tags_all,
        tags_any: params.tags_any,
        exclude_tags: params.exclude_tags,
        scopes: params.scopes,
        updated_after: params.updated_after,
        updated_before: params.updated_before,
        decided_by: params.decided_by,
        statuses: params.statuses,
        search_text: params.search_text,
        sort_by: params.sort_by,
        sort_order: params.sort_order,
        limit: params.limit,
        offset: params.offset
      });
      case 'set_batch': {
        let decisions = params.decisions;
        if (typeof decisions === 'string') {
          try {
            decisions = JSON.parse(decisions);
          } catch (error) {
            throw new Error(`Invalid JSON in "decisions" parameter: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        return await setDecisionBatch({ decisions, atomic: params.atomic });
      }
      case 'has_updates': return await hasUpdates({
        agent_name: params.agent_name,
        since_timestamp: params.since_timestamp
      });

      // Policy actions (v3.9.0 - renamed from template actions)
      case 'create_policy': return await createTemplate(params);
      case 'list_policies': return await listTemplates(params);
      case 'set_from_policy': return await setFromTemplate(params);

      // Template actions (backward compatibility)
      case 'set_from_template': return await setFromTemplate(params);
      case 'create_template': return await createTemplate(params);
      case 'list_templates': return await listTemplates(params);

      case 'hard_delete': return await hardDeleteDecision(params);
      case 'add_decision_context': return await addDecisionContextAction(params);
      case 'list_decision_contexts': return await listDecisionContextsAction(params);
      case 'analytics': return await handleAnalytics(params);
      case 'help': {
        const helpContent = decisionHelp();
        trackAndReturnHelp('decision', 'help', JSON.stringify(helpContent));
        return helpContent;
      }
      case 'example': {
        const exampleContent = decisionExample();
        trackAndReturnHelp('decision', 'example', JSON.stringify(exampleContent));
        return exampleContent;
      }
      case 'use_case': {
        return await listAllUseCases({
          action: 'list_all',
          category: params.category,
          complexity: params.complexity,
          limit: params.limit,
          offset: params.offset
        });
      }
      default: throw new Error(`Unknown decision action: ${action}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async executeConstraint(action: string, params: any): Promise<unknown> {
    switch (action) {
      case 'add': return await addConstraint(params);
      case 'get': return await getConstraints(params);
      case 'activate': return await activateConstraint(params);
      case 'activate_by_tag': return await activateConstraintsByTag(params.tag);
      case 'deactivate': return await deactivateConstraint(params);
      case 'suggest_pending': return await suggestPendingConstraints(params);
      case 'help': {
        const constraintHelpContent = constraintHelp();
        trackAndReturnHelp('constraint', 'help', JSON.stringify(constraintHelpContent));
        return constraintHelpContent;
      }
      case 'example': {
        const constraintExampleContent = constraintExample();
        trackAndReturnHelp('constraint', 'example', JSON.stringify(constraintExampleContent));
        return constraintExampleContent;
      }
      case 'use_case': {
        return await listAllUseCases({
          action: 'list_all',
          category: params.category,
          complexity: params.complexity,
          limit: params.limit,
          offset: params.offset
        });
      }
      default: throw new Error(`Unknown constraint action: ${action}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async executeHelp(action: string, params: any): Promise<unknown> {
    switch (action) {
      case 'query_action':
        if (!params.tool || !params.target_action) {
          return { error: 'Parameters "tool" and "target_action" are required for query_action' };
        }
        return await queryAction({ action: 'query_action', tool: params.tool, target_action: params.target_action });
      case 'query_params':
        if (!params.tool || !params.target_action) {
          return { error: 'Parameters "tool" and "target_action" are required for query_params' };
        }
        return await queryParams({ action: 'query_params', tool: params.tool, target_action: params.target_action });
      case 'query_tool':
        if (!params.tool) {
          return { error: 'Parameter "tool" is required for query_tool' };
        }
        return await queryTool({ action: 'query_tool', tool: params.tool });
      case 'workflow_hints':
        if (!params.tool || !params.current_action) {
          return { error: 'Parameters "tool" and "current_action" are required for workflow_hints' };
        }
        return await workflowHints({ action: 'workflow_hints', tool: params.tool, current_action: params.current_action });
      case 'batch_guide':
        if (!params.operation) {
          return { error: 'Parameter "operation" is required for batch_guide' };
        }
        return await batchGuide({ action: 'batch_guide', operation: params.operation });
      case 'error_recovery':
        if (!params.error_message) {
          return { error: 'Parameter "error_message" is required for error_recovery' };
        }
        return await errorRecovery({
          action: 'error_recovery',
          error_message: params.error_message,
          tool: params.tool
        });
      case 'help': {
        const helpHelpContent = helpHelp();
        trackAndReturnHelp('help', 'help', JSON.stringify(helpHelpContent));
        return helpHelpContent;
      }
      case 'example': {
        const helpExampleContent = helpExample();
        trackAndReturnHelp('help', 'example', JSON.stringify(helpExampleContent));
        return helpExampleContent;
      }
      default: throw new Error(`Unknown help action: ${action}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async executeExample(action: string, params: any): Promise<unknown> {
    switch (action) {
      case 'get':
        return await getExample({
          action: 'get',
          tool: params.tool,
          action_name: params.action_name,
          topic: params.topic
        });
      case 'search':
        if (!params.keyword) {
          return { error: 'Parameter "keyword" is required for search' };
        }
        return await searchExamples({
          action: 'search',
          keyword: params.keyword,
          tool: params.tool,
          action_name: params.action_name,
          complexity: params.complexity
        });
      case 'list_all':
        return await listAllExamples({
          action: 'list_all',
          tool: params.tool,
          complexity: params.complexity,
          limit: params.limit,
          offset: params.offset
        });
      case 'help': {
        const exampleHelpContent = exampleHelp();
        trackAndReturnHelp('example', 'help', JSON.stringify(exampleHelpContent));
        return exampleHelpContent;
      }
      case 'example': {
        const exampleExampleContent = exampleExample();
        trackAndReturnHelp('example', 'example', JSON.stringify(exampleExampleContent));
        return exampleExampleContent;
      }
      default: throw new Error(`Unknown example action: ${action}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async executeUseCase(action: string, params: any): Promise<unknown> {
    switch (action) {
      case 'get':
        if (!params.use_case_id) {
          return { error: 'Parameter "use_case_id" is required for get' };
        }
        return await getUseCase({ action: 'get', use_case_id: params.use_case_id });
      case 'search':
        if (!params.keyword) {
          return { error: 'Parameter "keyword" is required for search' };
        }
        return await searchUseCases({
          action: 'search',
          keyword: params.keyword,
          category: params.category,
          complexity: params.complexity
        });
      case 'list_all':
        return await listAllUseCases({
          action: 'list_all',
          category: params.category,
          complexity: params.complexity,
          limit: params.limit,
          offset: params.offset
        });
      case 'help': {
        const useCaseHelpContent = useCaseHelp();
        trackAndReturnHelp('use_case', 'help', JSON.stringify(useCaseHelpContent));
        return useCaseHelpContent;
      }
      case 'example': {
        const useCaseExampleContent = useCaseExample();
        trackAndReturnHelp('use_case', 'example', JSON.stringify(useCaseExampleContent));
        return useCaseExampleContent;
      }
      default: throw new Error(`Unknown use_case action: ${action}`);
    }
  }

  /**
   * Get project root path for file-based operations
   *
   * Priority: ProjectContext.project_root_path > process.cwd()
   */
  private getProjectRoot(): string {
    const ctx = ProjectContext.getInstance();
    if (ctx.isInitialized()) {
      return ctx.getProjectMetadata().project_root_path || process.cwd();
    }
    return process.cwd();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async executeQueue(action: string, params: any): Promise<unknown> {
    const projectRoot = this.getProjectRoot();

    switch (action) {
      case 'list':
        return listQueue(projectRoot, params);
      case 'clear':
        return clearQueue(projectRoot, params);
      case 'remove':
        return removeFromQueue(projectRoot, params);
      case 'help': {
        const loader = await getHelpLoader();
        const tool = loader.getTool('queue');
        if (!tool) {
          return { error: 'Queue help not found' };
        }
        const helpContent = {
          tool: tool.name,
          description: tool.description,
          actions: tool.actions.map(a => ({
            name: a.name,
            description: a.description,
            params: a.params,
          })),
        };
        trackAndReturnHelp('queue', 'help', JSON.stringify(helpContent));
        return helpContent;
      }
      case 'example': {
        const loader = await getHelpLoader();
        const tool = loader.getTool('queue');
        if (!tool) {
          return { error: 'Queue examples not found' };
        }
        const exampleContent = {
          tool: tool.name,
          examples: tool.actions.flatMap(a =>
            a.examples.map(ex => ({
              action: a.name,
              ...ex,
            }))
          ),
        };
        trackAndReturnHelp('queue', 'example', JSON.stringify(exampleContent));
        return exampleContent;
      }
      default: throw new Error(`Unknown queue action: ${action}`);
    }
  }
}
