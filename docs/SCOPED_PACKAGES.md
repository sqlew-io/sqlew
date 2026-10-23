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

Do **not** publish from CI unless npm 2FA / tokens are configured. Manual:

```bash
npm run rebuild
npm run sync:scoped

# Full (legacy name) — from repo root
npm publish --access public

# Scoped — from each package directory
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
