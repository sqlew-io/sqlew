# @sqlew/sqlite

SQLite-only build of [sqlew](https://www.npmjs.com/package/sqlew) — ships `better-sqlite3`, **without** `pg` or `mysql2`.

```bash
# npm 12+ / Node 24: allow the native addon install script (required on Windows)
npm install -g --allow-scripts=better-sqlite3 @sqlew/sqlite
npx @sqlew/sqlite
```

If MCP fails with `Could not locate the bindings file` under `node-v137-win32-x64`, re-run the install with `--allow-scripts=better-sqlite3`, or use `@sqlew/pg` + a Postgres URL instead.

For all drivers locally, keep using `npm install -g --allow-scripts=better-sqlite3 sqlew` (or `@sqlew/full`).

See the [main README](https://github.com/sqlew-io/sqlew#readme). Semver matches root `sqlew`. Publish with `--access public`.
