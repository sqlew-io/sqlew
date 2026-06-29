# sqlew

![sqlew_logo](assets/sqlew-logo.png)

[![npm version](https://img.shields.io/npm/v/sqlew.svg)](https://www.npmjs.com/package/sqlew)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

> **Design decisions, remembered by SQL** — an MCP server for AI agents

## What is sqlew?

### The Problem

Every AI coding session starts from scratch. Your agent doesn't remember that you chose PostgreSQL over MongoDB last week, or that the team agreed on a specific API versioning strategy. Without persistent memory, agents repeat mistakes, contradict earlier decisions, and waste tokens re-discovering context.

### The Solution

sqlew stores your architectural decisions in a structured SQL database. When a new session starts, the AI agent queries past decisions in milliseconds — not by reading through scattered Markdown files, but through efficient SQL lookups with metadata, tags, and similarity detection.

```
┌─────────────────────────────────────────────────────────────┐
│  Before sqlew                 │  After sqlew                │
│───────────────────────────────│─────────────────────────────│
│  Session 1: "Use PostgreSQL"  │  Session 1: "Use PostgreSQL"│
│  Session 2: "Use MongoDB?"    │    → decision recorded      │
│  Session 3: "Use PostgreSQL"  │  Session 2: query → got it  │
│  (same debate, every time)    │  Session 3: query → got it  │
│                               │    (instant recall)         │
└─────────────────────────────────────────────────────────────┘
```

sqlew is built on the [Model Context Protocol](https://modelcontextprotocol.io/) (MCP), so it works with any MCP-compatible AI coding tool.

> _This software does not send any data to external networks. We NEVER collect any data or usage statistics._

## Quick Start

### 1. Install

```bash
npm install -g sqlew
```

### 2. Setup

Choose the setup that matches your environment. Each client has its own install and uninstall steps.

#### Claude Code (Plugin)

**Install:**

```bash
claude plugin marketplace add sqlew-io/sqlew-plugin
claude plugin install sqlew
```

Configures MCP server, Skills (Plan Mode guidance), and Hooks (automatic decision capture).

**Uninstall:**

```bash
claude plugin remove sqlew
```

#### Codex CLI (Plugin)

**Install:**

```bash
codex plugin marketplace add sqlew-io/sqlew-plugin
codex plugin install sqlew --source sqlew-plugin
```

After install, open `/hooks` in Codex and trust the bundled sqlew hooks. Enable Plan Mode with `collaboration_modes = true` under `[features]` in your Codex config.

> Do not duplicate skills in `~/.codex/skills/` or add `[mcp_servers.sqlew]` to `config.toml` when using the plugin. See [Hooks Guide](docs/HOOKS_GUIDE.md).

**Uninstall:**

```bash
codex plugin remove sqlew
```

#### Grok Build (Plugin)

**Install:**

```bash
grok plugin install sqlew-io/sqlew-plugin --trust
grok plugin update
```

Configures MCP server, Skills (plan mode guidance), and Hooks (automatic decision capture on `exit_plan_mode`).

> Do not duplicate hooks in `~/.grok/hooks/` or add `[mcp_servers.sqlew]` to `~/.grok/config.toml`. See [Hooks Guide](docs/HOOKS_GUIDE.md).

**Uninstall:**

```bash
grok plugin remove sqlew
```

#### Hermes (Plugin)

Requires sqlew **>= 5.3.0**. Hermes uses a separate plugin bundle (`.hermes-plugin/`), not the Claude/Codex plugin manifest.

**Install:**

```bash
hermes plugins install sqlew-io/sqlew-plugin/.hermes-plugin
hermes plugins enable sqlew
```

Merges MCP + shell hooks into `~/.hermes/config.yaml` and copies planning skills to `~/.hermes/skills/`. See [Hermes Hooks Guide](docs/HERMES_HOOKS.md) for wire-protocol details and manual `config.yaml` setup.

**Uninstall:**

```bash
hermes plugins remove sqlew
```

If you merged hooks manually before using the plugin, also remove `mcp_servers.sqlew` and sqlew `hooks:` entries from `~/.hermes/config.yaml`. Skills under `~/.hermes/skills/sqlew-*` are not removed automatically.

#### Manual (MCP only)

Add to `.mcp.json` in your project root:

```json
{
    "mcpServers": {
        "sqlew": {
            "command": "sqlew"
        }
    }
}
```

The database (`~/.config/sqlew/sqlew-shared.db`) and config are auto-created on first run. See [Shared Database](docs/SHARED_DATABASE.md) for details.

### 3. Just use Plan Mode!

That's it. Every time you create a plan and get user approval, your architectural decisions are **automatically recorded**.

No special commands needed — just plan your work normally, and sqlew captures the decisions in the background.

## Features

- **Structured Records** — Decisions stored as relational data with metadata, tags, layers, and version history
- **Fast Queries** — 2-50ms retrieval via SQL, even with thousands of decisions
- **Duplicate Detection** — Three-tier similarity scoring (0-100) prevents redundant decisions
- **Constraint Tracking** — Architectural rules and principles as first-class entities
- **Auto-Capture** — Hooks automatically record decisions from Plan Mode (Claude Code, Codex, Grok Build, and Hermes via sqlew-plugin)
- **Multi-Database** — SQLite (default), PostgreSQL, MySQL/MariaDB, or Cloud
- **Git Worktree Ready** — Each worktree shares the same context database

## For Teams (sqlew.io)

Connect to [sqlew.io](https://sqlew.io) for team-shared decisions:

**Step 1: Get your API key**

Visit [sqlew.io](https://sqlew.io) and save your API key:

```bash
# ~/.config/sqlew/.sqlew.env (shared across all projects)
SQLEW_API_KEY=your-api-key
```

**Step 2: Configure each project**

```toml
# .sqlew/config.toml
[database]
type = "cloud"

[project]
name = "your-project-name"
```

**Benefits:**
- All team members share the same decision database
- Works seamlessly with Git worktree workflows
- No local database setup required

## Performance

| Metric | Value |
|--------|-------|
| Query speed | 2-50ms |
| Concurrent agents | 5+ simultaneous |
| Storage efficiency | ~140 bytes/decision |
| Token savings | 60-75% vs Markdown ADRs |

## Use Cases

- **Architecture Evolution** — Document major decisions with full context and alternatives considered
- **Pattern Standardization** — Establish coding patterns as constraints, enforce via AI code generation
- **Cross-Session Continuity** — AI maintains context across days/weeks without re-reading docs
- **Multi-Agent Coordination** — Multiple AI agents share architectural understanding
- **Onboarding Acceleration** — New AI sessions instantly understand project history

## Documentation

| Guide | Description |
|-------|-------------|
| [ADR Concepts](docs/ADR_CONCEPTS.md) | Architecture Decision Records explained |
| [Configuration](docs/CONFIGURATION.md) | Config file setup, database options |
| [Hooks Guide](docs/HOOKS_GUIDE.md) | Claude Code, Codex, Grok Build, and Hermes integration |
| [Hermes Hooks Guide](docs/HERMES_HOOKS.md) | Hermes-specific setup and wire-protocol notes |
| [Cross Database](docs/CROSS_DATABASE.md) | Multi-database support |
| [CLI Usage](docs/CLI_USAGE.md) | Database migration, export/import |

### Upgrade Guides

- [Migrating to SaaS](docs/MIGRATION_TO_SAAS.md) — Export local data to sqlew.io cloud


### MCP Tools

8 action-based tools: `decision`, `constraint`, `project`, `suggest`, `help`, `example`, `use_case`, `queue`

All tools support `action: "help"` for documentation. The `project` tool targets a project per call for desktop AI agents (Claude Desktop, Hermes Desktop) — see [Shared Database](docs/SHARED_DATABASE.md).

## Support

Support development via [GitHub Sponsors](https://github.com/sponsors/sqlew-io).

## Version

Current version: **5.3.0**

See [CHANGELOG.md](CHANGELOG.md) for release history.

**What's New in v5.3.0:**

- **Hermes support** — Plan-to-ADR via [sqlew-plugin](https://github.com/sqlew-io/sqlew-plugin) `.hermes-plugin` bundle (`hermes plugins install sqlew-io/sqlew-plugin/.hermes-plugin`)
- **Hook normalization** — Hermes `pre_tool_call` / `pre_llm_call` payloads mapped to canonical Claude-shaped events and tools
- **Every-turn plan guidance** — `on-prompt` injects FULL/SHORT context via Hermes `pre_llm_call` (`{"context":"..."}`)
- **`.hermes/plans/`** — Plan files written by the Hermes `plan` skill are tracked for decision extraction

## License

Apache License 2.0 — Free for commercial and personal use. See [LICENSE](LICENSE) for details.

## Links

- [npm package](https://www.npmjs.com/package/sqlew)
- [GitHub](https://github.com/sqlew-io/sqlew)
- [Issues](https://github.com/sqlew-io/sqlew/issues)
- [Model Context Protocol](https://modelcontextprotocol.io/)

---

Built with [MCP SDK](https://github.com/modelcontextprotocol/sdk), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3), and TypeScript.
