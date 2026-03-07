# Migrating Local Data to SaaS

This guide explains how to migrate your existing local sqlew data to [sqlew.io](https://sqlew.io) cloud backend.

## Overview

```
┌─────────────────────────────────────────────────┐
│  Migration Flow                                 │
├─────────────────────────────────────────────────┤
│                                                 │
│  [Local v3.x/v4.x DB]                          │
│       │                                         │
│       ▼ npm install -g sqlew@latest            │
│       │                                         │
│       ▼ sqlew (auto-migration to v5.0+)        │
│       │                                         │
│  [Local v5.0+ DB]                              │
│       │                                         │
│       ▼ npm run db:export -- backup.json       │
│       │                                         │
│  [JSON file]                                    │
│       │                                         │
│       ▼ Upload to sqlew.io                     │
│       │                                         │
│  [SaaS v5.0+]                                  │
│                                                 │
└─────────────────────────────────────────────────┘
```

## Step-by-Step Guide

### 1. Update to v5.0+

If you're on an older version (v3.x or v4.x), update first:

```bash
npm install -g sqlew@latest
```

### 2. Run Auto-Migration

Start the MCP server once. This automatically migrates your database schema:

```bash
sqlew
```

The migration system:
- Detects your current schema version
- Applies all necessary migrations (v3→v4→v5)
- Preserves your decisions and constraints

### 3. Export Your Data

Export your local database to JSON format:

```bash
# From your project directory
cd your-project

# Export to JSON
npx sqlew db:export backup.json
```

The exported JSON includes:
- All decisions with full metadata
- Decision history (version tracking)
- Decision context (rationale, alternatives, tradeoffs)
- Constraints with categories and priorities
- Tags and scopes

### 4. Import to SaaS

Upload your JSON file via the sqlew.io dashboard:

1. Go to [sqlew.io/dashboard/import](https://sqlew.io/dashboard/import)
2. Select your project (or create a new one)
3. Upload `backup.json`
4. Review and confirm the import

## Version Compatibility

| Source Version | Support | Notes |
|----------------|---------|-------|
| **v5.0+** | ✅ Full | Direct export/import |
| **v4.x** | ✅ Full | Auto-migrated on startup |
| **v3.7+** | ✅ Full | Auto-migrated on startup |
| **v3.0-v3.6** | ⚠️ Untested | May work, but not guaranteed |

## What Gets Migrated

### Preserved Data

| Data Type | Migrated | Notes |
|-----------|----------|-------|
| Decisions | ✅ Yes | All metadata preserved |
| Decision History | ✅ Yes | Full version tracking |
| Decision Context | ✅ Yes | Rationale, alternatives, tradeoffs |
| Constraints | ✅ Yes | Categories, priorities |
| Tags | ✅ Yes | Project-scoped |
| Scopes | ✅ Yes | Project-scoped |
| Layers | ✅ Yes | 9 predefined layers |

### Not Migrated (Removed Features)

| Data Type | Version Removed | Reason |
|-----------|-----------------|--------|
| Agent references | v4.0 | Agent system simplified |
| Tasks | v5.0 | Replaced by Claude Code TodoWrite |
| Task dependencies | v5.0 | Replaced by Claude Code TodoWrite |
| Files/File changes | v5.0 | No longer tracked |

> **Note:** These features were removed from sqlew itself. The data is not lost during migration—these systems simply no longer exist in v5.0+.

## Troubleshooting

### Migration Fails

If auto-migration fails:

1. Check your Node.js version (requires 20.0.0+)
2. Ensure `.sqlew/sqlew.db` exists and is readable
3. Check for disk space issues

### Export Fails

If export fails:

1. Verify the database was migrated successfully
2. Check write permissions for the output directory
3. Try with absolute path: `npx sqlew db:export /full/path/to/backup.json`

### Import Fails on SaaS

If SaaS import fails:

1. Verify JSON file is valid (not corrupted)
2. Check schema_version in JSON metadata is 5.0+
3. Contact support if the issue persists

## FAQ

### Can I migrate v3.0-v3.6 data?

These versions are untested. The migration may work, but we recommend:

1. Backup your database first
2. Try the migration
3. Report any issues to [GitHub Issues](https://github.com/sqlew-io/sqlew/issues)

### Will I lose any decisions?

No. All decisions and constraints are fully preserved. Only deprecated features (agents, tasks, files) are not migrated because they no longer exist in v5.0+.

### Can I migrate multiple projects?

Yes. Export each project separately:

```bash
# Export all projects
npx sqlew db:export backup-all.json project=all

# Or export specific project
npx sqlew db:export backup.json project=my-project
```

### What about constraint tags?

There's a known limitation where constraint-to-tag relationships may not be fully preserved. After import, you may need to re-tag some constraints manually.

## See Also

- [Configuration Guide](CONFIGURATION.md) - SaaS connection setup
- [CLI Reference](cli/README.md) - All export/import commands

