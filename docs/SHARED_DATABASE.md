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

## Desktop AI Agents (Claude Desktop / Hermes Desktop)

CLI-based agents (Claude Code, Codex, Grok Build, Hermes hooks) launch the MCP server in your project's working directory or inject a workspace environment variable, so sqlew detects the correct project automatically. Desktop apps are different: they spawn the MCP server from a fixed cwd (often the user home folder), so the launch directory does not identify which project you are working on.

sqlew handles this in two ways.

### 1. Pollution guard (automatic)

If the server starts from an ambiguous directory (the user home folder or a system directory) with no explicit project signal, sqlew does **not** invent a project from the folder name or write a `config.toml` there. The session is left **unbound**. Project-scoped tools then fail-closed rather than writing decisions to the wrong place:

```json
{
  "error": "SQLEW_PROJECT_REQUIRED",
  "message": "sqlew has no bound project ... Pass _sqlew_project.root or .name on this call, or call the \"project\" tool (action: resolve) first to obtain a ref."
}
```

`help`, `example`, `use_case`, and the `project` tool stay usable so the agent can recover.

### 2. Per-call project targeting

Pass the reserved `_sqlew_project` parameter on `decision`, `constraint`, `suggest`, and `queue` calls to target a specific project for that call. It accepts a `root` (absolute repo path), a `name`, or a `ref`:

```json
{
  "action": "set",
  "key": "auth/method",
  "value": "JWT with refresh",
  "_sqlew_project": { "root": "C:/Users/me/RustroverProjects/mcp-sqlew" }
}
```

The recommended desktop flow uses the `project` tool to resolve once and reuse a stable `ref`:

```json
// 1) Resolve the project (creates it if missing when given a root)
{ "action": "resolve", "root": "C:/Users/me/RustroverProjects/mcp-sqlew" }
// -> { "project": { ..., "ref": "sqlew_proj_3" }, "usage": { "_sqlew_project": { "ref": "sqlew_proj_3" } } }

// 2) Reuse the ref on subsequent calls
{ "action": "set", "key": "...", "value": "...", "_sqlew_project": { "ref": "sqlew_proj_3" } }
```

`project` tool actions: `current` (active project or unbound status), `resolve` (resolve/register, returns a ref), `list` (all registered projects), `validate` (read-only check).

### Same project name, different directories (worktrees / alias clones)

Logical project identity is **`[project].name`**, not the filesystem path. Git worktrees, alias clones, and isolation worktrees that share the same name resolve to the **same** `project_id` and share ADRs — including when you pass `_sqlew_project.root` or call `project.resolve { root }` with a different absolute path.

| Goal | What to set |
|------|-------------|
| Share ADRs across checkouts | Same `[project].name` in each tree (or same auto-detected name from git remote / basename) |
| Keep ADR spaces separate | Different `[project].name` in each `.sqlew/config.toml` |

`project_root_path` in `m_projects` records the first-registered root and is not rewritten when another path reuses the name.

### Single-project shortcut (env var)

If a desktop server instance only ever works on one project, set `SQLEW_PROJECT_ROOT` in the MCP server's `env` block. This counts as an explicit signal, so the session binds normally and `_sqlew_project` is not needed:

```json
{
  "mcpServers": {
    "sqlew-mcp-sqlew": {
      "command": "sqlew",
      "env": { "SQLEW_PROJECT_ROOT": "C:/Users/me/RustroverProjects/mcp-sqlew" }
    }
  }
}
```

## FAQ

### Can I still use project-local databases?

Yes. Set `database.path` in your project's `.sqlew/config.toml` and the global default is bypassed entirely.

### What happens to my old `.sqlew/sqlew.db`?

It's renamed to `.sqlew/sqlew.db.migrated` after successful migration. You can safely delete it once you've confirmed the global DB has your data.

### What about MySQL/PostgreSQL users?

No change. External database connections configured in `config.toml` work exactly as before.

### Is data shared between projects?

Yes, all projects using the default global database share the same `sqlew-shared.db` file. Each project's data is scoped by `project_id`, so there's no data mixing. This is the same model used when multiple projects connect to a shared MySQL/PostgreSQL instance.

### My desktop agent writes to the wrong project (or none). What do I do?

Desktop apps launch the MCP server from a fixed cwd, so it can't detect your project. Either set `SQLEW_PROJECT_ROOT` in the server's `env` (single-project), or pass `_sqlew_project` per call / use the `project` tool to resolve a `ref` (multi-project). See [Desktop AI Agents](#desktop-ai-agents-claude-desktop--hermes-desktop) above.

### I use a worktree / second clone and expected a separate project (or shared ADRs)

Identity is the project **name**. Same name → shared ADRs across paths; different name → separate spaces. See [Same project name, different directories](#same-project-name-different-directories-worktrees--alias-clones).
