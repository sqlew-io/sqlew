# CLI Usage Guide

> Command-line tools for database backup, export/import, and cross-database migration

## Overview

sqlew provides CLI commands for database operations that complement the main MCP server. The primary use of sqlew is as an **MCP server** (integrated via `.mcp.json`), but these CLI commands handle:

- **Data Export/Import** — JSON-based project data migration (cross-database supported)
- **SQL Dump** — Full database backup with schema (same-database-type only)

## Commands

| Command | Purpose | Cross-DB |
|---------|---------|----------|
| `db:export` | JSON export (recommended for migration) | ✅ |
| `db:import` | JSON import (recommended for migration) | ✅ |
| `db:dump` | SQL dump (backup/restore) | ❌ Same-DB only |

### Running CLI Commands

```bash
# Direct use (global install or npx)
sqlew db:export backup.json
sqlew db:import backup.json
sqlew db:dump sqlite backup.sql

# Via npm scripts (within mcp-sqlew project)
npm run db:export -- backup.json
npm run db:import -- backup.json
npm run db:dump -- sqlite backup.sql
```

**Note**: The first argument determines the mode — `db:export`, `db:import`, `db:dump` enter CLI mode; no argument starts the MCP server.

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

**⚠️ Important**: Import uses `skip-if-exists=true` by default — it skips if the project name already exists. This is **NOT a backup/restore solution**. Use `db:dump` for backup/restore.

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

## SQL Dump (`db:dump`) — Same-Database Only

> **v4.0.2+**: `db:dump` supports **same-database-type backup/restore only**. For cross-database migration, use JSON export/import above.

### Syntax

```bash
sqlew db:dump <format> [output-file] [key=value ...]
```

### Options

| Parameter | Description | Default |
|-----------|-------------|---------|
| `<format>` | Target SQL format: sqlite, mysql, postgresql | **Required** |
| `[output-file]` | Output file path | stdout |
| `from=<source>` | Source database type | sqlite |
| `tables=<list>` | Comma-separated table names | All tables |
| `chunk-size=<n>` | Rows per INSERT statement | 100 |
| `on-conflict=<mode>` | error, ignore, replace | error |
| `exclude-schema=true` | Data-only dump (no CREATE TABLE) | false |
| `db-path=<path>` | SQLite database path | .sqlew/sqlew.db |

### Supported Operations

| Source | Target | Supported |
|--------|--------|-----------|
| SQLite | SQLite | ✅ |
| MySQL | MySQL | ✅ |
| PostgreSQL | PostgreSQL | ✅ |
| Cross-database | Any | ❌ Use JSON |

### Examples

```bash
# SQLite backup
sqlew db:dump sqlite backup.sql

# MySQL backup
sqlew db:dump mysql backup.sql from=mysql

# PostgreSQL backup
sqlew db:dump postgresql backup.sql from=postgresql

# Selective table export
sqlew db:dump sqlite partial.sql tables=m_projects,t_decisions

# Ignore duplicates on import
sqlew db:dump sqlite dump.sql on-conflict=ignore
```

### Importing SQL Dumps

```bash
# SQLite
sqlite3 your-database.db < dump-sqlite.sql

# MySQL
mysql -e "CREATE DATABASE mydb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql mydb < dump-mysql.sql

# PostgreSQL
createdb mydb
psql -d mydb -f dump-pg.sql
```

### Conflict Resolution

| Mode | Behavior |
|------|----------|
| `error` (default) | Fails on duplicate keys |
| `ignore` | Skips duplicate rows |
| `replace` | Updates existing rows with new values |

---

## Comparison: JSON vs SQL Dump

| Feature | db:export (JSON) | db:dump (SQL) |
|---------|-----------------|---------------|
| Format | JSON data only | SQL DDL + data |
| Schema | Not included | Full schema |
| Cross-DB | ✅ Yes | ❌ Same-DB only |
| Use Case | Migration, sharing | Backup/restore |
| Size | Smaller (~40% reduction) | Larger |
| Conflict Handling | Smart deduplication | Overwrite or fail |
| Restore | Skips if exists | Full restore |

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
# SQL dump (same-DB restore)
sqlew db:dump sqlite backup-$(date +%Y%m%d).sql

# Or simple file copy (SQLite only)
cp .sqlew/sqlew.db .sqlew/backup-$(date +%Y%m%d).db
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
