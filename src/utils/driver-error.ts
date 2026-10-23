/**
 * Clear errors when a scoped install is missing the required Knex driver.
 */

export type KnexDriverClient = 'better-sqlite3' | 'pg' | 'mysql2' | string;

const DRIVER_HINTS: Record<string, { label: string; scoped: string; module: string }> = {
  'better-sqlite3': {
    label: 'SQLite',
    scoped: '@sqlew/sqlite',
    module: 'better-sqlite3',
  },
  pg: {
    label: 'PostgreSQL',
    scoped: '@sqlew/pg',
    module: 'pg',
  },
  postgres: {
    label: 'PostgreSQL',
    scoped: '@sqlew/pg',
    module: 'pg',
  },
  postgresql: {
    label: 'PostgreSQL',
    scoped: '@sqlew/pg',
    module: 'pg',
  },
  mysql2: {
    label: 'MySQL',
    scoped: '@sqlew/mysql',
    module: 'mysql2',
  },
  mysql: {
    label: 'MySQL',
    scoped: '@sqlew/mysql',
    module: 'mysql2',
  },
};

/** True when Node failed to resolve a dependency module. */
export function isMissingModuleError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as NodeJS.ErrnoException & { message?: string };
  if (err.code === 'MODULE_NOT_FOUND' || err.code === 'ERR_MODULE_NOT_FOUND') {
    return true;
  }
  const message = typeof err.message === 'string' ? err.message : '';
  return /Cannot find module|Cannot find package/.test(message);
}

/**
 * Rewrite missing-driver errors into an actionable install hint.
 * Returns the original error when it is unrelated.
 */
export function enhanceDriverLoadError(error: unknown, client: KnexDriverClient): unknown {
  if (!isMissingModuleError(error)) {
    return error;
  }

  const hint = DRIVER_HINTS[client];
  const moduleName = hint?.module || String(client);
  const label = hint?.label || String(client);
  const scoped = hint?.scoped;

  const lines = [
    `Database driver "${moduleName}" (${label}) is not installed in this sqlew package.`,
    scoped
      ? `Use \`npx ${scoped}\` / \`npm i -g ${scoped}\` for this dialect, or \`npm i -g sqlew\` / \`@sqlew/full\` for all RDB drivers.`
      : 'Install the matching driver package, or use `npm i -g sqlew` for the full install.',
  ];

  const enhanced = new Error(lines.join(' '));
  enhanced.cause = error;
  return enhanced;
}

/** Run `fn`; on missing-module errors, throw {@link enhanceDriverLoadError}. */
export function withDriverLoadError<T>(client: KnexDriverClient, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw enhanceDriverLoadError(error, client);
  }
}
