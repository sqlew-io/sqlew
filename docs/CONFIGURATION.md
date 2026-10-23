# Configuration Guide

Complete guide to configuring sqlew via config files, CLI arguments, and environment variables.

## Configuration Priority

Settings are applied in this order (highest to lowest):

```
1. CLI Arguments        (--db-path, --project-name, etc.)
2. Environment Variables (SQLEW_API_KEY, SQLEW_PROJECT_NAME, SQLEW_DATABASE_TYPE, SQLEW_DATABASE_HOST/…, SQLEW_DATABASE_URL, SQLEW_DEBUG)
3. Config File          (.sqlew/config.toml)
4. Code Defaults        (DEFAULT_CONFIG in types.ts)
```

### Project name resolution

Logical project identity (what lands in `m_projects.name`) is resolved separately:

```
1. CLI --project-name
2. SQLEW_PROJECT_NAME          (env)
3. Git remote basename         (origin URL last segment, no .git — e.g. sqlew-io/sqlew → "sqlew")
4. config.toml [project].name
5. Directory name              (fallback; skipped for SaaS identity helpers)
```

Full `owner/repo` is **not** used today — only the repo basename from `git config --get remote.origin.url` (or the repo root directory if there is no remote). Installs that only set `[project].name` and have no env/git remote keep working via step 4.

## Config File (.sqlew/config.toml)

**Location:** `.sqlew/config.toml` (relative to project root)

**Format:** [TOML](https://toml.io/)

**Custom path:** `--config=path/to/config.toml` or `--config-path=path/to/config.toml`

**Worktree support (v4.1.0+):** Each git worktree can have its own `.sqlew/config.toml`.

**Template:** Copy from `.sqlew/config.example.toml` and customize.

---

## [project] — Project Settings

```toml
[project]
name = "my-project"              # Required. Alphanumeric, hyphens, underscores. Max 64 chars.
display_name = "My Project"      # Optional. Human-readable name (spaces allowed).
```

- `name` is auto-detected on first run (git basename when available, else directory) and written to config.toml when missing. Runtime still prefers `SQLEW_PROJECT_NAME` and git over an existing config value — see [Project name resolution](#project-name-resolution).
- Changing identity (env / CLI / config) requires MCP server restart for a running process.
- **Worktrees / alias clones:** share the same identity (same env override, same git remote basename, or the same `[project].name`). Path is not the identity.
- **Separate ADR spaces:** set `SQLEW_PROJECT_NAME` (or a different `[project].name` when git is absent). Do not rely on “different folder path” alone to split projects.

## [database] — Database Settings

### SQLite (Default)

As of v5.1.0, the default database is `~/.config/sqlew/sqlew-shared.db` (shared). To override with a project-local database:

```toml
[database]
path = ".sqlew/sqlew.db"    # Relative to project root, or absolute path
```

See [Shared Database](./SHARED_DATABASE.md) for migration guide and details.

### PostgreSQL / MySQL / MariaDB

```toml
[database]
type = "postgres"    # "postgres" | "mysql"

[database.connection]
host = "localhost"
port = 5432          # PostgreSQL: 5432, MySQL: 3306
database = "sqlew"   # Must already exist

[database.auth]
type = "direct"
user = "postgres"
password = "your-password"
```

For detailed authentication options (SSH tunnel, SSL, validation rules), see [DATABASE_AUTH.md](./DATABASE_AUTH.md).

### Cloud Backend

```toml
[database]
type = "cloud"
```

Requires `SQLEW_API_KEY` (see [Environment Variables](#environment-variables)).

Authentication, encryption, and scaling are managed by the sqlew cloud service — no local database setup needed.

## [hooks] — Hook Behavior (v5.4.0+)

```toml
[hooks]
session_context_budget = 500   # Token budget for session-start context injection (default: 500)
grok_require_patterns = true   # Grok: deny exit_plan_mode without filled 📌/🚫 (default: true)
omp_require_patterns = true    # omp: deny xd://propose without filled 📌/🚫 (default: true)
```

| Setting | Default | Description |
|---------|---------|-------------|
| `session_context_budget` | `500` | Estimated token budget for injected session context. Set to `0` to disable both injection and snapshot writes. Valid range: `0`–`10000` (integer). |
| `grok_require_patterns` | `true` | Grok Build only. When `true`, PreToolUse on `exit_plan_mode` **denies** approval if `plan.md` has no filled `### 📌 Decision:` / `### 🚫 Constraint:` blocks (template placeholders alone do not count). Set `Value`/`Rule` to `N/A` if nothing to record, or set this to `false` to disable the gate. |
| `omp_require_patterns` | `true` | oh-my-pi (omp) only. When `true`, Extension blocks write to `xd://propose` / `/xdev/propose` if the tracked plan has no filled 📌/🚫 blocks. |

**Priority:** Config loading uses first-match-wins (local `.sqlew/config.toml` > worktree parent > global `~/.config/sqlew/config.toml` > defaults). There is no deep merge — if a local config file exists, global `[hooks]` settings are not applied.

See [HOOKS_GUIDE.md](HOOKS_GUIDE.md#session-context-injection-v540) for architecture and [HARNESS_COMPATIBILITY.md](HARNESS_COMPATIBILITY.md) for per-harness support.

## [debug] — Debug Logging

```toml
[debug]
log_path = ".sqlew/debug.log"    # Optional. Enables debug logging when set.
log_level = "info"               # "error" | "warn" | "info" | "debug" (case-insensitive)
```

Priority for log path: CLI `--debug-log` > env `SQLEW_DEBUG` > config `debug.log_path`.

Log levels (from least to most verbose):
- **error** — Only errors
- **warn** — Errors and warnings
- **info** — Errors, warnings, and informational messages (default)
- **debug** — All messages including detailed debug output

---

## CLI Arguments

All arguments support both `--arg=value` and `--arg value` syntax.

| Argument | Description |
|----------|-------------|
| `--config=<path>` | Path to config.toml file |
| `--config-path=<path>` | Alias for `--config` |
| `--db-path=<path>` | SQLite database file path |
| `--project-name=<name>` | Project name (overrides auto-detection) |
| `--autodelete-ignore-weekend` | Enable weekend-aware auto-deletion |
| `--autodelete-message-hours=<N>` | Message retention hours |
| `--autodelete-file-history-days=<N>` | File history retention days |
| `--debug-log=<path>` | Debug log file path |

**Backward compatibility:** First non-flag argument is treated as `--db-path`.

```bash
# Examples
node dist/index.js --db-path=.sqlew/custom.db
node dist/index.js --project-name=my-app --debug-log=./debug.log
node dist/index.js --autodelete-ignore-weekend --autodelete-message-hours=48
```

## Environment Variables

| Variable | Description | Source |
|----------|-------------|--------|
| `SQLEW_API_KEY` | API key for cloud backend (`database.type = "cloud"`) | `~/.config/sqlew/.sqlew.env` or environment |
| `SQLEW_PROJECT_NAME` | Project name (same as `[project].name` / `--project-name`); wins over git and `.sqlew/config.toml` | Environment only |
| `SQLEW_DATABASE_TYPE` | Database backend: `cloud` \| `postgres` \| `mysql` \| `sqlite`. Alone it only sets `type` (does not wipe file `connection`/`auth`). With discrete host fields or a URL, selects the remote backend | Environment only |
| `SQLEW_DATABASE_HOST` | Postgres/MySQL host (hostname or IP). Prefer this over stuffing a host into `SQLEW_DATABASE_URL` | Environment only |
| `SQLEW_DATABASE_PORT` | Port (default 5432 postgres / 3306 mysql) | Environment only |
| `SQLEW_DATABASE_NAME` | Database name | Environment only |
| `SQLEW_DATABASE_USER` | Database user | Environment only |
| `SQLEW_DATABASE_PASSWORD` | Database password | Environment only |
| `SQLEW_DATABASE_SSL` | Enable SSL (`true` / `1` / `require`). Neon: set `true` | Environment only |
| `SQLEW_DATABASE_SSL_REJECT_UNAUTHORIZED` | When SSL is on: `false` ≈ `sslmode=require` (Neon default here); `true` verifies CA | Environment only |
| `SQLEW_DATABASE_URL` | Full postgres/mysql connection URL (alternative to discrete fields). SSL query params honored. Wins over discrete vars and local config.toml | Environment only |
| `DATABASE_URL` | Alias used when `SQLEW_DATABASE_URL` is unset (common in Neon / Prisma templates) | Environment only |
| `SQLEW_DEBUG` | Debug log file path (overrides `debug.log_path` in config) | Environment only |
| `SQLEW_PROJECT_ROOT` | Explicit project root for desktop / multi-project MCP launches | Environment only |

**Connection from env (first match):** (1) `SQLEW_DATABASE_URL` / `DATABASE_URL` → (2) discrete `SQLEW_DATABASE_HOST` + type/name/user/… → (3) `SQLEW_DATABASE_TYPE` alone → (4) config file.

### Cursor Cloud Agents

Cloud agent VMs are ephemeral: a VM-local SQLite file (including auto-written `.sqlew/config.toml` under a shared cwd like `/workspace`) does **not** persist across agents. Prefer **sqlew SaaS** or an **external managed database** (Neon Postgres, hosted MySQL, etc.) wired through Cursor repository Secrets → MCP `env`.

**Install on Cloud:** use the PostgreSQL-only package (smaller; no native SQLite addon):

```bash
npx @sqlew/pg
```

Local desktops should keep the full install: `npm i -g sqlew` (or `@sqlew/full`). See [SCOPED_PACKAGES.md](./SCOPED_PACKAGES.md).

**Per-repo Cloud MCP:** this repository ships [`.cursor/mcp.json`](../.cursor/mcp.json) so Cursor Cloud Agents launch `npx -y @sqlew/pg` without a global MCP entry. Put the **DB URL** (or discrete `SQLEW_DATABASE_*`) in Environment / repository Secrets — do not hardcode them in the MCP file.

**Project name on Cloud:** `SQLEW_PROJECT_NAME` is **optional**. When unset, sqlew uses the **git remote basename** automatically (e.g. clone of `sqlew-io/sqlew` → `sqlew`). Set the env override when several repos share one database and must not collide on the same basename. See [Project name resolution](#project-name-resolution).

**Plugin required for plan-less auto ADR:** MCP alone (`npx @sqlew/pg` / `.cursor/mcp.json`) is **not** enough for automatic hooks. Install [sqlew-plugin](https://github.com/sqlew-io/sqlew-plugin) so Cursor loads `.cursor/hooks.json` (Post research inject, Write enqueue, Stop flush). Marketplace / install docs: [HOOKS_GUIDE.md](./HOOKS_GUIDE.md) and the [sqlew-plugin README](https://github.com/sqlew-io/sqlew-plugin).

#### Option A — sqlew SaaS

```json
{
  "env": {
    "SQLEW_API_KEY": "sk-your-api-key",
    "SQLEW_DATABASE_TYPE": "cloud"
  }
}
```

Optional: `"SQLEW_PROJECT_NAME": "shared-slug"` when multiple repos share this SaaS project.

#### Option B — Neon Postgres via discrete Secrets (recommended for Cursor UI)

Cursor Secrets are easier as separate keys than one long URL. Put the host in `SQLEW_DATABASE_HOST` (not in `SQLEW_DATABASE_URL`).

```json
{
  "env": {
    "SQLEW_DATABASE_TYPE": "postgres",
    "SQLEW_DATABASE_HOST": "ep-xxxx.region.aws.neon.tech",
    "SQLEW_DATABASE_PORT": "5432",
    "SQLEW_DATABASE_NAME": "neondb",
    "SQLEW_DATABASE_USER": "neondb_owner",
    "SQLEW_DATABASE_PASSWORD": "your-password",
    "SQLEW_DATABASE_SSL": "true"
  }
}
```

`SQLEW_DATABASE_SSL=true` enables TLS with `rejectUnauthorized=false` by default (same idea as Neon `sslmode=require`). Set `SQLEW_DATABASE_SSL_REJECT_UNAUTHORIZED=true` if you need full CA verification.

#### Option C — Full connection URL

If you already have a connection string (Neon console / Prisma template), you can still pass it as one secret:

```json
{
  "env": {
    "SQLEW_DATABASE_URL": "postgresql://USER:PASSWORD@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require"
  }
}
```

`DATABASE_URL` alone also works; `SQLEW_DATABASE_URL` wins when both are set. A URL wins over discrete host fields if both styles are present.

`SQLEW_PROJECT_NAME` (when set), `SQLEW_DATABASE_TYPE`, URL, and discrete DB vars are applied after config files are loaded. When `SQLEW_PROJECT_NAME` is set, sqlew does not auto-write `[project].name` into config on first run.

sqlew talks to the SQL server directly (Knex); it does not use Prisma Client. A Prisma- or Cursor-provisioned Postgres URL (or the same values as discrete Secrets) is fine.

### SQLEW_API_KEY

Used when `database.type = "cloud"`. Loaded in this priority:

1. Environment variable `SQLEW_API_KEY`
2. `~/.config/sqlew/.sqlew.env` file (key=value format)

```bash
# ~/.config/sqlew/.sqlew.env
SQLEW_API_KEY=sk-your-api-key-here
```

On Unix systems, ensure `~/.config/sqlew/.sqlew.env` has `600` permissions:

```bash
chmod 600 ~/.config/sqlew/.sqlew.env
```

---

## Related Documentation

- [Shared Database](./SHARED_DATABASE.md) — Global shared database, migration guide, per-project override
- [Database Authentication](./DATABASE_AUTH.md) — Detailed auth config (SSH tunnel, validation rules, security)
- [Architecture](./ARCHITECTURE.md) — System design overview
