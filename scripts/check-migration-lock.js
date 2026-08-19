#!/usr/bin/env node
/**
 * Block edits to migration files that already exist on a base ref (origin/main).
 *
 * Usage:
 *   node scripts/check-migration-lock.js
 *   node scripts/check-migration-lock.js --mode staged
 *   node scripts/check-migration-lock.js --mode range --base origin/main --head HEAD
 *
 * ALLOW_MIGRATION_EDIT=1 skips the check locally. Ignored when CI is set.
 */

import { spawnSync } from 'child_process';

const PATHSPECS = [
  'src/database/migrations/**/*.ts',
  'src/database/migrations/**/*.js',
];

function parseArgs(argv) {
  const args = { mode: 'staged', base: undefined, head: 'HEAD' };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--mode') {
      args.mode = argv[++i];
    } else if (flag === '--base') {
      args.base = argv[++i];
    } else if (flag === '--head') {
      args.head = argv[++i];
    } else {
      console.error(`Unknown argument: ${flag}`);
      process.exit(2);
    }
  }
  if (args.mode !== 'staged' && args.mode !== 'range') {
    console.error(`Invalid --mode: ${args.mode} (expected staged or range)`);
    process.exit(2);
  }
  if (args.mode === 'range' && !args.base) {
    console.error('ERROR: --mode range requires --base <ref>');
    process.exit(2);
  }
  return args;
}

function isZeroSha(ref) {
  return typeof ref === 'string' && /^0+$/.test(ref);
}

function git(gitArgs) {
  return spawnSync('git', gitArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function gitOk(gitArgs) {
  return git(gitArgs).status === 0;
}

function gitOut(gitArgs) {
  const result = git(gitArgs);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(detail || `git ${gitArgs.join(' ')} failed`);
  }
  return result.stdout;
}

function refExists(ref) {
  return gitOk(['rev-parse', '--verify', ref]);
}

function listChanged(mode, base, head) {
  const gitArgs = mode === 'staged'
    ? ['diff', '--cached', '--name-only', '--', ...PATHSPECS]
    : ['diff', '--name-only', `${base}...${head}`, '--', ...PATHSPECS];
  return gitOut(gitArgs)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function existsOnBase(base, file) {
  return gitOk(['cat-file', '-e', `${base}:${file}`]);
}

function main() {
  if (process.env.ALLOW_MIGRATION_EDIT === '1' && !process.env.CI) {
    console.warn('WARNING: ALLOW_MIGRATION_EDIT=1 — skipping migration lock (local only).');
    process.exit(0);
  }

  const args = parseArgs(process.argv.slice(2));
  let base = args.base;

  if (args.mode === 'range') {
    if (isZeroSha(base)) {
      console.log('Skipping migration lock (no previous commit on this ref).');
      process.exit(0);
    }
    if (!refExists(base)) {
      console.error(`ERROR: --base ref not found: ${base}`);
      process.exit(1);
    }
  } else {
    base = base || 'origin/main';
    if (!refExists(base)) {
      console.warn(`No remote ref ${base} found. Skipping migration integrity check (local-only repository).`);
      process.exit(0);
    }
  }

  const changed = listChanged(args.mode, base, args.head);
  if (changed.length === 0) {
    process.exit(0);
  }

  const locked = changed.filter((file) => existsOnBase(base, file));
  if (locked.length === 0) {
    console.log(`New migration files detected (not yet on ${base}).`);
    process.exit(0);
  }

  console.error('CRITICAL: PUSHED migration file(s) were edited:');
  for (const file of locked) {
    console.error(`  ${file}`);
  }
  console.error(`
MIGRATION POLICY:
   - NEVER edit migration files that already exist on ${base}
   - Create a new migration instead
   - New files go under src/database/migrations/v4/

To fix this:
   1. Revert changes to the locked file(s)
   2. Create a new migration: npm run migrate:make -- <name>
   3. Implement your changes in the new file
`);
  process.exit(1);
}

main();
