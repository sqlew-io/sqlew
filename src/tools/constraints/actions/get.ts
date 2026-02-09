/**
 * Retrieve constraints with advanced filtering
 * Uses JOIN queries instead of database views for cross-DB compatibility
 */

import { DatabaseAdapter } from '../../../adapters/index.js';
import { getAdapter } from '../../../database.js';
import { validateCategory, validatePriority } from '../../../utils/validators.js';
import { validateActionParams } from '../../../utils/parameter-validator.js';
import { parseStringArray } from '../../../utils/param-parser.js';
import { getProjectContext } from '../../../utils/project-context.js';
import connectionManager from '../../../utils/connection-manager.js';
import { UniversalKnex } from '../../../utils/universal-knex.js';
import { convertPriorityArray } from '../../../utils/enum-converter.js';
import type {
  GetConstraintsParams,
  GetConstraintsResponse,
  TaggedConstraint
} from '../types.js';

/**
 * Retrieve t_constraints with advanced filtering
 * Uses JOIN queries for cross-database compatibility (no views)
 *
 * @param params - Filter parameters
 * @param adapter - Optional database adapter (for testing)
 * @returns Array of t_constraints matching filters
 */
export async function getConstraints(
  params: GetConstraintsParams,
  adapter?: DatabaseAdapter
): Promise<GetConstraintsResponse> {
  const actualAdapter = adapter ?? getAdapter();
  const knex = actualAdapter.getKnex();

  try {
    return await connectionManager.executeWithRetry(async () => {
      // Fail-fast project_id validation (Constraint #29)
      const projectId = getProjectContext().getProjectId();

      // Validate parameters
      validateActionParams('constraint', 'get', params);

      const db = new UniversalKnex(knex);

      // Build query using JOINs (no views - cross-DB compatible)
      let query = knex('t_constraints as c')
        .join('m_constraint_categories as cat', 'c.category_id', 'cat.id')
        .leftJoin('m_layers as l', 'c.layer_id', 'l.id')
        .where('c.project_id', projectId)
        ;

      // Filter by active status (default: active only, unless include_inactive=true)
      if (!params.include_inactive) {
        query = query.where('c.active', db.boolTrue());
      }

      // Filter by category
      if (params.category) {
        validateCategory(params.category);
        query = query.where('cat.name', params.category);
      }

      // Filter by layer
      if (params.layer) {
        query = query.where('l.name', params.layer);
      }

      // Filter by priority (accepts string or number)
      if (params.priority) {
        const priorityStr = validatePriority(params.priority as string | number);
        const priorityMap: Record<string, number> = {
          low: 1, medium: 2, high: 3, critical: 4
        };
        const priorityInt = priorityMap[priorityStr];
        if (priorityInt !== undefined) {
          query = query.where('c.priority', priorityInt);
        }
      }

      // Filter by tags (OR logic - match ANY tag)
      if (params.tags && params.tags.length > 0) {
        const tags = parseStringArray(params.tags);
        query = query.whereExists(function() {
          this.select(knex.raw('1'))
            .from('t_constraint_tags as ct')
            .join('m_tags as t', 'ct.tag_id', 't.id')
            .whereRaw('ct.constraint_id = c.id')
            .whereIn('t.name', tags);
        });
      }

      // Order by priority DESC, category, ts DESC
      query = query
        .orderBy('c.priority', 'desc')
        .orderBy('cat.name', 'asc')
        .orderBy('c.ts', 'desc');

      // Add limit
      const limit = params.limit || 50;
      query = query.limit(limit);

      // Select columns with tags subquery
      const rawRows = await query.select([
        'c.id',
        'c.project_id',
        'cat.name as category',
        'l.name as layer',
        'c.constraint_text',
        'c.priority',
        knex.raw(`${db.dateFunction('c.ts')} as created_at`),
        // Tags subquery
        knex.raw(`(
          SELECT ${db.stringAgg('t2.name', ',')}
          FROM t_constraint_tags ct2
          JOIN m_tags t2 ON ct2.tag_id = t2.id
          WHERE ct2.constraint_id = c.id
        ) as tags`),
      ]);

      // Convert priority integer to string and parse tags
      const rows = convertPriorityArray(rawRows) as TaggedConstraint[];
      const constraints = rows.map(row => ({
        ...row,
        tags: row.tags ? row.tags.split(',') : null,
      })) as any[];

      return {
        constraints,
        count: constraints.length,
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get constraints: ${message}`);
  }
}
