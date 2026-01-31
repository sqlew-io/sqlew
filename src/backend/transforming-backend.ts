/**
 * TransformingBackend - Decorator pattern for action transformation
 *
 * Wraps a backend (typically SaaS) and transforms specific actions
 * before delegating to the wrapped backend.
 *
 * Use Case: SaaS backend doesn't support quick_set, so we:
 * 1. Apply inference logic locally (layer/tags/scope from key)
 * 2. Transform to 'set' action
 * 3. Forward to wrapped SaaS backend
 *
 * @since v5.0.1
 */

import type { ToolBackend, HealthCheckResult, BackendType } from './types.js';
import { inferDecisionParams } from './inference.js';

/**
 * Response type for decision.set action
 */
interface SetDecisionResponse {
  success: boolean;
  key: string;
  key_id: number;
  version: string;
}

/**
 * TransformingBackend implementation
 *
 * Implements ToolBackend interface while wrapping another backend.
 * Transforms specific actions (like quick_set) before delegation.
 */
export class TransformingBackend implements ToolBackend {
  readonly backendType: BackendType;
  readonly pluginName?: string;

  constructor(private wrapped: ToolBackend) {
    this.backendType = wrapped.backendType;
    this.pluginName = wrapped.pluginName;
  }

  /**
   * Execute a tool action, transforming if necessary
   */
  async execute<T>(
    tool: string,
    action: string,
    params: Record<string, unknown>
  ): Promise<T> {
    // Transform decision.quick_set → decision.set with inference
    if (tool === 'decision' && action === 'quick_set') {
      return await this.handleQuickSet<T>(params);
    }

    // Pass through to wrapped backend for all other actions
    return this.wrapped.execute<T>(tool, action, params);
  }

  /**
   * Handle quick_set by inferring params and calling set
   */
  private async handleQuickSet<T>(params: Record<string, unknown>): Promise<T> {
    // Apply inference logic
    const { transformedParams, inferred } = inferDecisionParams(params);

    // Call wrapped backend with 'set' action
    const result = await this.wrapped.execute<SetDecisionResponse>(
      'decision',
      'set',
      transformedParams
    );

    // Return quick_set response format
    return {
      success: result.success,
      key: result.key,
      key_id: result.key_id,
      version: result.version,
      inferred,
      message: `Decision "${params.key}" set successfully with smart defaults`,
    } as unknown as T;
  }

  /**
   * Delegate health check to wrapped backend
   */
  async healthCheck(): Promise<HealthCheckResult> {
    return this.wrapped.healthCheck();
  }

  /**
   * Delegate disconnect to wrapped backend
   */
  async disconnect(): Promise<void> {
    return this.wrapped.disconnect();
  }

  /**
   * Delegate setAgentName to wrapped backend
   */
  setAgentName(name: string): void {
    if (this.wrapped.setAgentName) {
      this.wrapped.setAgentName(name);
    }
  }
}
