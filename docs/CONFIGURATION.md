# Configuration Guide

Complete guide to configuring sqlew via config files, CLI arguments, and environment variables.

## Configuration Priority

Settings are applied in this order (highest to lowest):

```
1. CLI Arguments        (--db-path, --project-name, etc.)
2. Environment Variables (SQLEW_API_KEY, SQLEW_DEBUG)
3. Config File          (.sqlew/config.toml)
4. Code Defaults        (DEFAULT_CONFIG in types.ts)
```

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

- `name` is auto-detected on first run and written to config.toml. Once set, it becomes the permanent project identifier.
- Changing `name` requires MCP server restart.

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
| `SQLEW_API_KEY` | API key for cloud backend (`database.type = "cloud"`) | `~/.sqlew.env` or environment |
| `SQLEW_DEBUG` | Debug log file path (overrides `debug.log_path` in config) | Environment only |

### SQLEW_API_KEY

Used when `database.type = "cloud"`. Loaded in this priority:

1. Environment variable `SQLEW_API_KEY`
2. `~/.sqlew.env` file (key=value format)

```bash
# ~/.sqlew.env
SQLEW_API_KEY=sk-your-api-key-here
```

On Unix systems, ensure `~/.sqlew.env` has `600` permissions:

```bash
chmod 600 ~/.sqlew.env
```

---

## Related Documentation

- [Shared Database](./SHARED_DATABASE.md) — Global shared database, migration guide, per-project override
- [Database Authentication](./DATABASE_AUTH.md) — Detailed auth config (SSH tunnel, validation rules, security)
- [Architecture](./ARCHITECTURE.md) — System design overview
