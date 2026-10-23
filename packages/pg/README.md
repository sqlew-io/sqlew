# @sqlew/pg

PostgreSQL-only build of [sqlew](https://www.npmjs.com/package/sqlew) — same MCP/CLI runtime, **without** `better-sqlite3` or `mysql2`.

**Cursor Cloud / ephemeral VMs:** prefer this package with a remote Postgres (`SQLEW_DATABASE_URL` / `DATABASE_URL`, Neon, Prisma, etc.).

```bash
npx @sqlew/pg
# or
npm install -g @sqlew/pg
```

Full local install (all drivers) stays:

```bash
npm install -g sqlew
# same capability under the scoped name:
npm install -g @sqlew/full
```

See the [main README](https://github.com/sqlew-io/sqlew#readme) and [CONFIGURATION.md](https://github.com/sqlew-io/sqlew/blob/main/docs/CONFIGURATION.md#cursor-cloud-agents).

Publish with `npm publish --access public` from this directory after `npm run build && npm run sync:scoped` at the repo root. Semver matches root `sqlew`.
