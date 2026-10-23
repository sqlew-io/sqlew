# @sqlew/sqlite

SQLite-only build of [sqlew](https://www.npmjs.com/package/sqlew) — ships `better-sqlite3`, **without** `pg` or `mysql2`.

```bash
# npm 12+: allow the native addon install script
npm install -g --allow-scripts=better-sqlite3 @sqlew/sqlite
npx @sqlew/sqlite
```

For all drivers locally, keep using `npm install -g sqlew` (or `@sqlew/full`).

See the [main README](https://github.com/sqlew-io/sqlew#readme). Semver matches root `sqlew`. Publish with `--access public`.
