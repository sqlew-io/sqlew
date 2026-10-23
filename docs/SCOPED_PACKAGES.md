# Scoped npm packages

Issue: [#129](https://github.com/sqlew-io/sqlew/issues/129)

## Package matrix

| Package | Drivers | Typical use |
|---------|---------|-------------|
| **`sqlew`** | SQLite + PostgreSQL + MySQL | **Default local / full install** (`npm i -g sqlew`) — unchanged |
| **`@sqlew/full`** | Same as `sqlew` | Thin alias (`depends on sqlew`) for the `@sqlew` org |
| **`@sqlew/pg`** | `pg` only | **Cursor Cloud / ephemeral VMs** + Neon / Prisma Postgres |
| **`@sqlew/mysql`** | `mysql2` only | MySQL/MariaDB-only hosts |
| **`@sqlew/sqlite`** | `better-sqlite3` only | SQLite-only thin install |

There is **no** public `@sqlew/core` (driverless) package.

Semver for every package matches the root `sqlew` version.

## Layout

- Source of truth: repo root (`src/`, root `package.json` = `sqlew`).
- Driver packages live under `packages/{pg,mysql,sqlite}` and receive a copy of the built runtime via `npm run sync:scoped` (also `prepack` on each driver package).
- `@sqlew/full` only re-exports / bins into `sqlew`.

## Publish (maintainers)

Publishing is done from **GitHub Actions**, not from a Cursor agent or an interactive laptop by default.

### Required secret

Add a repository secret named **`NPM_TOKEN`**:

1. Create an npm [granular access token](https://docs.npmjs.com/about-access-tokens) (or classic automation token) with permission to publish `sqlew` and `@sqlew/*`.
2. GitHub → **Settings → Secrets and variables → Actions → New repository secret**
3. Name: `NPM_TOKEN` (exact). Value: the token from npm (never commit it).

Without `NPM_TOKEN`, real publishes fail fast. `workflow_dispatch` dry-runs do not need the secret.

### Cut a release (preferred)

1. Bump root `package.json` version; run `npm run sync:scoped` so scoped `package.json` versions match (or let CI rebuild + sync).
2. Merge to `main`.
3. Create a GitHub Release whose tag is `vX.Y.Z` (same as `package.json`, with a leading `v`). Example: version `5.3.9` → tag `v5.3.9`.
4. Publishing the release runs [`.github/workflows/publish-npm.yml`](../.github/workflows/publish-npm.yml), which publishes in order:
   - `sqlew` (root)
   - `@sqlew/full`
   - `@sqlew/pg`, `@sqlew/mysql`, `@sqlew/sqlite`  
   All with `npm publish --access public` at the same version.

### Manual / dry-run via Actions UI

**Actions → Publish npm packages → Run workflow**:

| Input | Purpose |
|-------|---------|
| `confirm_version` | Must equal root `package.json` version (e.g. `5.3.8`) |
| `dry_run` | Default `true` — runs `npm publish --access public --dry-run` only |

Set `dry_run` to `false` only when intentionally publishing (and `NPM_TOKEN` is configured).

### Local fallback (emergency)

Do **not** use this from CI agents. If Actions is unavailable:

```bash
npm run rebuild
npm run sync:scoped

npm publish --access public

(cd packages/full && npm publish --access public)
(cd packages/pg && npm publish --access public)      # prepack re-syncs dist
(cd packages/mysql && npm publish --access public)
(cd packages/sqlite && npm publish --access public)
```

`publishConfig.access` is `public` on all `@sqlew/*` packages.

## Cloud recipe

```bash
npx @sqlew/pg
```

Set `SQLEW_DATABASE_URL` or `DATABASE_URL`, plus `SQLEW_PROJECT_NAME`. See [CONFIGURATION.md — Cursor Cloud Agents](./CONFIGURATION.md#cursor-cloud-agents).
