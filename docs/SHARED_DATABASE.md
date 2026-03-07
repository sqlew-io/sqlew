# Shared Database (v5.1.0+)

As of v5.1.0, sqlew uses a **global shared database** by default instead of a per-project local database. This resolves the issue where git worktrees created isolated databases that couldn't share decisions.

## Default Paths

| Purpose | Path |
|---------|------|
| Database | `~/.config/sqlew/sqlew-shared.db` |
| Config | `~/.config/sqlew/config.toml` |
| Session cache | `~/.config/sqlew/session-cache/` |

These paths are the same on all platforms (Windows, macOS, Linux).

## Automatic Migration

When the MCP server starts, it automatically migrates local databases to the global shared database under these conditions:

- **SQLite only** — MySQL/PostgreSQL/Cloud users are not affected
- **No explicit `database.path` in config** — If you set a custom path in `.sqlew/config.toml`, auto-migration is skipped
- **`.sqlew/sqlew.db` exists** — Only the standard local DB location is migrated

### What happens during auto-migration

1. If the global DB **doesn't exist yet** → the local DB is copied directly (fastest path)
2. If the global DB **already exists** → data is exported as JSON and imported (skip-if-exists per project)
3. The local DB is renamed to `.sqlew/sqlew.db.migrated` (not deleted)

### Safety net for merge path

When merging into an existing global DB (case 2), if the import is skipped due to a project name conflict, a `pre-migration-export.json` file is saved in `.sqlew/`. This file is automatically deleted on successful import. If it remains, you can manually import it later:

```bash
sqlew db:import .sqlew/pre-migration-export.json
```

## Manual Migration

If your project uses a custom database path (set via `database.path` in `.sqlew/config.toml`), auto-migration does not apply. You can manually migrate to the global shared database:

### Step 1: Export from your current database

```bash
# Export current project (auto-detected from .sqlew/config.toml [project].name)
sqlew db:export export.json

# Or export all projects from the database
sqlew db:export export.json project=all

# Or specify the database path explicitly
sqlew db:export export.json db-path=.claude/docs/sqlew.db project=all
```

### Step 2: Switch to global database

Remove or comment out the `database.path` line in `.sqlew/config.toml`:

```toml
[database]
# path = ".claude/docs/sqlew.db"    # commented out → uses global default
```

### Step 3: Import into global database

```bash
sqlew db:import export.json
```

The global database at `~/.config/sqlew/sqlew-shared.db` will be created automatically on the next MCP server startup if it doesn't exist yet.

## Per-Project Database Override

If you want to keep a project-specific database instead of using the global shared one, set `database.path` in that project's `.sqlew/config.toml`:

```toml
[database]
path = ".sqlew/sqlew.db"    # project-local database
```

### Config priority

```
1. CLI --db-path argument          (highest)
2. Project .sqlew/config.toml
3. Worktree parent config
4. Global ~/.config/sqlew/config.toml
5. Default: ~/.config/sqlew/sqlew-shared.db  (lowest)
```

Project-level config always overrides global config, so you can use the global shared database by default and opt specific projects out as needed.

## FAQ

### Can I still use project-local databases?

Yes. Set `database.path` in your project's `.sqlew/config.toml` and the global default is bypassed entirely.

### What happens to my old `.sqlew/sqlew.db`?

It's renamed to `.sqlew/sqlew.db.migrated` after successful migration. You can safely delete it once you've confirmed the global DB has your data.

### What about MySQL/PostgreSQL users?

No change. External database connections configured in `config.toml` work exactly as before.

### Is data shared between projects?

Yes, all projects using the default global database share the same `sqlew-shared.db` file. Each project's data is scoped by `project_id`, so there's no data mixing. This is the same model used when multiple projects connect to a shared MySQL/PostgreSQL instance.
