# sqlew

![sqlew_logo](assets/sqlew-logo.png)

[![npm version](https://img.shields.io/npm/v/sqlew.svg)](https://www.npmjs.com/package/sqlew)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

> **ADR (Architecture Decision Record) for AI Agents** – An MCP server that enables AI agents to create, query, and maintain architecture decision records in a structured SQL database

## 🚀 Quick Start

### 1. Install MCP Server

```bash
npm install -g sqlew
```

### 2. Install Plugin (Recommended)

In Claude Code, run the following commands:

```bash
claude plugin marketplace add sqlew-io/sqlew-plugin
claude plugin install sqlew
```

**That's it!** The plugin automatically sets up everything:

- ✅ MCP server config (`.mcp.json`)
- ✅ Claude Code Skills (Plan Mode guidance)
- ✅ Claude Code Hooks (automatic decision capture)

> **Note:** Plan mode enforcement is handled by the plugin's `UserPromptSubmit` hook — no manual configuration needed.

### 3. Connect to sqlew.io (For Teams) 🌐

**NEW in v5.0.0**: Connect to the cloud for team-shared decisions!

**Step 1: Get your API key** (one-time setup)

Visit [sqlew.io](https://sqlew.io) and save your API key:

```bash
# ~/.sqlew.env (shared across all projects)
SQLEW_API_KEY=your-api-key
```

**Step 2: Configure each project**

```toml
# .sqlew/config.toml (per-project)
[database]
type = "cloud"

[project]
name = "your-project-name"
```

> **Note:** Each project needs its own `.sqlew/config.toml` to specify the project name.

**Benefits:**
- 👥 **Team sharing** - All team members share the same decision database
- 🌳 **Git worktree ready** - Works seamlessly with multiple branches
- ⚡ **Zero setup** - No local database required

### Alternative: Local Database (Offline)

For offline or single-developer use, **no setup required**:

- Database (`.sqlew/sqlew.db`) is auto-created on first MCP server start
- Config file (`.sqlew/config.toml`) is auto-generated with detected project name

Just start using Claude Code - everything initializes automatically!

### 4. Just use Plan Mode!

**That's it!** Now every time you:

1. Create a plan in Claude Code
2. Get user approval (ExitPlanMode)

→ Your architectural decisions are **automatically recorded** as ADR knowledge.

No special commands needed. Just plan your work normally, and sqlew captures the decisions in the background.

### Optional: /sqlew command

For manual queries and explicit decision recording:

```bash
/sqlew                    # Show status
/sqlew search auth        # Search past decisions
/sqlew record use Redis   # Record a decision manually
```

---

## What is sqlew?

**sqlew** is a Model Context Protocol (MCP) server that brings ADR (Architecture Decision Record) capabilities to AI agents through a shared SQL-backed repository.

### The Problem: AI Agents Lack Decision Memory

Every AI session starts with zero context. Agents must re-learn architectural decisions, can reintroduce previously rejected patterns, and have no systematic way to understand WHY past choices were made.

Traditional ADR approaches use Markdown files scattered across repositories. While human-readable, this format creates challenges for AI agents:

- **No structured querying** – AI must read entire files to find relevant decisions
- **Context explosion** – Token costs grow linearly with decision history
- **No duplicate detection** – AI cannot easily identify similar or conflicting decisions
- **Poor discoverability** – Finding related decisions requires full-text search across many files

### _sqlew_ brings structured ADR to AI agents

sqlew transforms ADR from static documentation into a **queryable, AI-native decision database**:

- **Structured records** – Decisions stored as relational data with metadata, tags, and relationships
- **Efficient querying** – AI agents retrieve only relevant decisions via SQL queries
- **Smart suggestions** – Three-tier similarity system detects duplicate or related decisions
- **Constraint tracking** – Architectural rules and principles as first-class entities
- **Auto-capture** – Claude Code Hooks automatically record decisions from Plan Mode

> _This software does not send any data to external networks. We NEVER collect any data or usage statistics. Please use it with complete security._

## Why sqlew?

AI agents automatically accumulate project knowledge through Plan Mode. Decisions are stored in SQL for efficient querying.

### 🌐 Team Development Made Easy (NEW in v5.0.0)

- **Shared decision database** - All team members see the same architectural decisions
- **Multiple AI agents** - Work simultaneously without conflicts
- **No local setup** - Just add your API key and start

### 🌳 Perfect for Git Worktree Workflows

- **Automatic worktree detection** - Each worktree shares the same context
- **Config inheritance** - Main repository settings apply everywhere
- **Independent sessions** - Each worktree has its own cache

**Perfect for:**

- 🏢 Large-scale projects with many architectural decisions
- 🔧 Long-term maintenance where context must persist across sessions
- 👥 **Team environments** where multiple AI agents share knowledge
- 🌳 **Git worktree** workflows with multiple concurrent branches

**Key benefits:**

- ⚡ **60-75% token reduction** vs reading Markdown ADRs
- 🔍 **Millisecond queries** (2-50ms) even with thousands of decisions
- 🛡️ **Duplicate prevention** via similarity detection
- 📚 **Persistent memory** across all AI sessions
- 👥 **Team sync** via sqlew.io cloud backend

→ See [ADR Concepts](docs/ADR_CONCEPTS.md) for detailed architecture.

---

**Technical Features**: 7 MCP tools (3 core: decision, constraint, suggest + 4 utility: help, example, use_case, queue), three-tier similarity detection (0-100 point scoring), ACID transaction support, multi-database backend (SQLite/PostgreSQL/MySQL/Cloud), metadata-driven organization with layers and tags

## Installation

### Requirements

- Node.js 20.0.0 or higher
- npm or npx

### Recommended: Global Install

```bash
npm install -g sqlew
```

> **Why global install?** Claude Code Hooks call `sqlew` directly from shell. Global install ensures hooks work correctly without npx overhead.

Then add to `.mcp.json` in your project root:

```json
{
    "mcpServers": {
        "sqlew": {
            "command": "sqlew"
        }
    }
}
```

### Alternative: npx (Not Recommended)

**⚠️ Not recommended**: npx usage prevents Claude Code Hooks from working, disabling Plan-to-ADR automatic decision capture. Use global install instead.

**Note**: First run initializes the database. Restart Claude Code to load the MCP server.

Each project maintains its own context database in `.sqlew/sqlew.db`.

**Custom database path:** Add path as argument: `"args": ["sqlew", "/path/to/db.db"]`
**Default location:** `.sqlew/sqlew.db`

## Configuration

sqlew supports multiple database backends:

| Database                     | Use Case                 | Status       |
| ---------------------------- | ------------------------ | ------------ |
| **SQLite**                   | Personal/small projects  | ✅ Default   |
| **MySQL 8.0+ / MariaDB 10+** | Production, team sharing | ✅ Supported |
| **PostgreSQL 12+**           | Production, team sharing | ✅ Supported |

Configuration is managed via `.sqlew/config.toml` file and CLI arguments.

→ **[Full Configuration Guide](docs/CONFIGURATION.md)** - All options, database setup, validation rules

## Documentation

Each tool supports `action: "help"` for full documentation and `action: "example"` for comprehensive usage examples.

And `action: "use_case"` shows how to use the tool in a real-world scenario.

### On-Demand Documentation

All tools support:

- `action: "help"` - Parameter reference and descriptions
- `action: "example"` - Usage scenarios and examples
- `action: "use_case"` - Real-world usage examples

### For AI Agents

**Essential Guides:**

**Advanced Features:**

- [Hooks Guide](docs/HOOKS_GUIDE.md) - Claude Code Hooks integration
- [Cross Database](docs/CROSS_DATABASE.md) - Multi-database support

**Reference:**

- [Configuration](docs/CONFIGURATION.md) - Config file setup, all options

### Advanced Usage

- [Configuration Guide](docs/CONFIGURATION.md) - TOML config file setup
- [CLI Mode Overview](docs/cli/README.md) - Database migration, export/import commands

### Upgrade Guides

- **[Upgrade from v4 to v5](docs/MIGRATION_CLEANUP_GUIDE.md)** - Cleanup legacy files after plugin migration
- **[Migrating Local Data to SaaS](docs/MIGRATION_TO_SAAS.md)** - Export local v3.x/v4.x data to sqlew.io cloud
- [Migration from v2](docs/MIGRATION_v2.md) - Version upgrade guides

## Use Cases

### ADR-Driven Development with AI

- **Architecture Evolution** – Document major architectural decisions with full context and alternatives
- **Pattern Standardization** – Establish coding patterns as constraints, enforce via AI code generation
- **Technical Debt Tracking** – Record temporary decisions with deprecation paths and future plans
- **Onboarding Acceleration** – New AI sessions instantly understand architectural history

### Cross-Session AI Workflows

- **Multi-Session Projects** – AI maintains context across days/weeks without re-reading documentation
- **Multi-Agent Coordination** – Multiple AI agents share architectural understanding through ADR database
- **Breaking Change Management** – Document API changes, deprecations, and migration paths systematically
- **Refactoring Guidance** – AI references past decisions to maintain architectural consistency during refactors

### Real-World Examples

```bash
# Document an architectural decision with alternatives
/sqlew record we use PostgreSQL over MongoDB. MongoDB was rejected due to lack of ACID transactions for our financial data requirements.

# Search for past decisions before making new ones
/sqlew search why did we choose JWT authentication

# Create constraint to guide AI code generation
/sqlew add constraint all API endpoints must use /v2/ prefix for versioning

# Plan implementation of a decision
/sqlew plan implementing the PostgreSQL connection pool with pgBouncer
```

## Performance

- **Query speed**: 2-50ms
- **Concurrent agents**: 5+ simultaneous
- **Storage efficiency**: ~140 bytes per decision
- **Token savings**: 60-75% in typical projects

## Support

Support development via [GitHub Sponsors](https://github.com/sponsors/sqlew-io) - One-time or monthly options available.

## Version

Current version: **5.0.6**
See [CHANGELOG.md](CHANGELOG.md) for release history.

**What's New in v5.0.6:**

- 🧹 **CLAUDE.md injection removed** - Plan mode enforcement via `UserPromptSubmit` hook (no more global file pollution)
- 🔌 **Plugin-first Architecture** - Simplified setup via sqlew-plugin
- 🌐 **SaaS Backend** - Connect to [sqlew.io](https://sqlew.io) for team-shared decisions
- 🌳 **Git Worktree Support** - Seamless multi-branch development

See [docs/HOOKS_GUIDE.md](docs/HOOKS_GUIDE.md) for Claude Code Hooks details.

## License

Apache License 2.0 - Free for commercial and personal use. See [LICENSE](LICENSE) for details.

## Links

- [npm package](https://www.npmjs.com/package/sqlew)
- [GitHub repository](https://github.com/sqlew-io/sqlew)
- [Model Context Protocol](https://modelcontextprotocol.io/)

## Support & Documentation

- Issues: [GitHub Issues](https://github.com/sqlew-io/sqlew/issues)
- Docs: [docs/](docs/) directory

## Acknowledgments

Built with [Model Context Protocol SDK](https://github.com/modelcontextprotocol/sdk), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3), and TypeScript.

**Author**: sqlew-io

---

<!-- Git Hooks Integration Test: 2025-12-22 - This line tests post-merge hook triggering mark-done --auto -->
