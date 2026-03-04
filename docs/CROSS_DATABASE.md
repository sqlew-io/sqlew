# Cross-Database Compatibility

sqlew supports multiple database backends with unified query behavior.

## Supported Databases

| Database | Version | Status |
|----------|---------|--------|
| SQLite | 3.x | Primary (default) |
| MySQL | 8.0+ | Supported |
| MariaDB | 10.5+ | Supported |
| PostgreSQL | 12+ | Supported |

## Configuration

### SQLite (Default)

```toml
[database]
type = "sqlite"
path = ".sqlew/sqlew.db"
```

### MySQL / MariaDB

```toml
[database]
type = "mysql"  # or "mariadb"

[database.connection]
host = "localhost"
port = 3306
database = "sqlew"

[database.auth]
type = "direct"
user = "sqlew_user"
password = "your_password"
```

### PostgreSQL

```toml
[database]
type = "postgres"

[database.connection]
host = "localhost"
port = 5432
database = "sqlew"

[database.auth]
type = "direct"
user = "sqlew_user"
password = "your_password"
```

## Data Migration

See [CLI Usage Guide](CLI_USAGE.md#cross-database-migration) for export/import commands and step-by-step migration procedures.

## Version History

- **v4.1.0**: PostgreSQL compatibility fixes (string_agg, GROUP BY)
- **v4.0.2**: JSON-only cross-database migration
- **v3.7.0**: Multi-database adapter architecture
