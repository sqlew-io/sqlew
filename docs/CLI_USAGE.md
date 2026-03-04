# CLI Usage Guide

> Command-line tools for database backup, export/import, and cross-database migration

## Overview

sqlew provides CLI commands for database operations that complement the main MCP server. The primary use of sqlew is as an **MCP server** (integrated via `.mcp.json`), but these CLI commands handle:

- **Data Export/Import** — JSON-based project data migration (cross-database supported)

## Commands

| Command | Purpose | Cross-DB |
|---------|---------|----------|
| `db:export` | JSON export (recommended for migration) | ✅ |
| `db:import` | JSON import (recommended for migration) | ✅ |

### Running CLI Commands

```bash
# Direct use (global install or npx)
sqlew db:export backup.json
sqlew db:import backup.json
```

**Note**: The first argument determines the mode — `db:export`, `db:import` enter CLI mode; no argument starts the MCP server.

---

## JSON Export (`db:export`)

### Syntax

```bash
sqlew db:export [output-file] [key=value ...]
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `project=<name>` | Export specific project by name | All projects |
| `db-path=<path>` | Database file path | `.sqlew/sqlew.db` |
| `config=<path>` | Config file path | Auto-detect |

### What Gets Exported

- **Master Tables** (filtered to used entries): m_context_keys, m_tags, m_scopes, m_layers, m_projects
- **Transaction Tables** (all data for selected project): t_decisions, t_decision_context, t_constraints
- **Junction Tables** (relationships): t_decision_tags, t_decision_scopes, t_constraint_tags

### Examples

```bash
# Export all projects
sqlew db:export backup.json

# Export specific project
sqlew db:export backup.json project=my-project

# Export to stdout
sqlew db:export project=my-project
```

---

## JSON Import (`db:import`)

### Syntax

```bash
sqlew db:import <source-file> [key=value ...]
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `<source-file>` | JSON export file path | **Required** |
| `project-name=<name>` | Target project name | Use name from JSON |
| `skip-if-exists=true` | Skip import if project exists | `true` |
| `dry-run=true` | Validate only, don't import | `false` |
| `db-path=<path>` | Database file path | `.sqlew/sqlew.db` |
| `config=<path>` | Config file path | Auto-detect |

### Import Process

1. **Validation** — Checks JSON format, required fields, data types
2. **Conflict Detection** — Checks if project name already exists
3. **ID Remapping** — Creates new IDs for all imported data
4. **Master Table Merge** — Reuses existing tags/scopes by name
5. **Transaction Import** — Imports with fresh IDs and translated foreign keys
6. **Junction Table Import** — Restores all relationships

### Smart Features

- **ID Remapping**: All imported data gets fresh auto-incremented IDs with automatic foreign key updates
- **Master Table Deduplication**: Tags, scopes reused if they already exist (by name)
- **Transaction Safety**: All-or-nothing semantics (full rollback on any error)

### Examples

```bash
# Import from JSON
sqlew db:import backup.json

# Import with custom project name
sqlew db:import backup.json project-name=new-name

# Dry-run validation (no actual import)
sqlew db:import backup.json dry-run=true
```

**⚠️ Important**: Import uses `skip-if-exists=true` by default — it skips if the project name already exists. For full backup/restore, use a file copy of the SQLite database.

---

## Cross-Database Migration

> **v4.0.2+**: JSON export/import is the **ONLY** supported method for cross-database migrations.

### Pre-Migration Checklist

- [ ] Backup your current database
- [ ] Target database is created and accessible
- [ ] Database credentials are available
- [ ] Required privileges: SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES

### SQLite → MySQL

**Step 1: Export from SQLite**

```bash
sqlew db:export migration-backup.json
```

**Step 2: Prepare MySQL**

```sql
CREATE DATABASE sqlew_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'sqlew_user'@'localhost' IDENTIFIED BY 'your-secure-password';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES
  ON sqlew_db.* TO 'sqlew_user'@'localhost';
FLUSH PRIVILEGES;
```

**Step 3: Configure `.sqlew/config.toml`**

```toml
[database]
type = "mysql"

[database.connection]
host = "localhost"
port = 3306
database = "sqlew_db"

[database.auth]
type = "direct"
user = "sqlew_user"
password = "your-secure-password"

[project]
name = "your-project-name"
```

**Step 4: Import**

```bash
sqlew db:import migration-backup.json
```

### SQLite → PostgreSQL

**Step 1: Export from SQLite**

```bash
sqlew db:export migration-backup.json
```

**Step 2: Prepare PostgreSQL**

```sql
CREATE DATABASE sqlew_db WITH ENCODING 'UTF8';
CREATE USER sqlew_user WITH PASSWORD 'your-secure-password';
GRANT ALL PRIVILEGES ON DATABASE sqlew_db TO sqlew_user;
\c sqlew_db
GRANT ALL ON SCHEMA public TO sqlew_user;
```

**Step 3: Configure `.sqlew/config.toml`**

```toml
[database]
type = "postgres"

[database.connection]
host = "localhost"
port = 5432
database = "sqlew_db"

[database.auth]
type = "direct"
user = "sqlew_user"
password = "your-secure-password"

[project]
name = "your-project-name"
```

**Step 4: Import**

```bash
sqlew db:import migration-backup.json
```

### MySQL → PostgreSQL

**Step 1: Export from MySQL**

Configure `.sqlew/config.toml` for MySQL, then:

```bash
sqlew db:export migration-backup.json
```

**Step 2: Prepare PostgreSQL**

```sql
CREATE DATABASE sqlew_db WITH ENCODING 'UTF8';
CREATE USER sqlew_user WITH PASSWORD 'postgres-password';
GRANT ALL PRIVILEGES ON DATABASE sqlew_db TO sqlew_user;
\c sqlew_db
GRANT ALL ON SCHEMA public TO sqlew_user;
```

**Step 3: Update `.sqlew/config.toml` for PostgreSQL**

```toml
[database]
type = "postgres"

[database.connection]
host = "localhost"
port = 5432
database = "sqlew_db"

[database.auth]
type = "direct"
user = "sqlew_user"
password = "postgres-password"

[project]
name = "your-project-name"
```

**Step 4: Import**

```bash
sqlew db:import migration-backup.json
```

### Post-Migration Verification

```bash
# Test MCP server connection
sqlew --config-path=.sqlew/config.toml

# Or use MCP Inspector
npx @modelcontextprotocol/inspector sqlew
```

Update `.mcp.json` to use the new database:

```json
{
    "mcpServers": {
        "sqlew": {
            "command": "npx",
            "args": ["sqlew", "--config-path", "/path/to/.sqlew/config.toml"]
        }
    }
}
```

---

## Use Cases

### Project Sharing

```bash
# Developer A: Export
sqlew db:export feature-x.json project=feature-x

# Developer B: Import
sqlew db:import feature-x.json
```

### Multi-Project Consolidation

```bash
# Export from each project
sqlew db:export /tmp/a.json project=project-a
sqlew db:export /tmp/b.json project=project-b

# Import all to shared database
sqlew db:import /tmp/a.json
sqlew db:import /tmp/b.json
```

### Full Database Backup

```bash
# Simple file copy (SQLite)
cp .sqlew/sqlew.db .sqlew/backup-$(date +%Y%m%d).db

# Or JSON export (cross-database compatible)
sqlew db:export backup-$(date +%Y%m%d).json
```

---

## Troubleshooting

### Connection Refused

```
Error: connect ECONNREFUSED 127.0.0.1:3306
```

Ensure the database server is running and accepting connections on the specified port.

### Authentication Failed

```
Error: Access denied for user 'sqlew_user'@'localhost'
```

Verify username and password in config.toml. Check that the user has proper privileges.

### Database Does Not Exist

```
Error: Unknown database 'sqlew_db'
```

Create the database first (see migration steps above).

### Permission Denied (PostgreSQL)

```
Error: permission denied for schema public
```

Grant schema privileges: `GRANT ALL ON SCHEMA public TO sqlew_user;`

### Import Skipped (Project Exists)

```
Project "my-project" already exists in target database
```

Use `project-name=<new-name>` to specify a different name, or remove the existing project from the target database.

### Dry-Run Validation

Always test imports with dry-run first:

```bash
sqlew db:import data.json dry-run=true
```

Validates JSON format, project name conflicts, foreign key references, and data type correctness.
