/**
 * Clear errors when a scoped install is missing the required Knex driver,
 * or when better-sqlite3's native addon failed to install/load.
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
 * True when better-sqlite3 (or another native addon) failed to load its `.node`
 * binding — typically because npm 12+ skipped `prebuild-install`, or the ABI
 * does not match the running Node.
 */
export function isNativeBindingError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as NodeJS.ErrnoException & { message?: string };
  const message = typeof err.message === 'string' ? err.message : '';
  if (!message) return false;

  return (
    /Could not locate the bindings file/i.test(message) ||
    /was compiled against a different Node\.js version/i.test(message) ||
    /NODE_MODULE_VERSION/i.test(message) ||
    /better_sqlite3\.node/i.test(message) ||
    (/ERR_DLOPEN_FAILED/i.test(String(err.code || '')) && /better.?sqlite/i.test(message))
  );
}

function sqliteNativeBindingHint(): string {
  return [
    'SQLite native addon (better-sqlite3) failed to load.',
    'npm 12+ (Node 24.19+) blocks install scripts by default, so the Windows/macOS/Linux prebuild is never downloaded.',
    'Fix (recommended): `npm install -g --allow-scripts=better-sqlite3 sqlew`',
    'Or use Node 22 LTS and reinstall, or avoid SQLite entirely with `npx -y @sqlew/pg` + SQLEW_DATABASE_URL / DATABASE_URL (Neon/Postgres).',
  ].join(' ');
}

/**
 * Rewrite missing-driver / native-binding errors into an actionable install hint.
 * Returns the original error when it is unrelated.
 */
export function enhanceDriverLoadError(error: unknown, client: KnexDriverClient): unknown {
  const isSqliteClient =
    client === 'better-sqlite3' || client === 'sqlite3' || client === 'sqlite';

  if (isSqliteClient && isNativeBindingError(error)) {
    const enhanced = new Error(sqliteNativeBindingHint());
    enhanced.cause = error;
    return enhanced;
  }

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

  // Extra nudge when the missing module is better-sqlite3 itself under npm 12+.
  if (isSqliteClient) {
    lines.push(
      'If the package is installed but the native binding is missing, re-run `npm install -g --allow-scripts=better-sqlite3 sqlew` (npm 12+ / Node 24).'
    );
  }

  const enhanced = new Error(lines.join(' '));
  enhanced.cause = error;
  return enhanced;
}

/** Run `fn`; on missing-module / native-binding errors, throw {@link enhanceDriverLoadError}. */
export function withDriverLoadError<T>(client: KnexDriverClient, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw enhanceDriverLoadError(error, client);
  }
}
