# Database Authentication Configuration

This document describes the authentication configuration for multi-database support in sqlew v4.0.0+.

## Supported Authentication

| Method | Status | Description |
|--------|--------|-------------|
| **Direct (Password)** | ✅ Supported | Standard username/password authentication |
| **SSH Tunnel** | ✅ Manual | User-managed SSH port forwarding |

## Configuration Structure

All configuration is defined in `.sqlew/config.toml`.

### SQLite (Default)

```toml
[database]
path = ".sqlew/sqlew.db"
```

### PostgreSQL

```toml
[database]
type = "postgres"

[database.connection]
host = "localhost"
port = 5432
database = "sqlew_db"

[database.auth]
type = "direct"
user = "postgres"
password = "your-password"
```

### MySQL/MariaDB

```toml
[database]
type = "mysql"

[database.connection]
host = "localhost"
port = 3306
database = "sqlew_db"

[database.auth]
type = "direct"
user = "mysql_user"
password = "your-password"
```

## Managed Database (Recommended)

For environments that require SSL/TLS encryption, IAM authentication, or managed scaling, use the sqlew cloud backend instead of configuring these locally.

The cloud backend handles authentication, encryption, and scaling — no local database administration needed.

### Setup

1. Obtain an API key from the [sqlew dashboard](https://sqlew.io)

2. Save the key to `~/.config/sqlew/.sqlew.env`:
   ```bash
   echo 'SQLEW_API_KEY=sk-your-api-key' >> ~/.config/sqlew/.sqlew.env
   chmod 600 ~/.config/sqlew/.sqlew.env   # Unix only
   ```

3. Set database type in `.sqlew/config.toml`:
   ```toml
   [database]
   type = "cloud"
   ```

See [Configuration Guide](./CONFIGURATION.md) for full environment variable details.

## SSH Tunnel (Manual Setup)

**SSH tunneling is NOT built into sqlew.** Set up tunnels manually before connecting.

```bash
# Example: Forward local port 5433 to remote database
ssh -L 5433:db.internal.example.com:5432 user@bastion.example.com
```

Then configure sqlew to connect to localhost:

```toml
[database]
type = "postgres"

[database.connection]
host = "localhost"    # Tunnel endpoint
port = 5433           # Forwarded port
database = "sqlew_db"

[database.auth]
type = "direct"
user = "postgres"
password = "db-password"
```

**Useful SSH options:**
- `-N`: Don't execute remote command (tunnel only)
- `-f`: Run in background
- `-o ServerAliveInterval=60`: Keep connection alive

## Validation Rules

### Connection
- `host`: Required for PostgreSQL/MySQL
- `port`: 1-65535
- `database`: Required for PostgreSQL/MySQL

### Authentication
- `type`: Must be `direct`
- `user`: Required
- `password`: Required

## Security Best Practices

1. **Never commit passwords** - Don't commit config.toml with passwords to git
2. **Use SSH tunnels** - For databases behind firewalls
3. **Restrict access** - Limit database user permissions

---

## Related Documentation

- [Configuration Guide](./CONFIGURATION.md)
- [Cross Database Guide](./CROSS_DATABASE.md)
