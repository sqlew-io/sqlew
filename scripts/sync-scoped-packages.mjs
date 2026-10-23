#!/usr/bin/env node
/**
 * Copy built runtime assets into driver-scoped packages under packages/*.
 *
 * Usage:
 *   node scripts/sync-scoped-packages.mjs           # all driver packages + full
 *   node scripts/sync-scoped-packages.mjs pg        # one package
 *
 * Aligns package.json version with the root `sqlew` package.
 * Does not npm-publish.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DRIVER_PACKAGES = ['pg', 'mysql', 'sqlite'];

const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = rootPkg.version;

const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const targets = requested.length > 0 ? requested : [...DRIVER_PACKAGES, 'full'];

function shouldCopyDistFile(distSrc, src) {
  if (src === distSrc) return true;
  const rel = relative(distSrc, src).replace(/\\/g, '/');
  if (!rel || rel === '.') return true;
  if (rel === 'tests' || rel.startsWith('tests/')) return false;
  if (rel.endsWith('.map') || rel.endsWith('.d.ts')) return false;
  return true;
}

function syncDriverPackage(name) {
  const pkgDir = join(ROOT, 'packages', name);
  if (!existsSync(pkgDir)) {
    throw new Error(`Missing package directory: ${pkgDir}`);
  }

  const distSrc = join(ROOT, 'dist');
  if (!existsSync(distSrc)) {
    throw new Error('Root dist/ missing. Run `npm run build` before syncing scoped packages.');
  }

  const distDest = join(pkgDir, 'dist');
  rmSync(distDest, { recursive: true, force: true });
  mkdirSync(distDest, { recursive: true });

  cpSync(distSrc, distDest, {
    recursive: true,
    filter: (src) => shouldCopyDistFile(distSrc, src),
  });

  rmSync(join(distDest, 'tests'), { recursive: true, force: true });

  for (const dir of ['scripts', 'assets']) {
    const from = join(ROOT, dir);
    const to = join(pkgDir, dir);
    if (!existsSync(from)) continue;
    rmSync(to, { recursive: true, force: true });
    cpSync(from, to, { recursive: true });
  }

  for (const file of ['LICENSE', 'NOTICE']) {
    const from = join(ROOT, file);
    if (existsSync(from)) {
      cpSync(from, join(pkgDir, file));
    }
  }

  writeFileSync(
    join(distDest, 'package-variant.json'),
    `${JSON.stringify({ name: `@sqlew/${name}`, variant: name, version }, null, 2)}\n`
  );

  const pkgPath = join(pkgDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.version = version;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  console.log(`✓ synced packages/${name} @ ${version}`);
}

function syncFullPackage() {
  const pkgDir = join(ROOT, 'packages', 'full');
  const pkgPath = join(pkgDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.version = version;
  if (pkg.dependencies && 'sqlew' in pkg.dependencies) {
    pkg.dependencies.sqlew = version;
  }
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`✓ aligned packages/full @ ${version} (depends on sqlew@${version})`);
}

for (const name of targets) {
  if (name === 'full') {
    syncFullPackage();
  } else if (DRIVER_PACKAGES.includes(name)) {
    syncDriverPackage(name);
  } else {
    throw new Error(
      `Unknown scoped package "${name}". Expected one of: ${[...DRIVER_PACKAGES, 'full'].join(', ')}`
    );
  }
}
