/**
 * Add reason column to t_constraints. Stores WHY a constraint exists so future agents do not discard rules whose rationale is invisible in the code.
 *
 * @version v4
 */

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  console.error('Adding reason column to t_constraints...');

  const hasColumn = await knex.schema.hasColumn('t_constraints', 'reason');
  if (!hasColumn) {
    await knex.schema.alterTable('t_constraints', (table) => {
      table.text('reason').nullable();
    });
    console.error('  ✓ reason column added to t_constraints');
  } else {
    console.error('✓ Column t_constraints.reason already exists, skipping');
  }

  console.error('✅ Migration completed');
}

export async function down(knex: Knex): Promise<void> {
  console.error('Removing reason column from t_constraints...');

  const hasColumn = await knex.schema.hasColumn('t_constraints', 'reason');
  if (hasColumn) {
    await knex.schema.alterTable('t_constraints', (table) => {
      table.dropColumn('reason');
    });
    console.error('  ✓ reason column removed from t_constraints');
  }

  console.error('✅ Rollback completed');
}