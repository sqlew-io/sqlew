// src/utils/view-queries.ts
import { Knex } from "knex";
import { UniversalKnex } from "./universal-knex.js";
import { convertStatusArray, convertPriorityArray } from "./enum-converter.js";

/**
 * View query functions - cross-database replacements for SQL views
 *
 * These provide portable query builders that work across SQLite, MySQL, and PostgreSQL
 * using the UniversalKnex wrapper for database-specific syntax.
 *
 * Replaces deprecated database views (v_tagged_decisions, v_task_board, etc.)
 * eliminated in v3.9.0 for better cross-database compatibility.
 */

/**
 * v_tagged_decisions - Decisions with metadata (tags, layers, scopes)
 */
export async function getTaggedDecisions(knex: Knex): Promise<any[]> {
  const db = new UniversalKnex(knex);

  // Database-specific CAST syntax for numeric to string conversion
  const castNumericToText = db.isPostgreSQL
    ? "CAST(dn.value AS TEXT)"
    : db.isSQLite
      ? "dn.value"
      : "CAST(dn.value AS CHAR)"; // MySQL/MariaDB

  // Use subqueries for tag/scope aggregation
  // Note: Agent tracking removed in v4.0 - decided_by field removed
  const result = await knex("t_decisions as d")
    .join("m_context_keys as k", "d.key_id", "k.id")
    .leftJoin("m_layers as l", "d.layer_id", "l.id")
    .leftJoin("t_decisions_numeric as dn", function () {
      this.on("dn.key_id", "=", "d.key_id").andOn(
        "dn.project_id",
        "=",
        "d.project_id",
      );
    })
    .select([
      "k.key_name as key",
      // Prefer numeric value over empty string
      knex.raw(`COALESCE(NULLIF(d.value, ''), ${castNumericToText}) as value`),
      "d.version",
      "d.status",
      "l.name as layer",
      "d.project_id",
      knex.raw(`${db.dateFunction("d.ts")} as updated`),
      // Tags subquery
      knex.raw(`(
        SELECT ${db.stringAgg("t2.name", ",")}
        FROM t_decision_tags dt2
        JOIN m_tags t2 ON dt2.tag_id = t2.id
        WHERE dt2.decision_key_id = d.key_id
      ) as tags`),
      // Scopes subquery
      knex.raw(`(
        SELECT ${db.stringAgg("s2.name", ",")}
        FROM t_decision_scopes ds2
        JOIN m_scopes s2 ON ds2.scope_id = s2.id
        WHERE ds2.decision_key_id = d.key_id
      ) as scopes`),
    ]);

  return convertStatusArray(result);
}

/**
 * v_active_context - Recently active decisions (last hour)
 */
export async function getActiveContext(knex: Knex): Promise<any[]> {
  const db = new UniversalKnex(knex);
  const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;

  // Note: Agent tracking removed in v4.0 - decided_by field removed
  return knex("t_decisions as d")
    .join("m_context_keys as k", "d.key_id", "k.id")
    .leftJoin("m_layers as l", "d.layer_id", "l.id")
    .where("d.ts", ">=", oneHourAgo)
    .andWhere("d.status", 1) // active only
    .select([
      "k.key_name as key",
      "d.value",
      "d.version",
      "l.name as layer",
      knex.raw(`${db.dateFunction("d.ts")} as updated`),
    ])
    .orderBy("d.ts", "desc");
}

/**
 * v_layer_summary - Aggregated stats per layer
 */
export async function getLayerSummary(knex: Knex): Promise<any[]> {
  const db = new UniversalKnex(knex);

  return knex("m_layers as l")
    .leftJoin("t_decisions as d", function () {
      this.on("l.id", "=", "d.layer_id").andOn("d.status", "=", knex.raw("1"));
    })
    .leftJoin("t_constraints as c", function () {
      this.on("l.id", "=", "c.layer_id").andOn(
        "c.active",
        "=",
        knex.raw(db.boolTrue().toString()),
      );
    })
    .select([
      "l.name as layer",
      knex.raw("COUNT(DISTINCT d.key_id) as decision_count"),
      knex.raw("COUNT(DISTINCT c.id) as constraint_count"),
    ])
    .groupBy("l.id", "l.name")
    .orderBy("l.name");
}

/**
 * v_unread_messages_by_priority - Unread messages grouped by priority
 *
 * @deprecated Messaging system removed in v3.6.5, agent tracking removed in v4.0
 * This function is kept for backward compatibility but always returns empty array
 */
export async function getUnreadMessagesByPriority(_knex: Knex): Promise<any[]> {
  // Messaging system and agent tracking removed - return empty array
  return [];
}

/**
 * v_tagged_constraints - Active constraints with tags
 */
export async function getTaggedConstraints(knex: Knex): Promise<any[]> {
  const db = new UniversalKnex(knex);

  // Note: Agent tracking removed in v4.0 - added_by field removed
  const result = await knex("t_constraints as c")
    .join("m_constraint_categories as cat", "c.category_id", "cat.id")
    .leftJoin("m_layers as l", "c.layer_id", "l.id")
    .where("c.active", db.boolTrue())
    .select([
      "c.id",
      "cat.name as category",
      "c.constraint_text",
      "c.reason",
      "c.priority",
      "l.name as layer",
      knex.raw(`${db.dateFunction("c.ts")} as added_at`),
      // Tags subquery
      knex.raw(`(
        SELECT ${db.stringAgg("t2.name", ",")}
        FROM t_constraint_tags ct2
        JOIN m_tags t2 ON ct2.tag_id = t2.id
        WHERE ct2.constraint_id = c.id
      ) as tags`),
    ])
    .orderBy("c.priority", "desc")
    .orderBy("c.ts", "desc");

  return convertPriorityArray(result);
}

