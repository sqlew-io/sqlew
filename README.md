# sqlew

![sqlew_logo](assets/sqlew-logo.png)

[![npm version](https://img.shields.io/npm/v/sqlew.svg)](https://www.npmjs.com/package/sqlew)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

> **Design intent on tap** — stop agents from re-auditing the whole repo every turn

## What is sqlew?

### The Problem

Strong coding agents no longer "forget" the stack between sessions the way older models did. They treat the **codebase as ground truth** — and that is good for correctness.

The new failure mode is cost and thrash:

- Specs, plans, and ADRs already say *why* a choice was made
- The agent still re-opens large swaths of source "just to be sure"
- Rejected alternatives and non-local constraints are expensive (or impossible) to re-derive from code alone
- Every turn pays the same investigation tax; multi-agent and multi-day work multiplies it

Code answers *what is implemented*. It is a poor, high-token index for *why we chose it*, *what we forbade*, and *what we already rejected*.

### The Solution

sqlew is an MCP server that stores **architectural decisions and constraints** in a SQL database — with rationale, tags, layers, and rejected alternatives. Agents **query intent first** (`suggest`, session context, targeted `decision` / `constraint` lookups) instead of re-deriving design context from a full-tree read every turn.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Without sqlew                         │  With sqlew                 │
│────────────────────────────────────────│─────────────────────────────│
│  Plan/spec: "use Postgres, no Mongo"   │  Plan approved → ADR saved  │
│  Next turn: re-read half the repo      │  Next turn: suggest/query   │
│  "just to confirm the architecture"    │  → intent in milliseconds   │
│  Tokens burned; same audit next agent  │  Code read only for the diff│
└──────────────────────────────────────────────────────────────────────┘
```

sqlew does **not** replace reading code for implementation detail. It replaces **ritual whole-repo archaeology for design intent** with structured recall:

1. **Capture** — Plan Mode + hooks record decisions/constraints when you approve a plan (zero extra ceremony with sqlew-plugin)
2. **Recall** — Session start injects recent context (where the harness supports it); `suggest` finds related ADRs before the agent expands search
3. **Enforce** — Constraints stay first-class rules; duplicate/similarity checks stop circular re-decisions

Built on the [Model Context Protocol](https://modelcontextprotocol.io/) (MCP), so it works with any MCP-compatible AI coding tool.

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

#### oh-my-pi / omp (Extension)

Requires sqlew with the `sqlew/hooks` export (see [Harness Compatibility](docs/HARNESS_COMPATIBILITY.md) for the minimum version). omp uses an in-process **Extension** (`.omp-plugin/`), not Claude-style shell hooks.

**Install:**

```bash
npm i -g sqlew
omp --extension /path/to/sqlew-plugin/.omp-plugin
# or:
omp plugin install /path/to/sqlew-plugin/.omp-plugin
```

Session context via `before_agent_start`; Plan-to-ADR when you approve via `xd://propose` / `/xdev/propose`. Plans live as session-local `local://*-plan.md` (no project `.sqlew/plans/` copy by default). See [Hooks Guide](docs/HOOKS_GUIDE.md#oh-my-pi-omp).

MCP still comes from the project `.mcp.json` (Extension does not re-register MCP when already present).

#### Other harness (MCP only)

MCP server only — no sqlew-plugin hooks or skills (Cursor, Claude Desktop, custom clients, …). See [Harness Compatibility](docs/HARNESS_COMPATIBILITY.md#other-harness--what-is-this-column).

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
- **Fast Queries** — 2-50ms SQL recall for design intent; avoid multi-file repo archaeology every turn
- **Duplicate Detection** — Three-tier similarity scoring (0-100) prevents redundant decisions
- **Constraint Tracking** — Architectural rules and principles as first-class entities
- **Auto-Capture** — Hooks/Extension automatically record decisions from Plan Mode (Claude Code, Codex, Grok Build, Hermes, and oh-my-pi via sqlew-plugin)
- **Session Context Injection** — Recent decisions and active constraints injected at session start (Claude Code, Hermes, omp, Codex partial; not Grok Build — see matrix)
- **Multi-Database** — SQLite (default), PostgreSQL, MySQL/MariaDB, or Cloud
- **Git Worktree Ready** — Each worktree shares the same context database

### Harness compatibility

Not every feature works the same on every client. **Grok Build** uses passive hooks (no stdout injection), so session context and plan-mode hook enforcement are skill-based only (◎). **oh-my-pi (omp)** uses an in-process Extension (`sqlew/hooks`) rather than shell hooks — the summary rows below are full (✓).

| Feature | Claude | Codex | Grok | Hermes | omp |
|---------|:------:|:-----:|:----:|:------:|:---:|
| MCP tools | ✓ | ✓ | ✓ | ✓ | ✓ |
| Session context injection | ✓ | △ | — | ✓ | ✓ |
| Plan-to-ADR (auto) | ✓ | △ | △ | ✓ | ✓ |
| Plan mode hook enforcement | ✓ | △ | ◎ | ✓ | ✓ |

✓ full · △ partial · ◎ skills only · ✎ manual MCP · — not available

Full matrix (hooks, **Other harness** column, fallbacks): **[Harness Compatibility](docs/HARNESS_COMPATIBILITY.md)**

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
| Token savings | Fewer full-tree "confirm the architecture" passes; 60-75% vs dumping Markdown ADRs into context |

## Use Cases

- **Architecture Evolution** — Document major decisions with full context and alternatives considered
- **Pattern Standardization** — Establish coding patterns as constraints, enforce via AI code generation
- **Cross-Session Continuity** — Agents reuse recorded intent across days without re-auditing the tree for *why*
- **Multi-Agent Coordination** — Multiple AI agents share architectural understanding
- **Onboarding Acceleration** — New sessions/agents load decisions and constraints first, then read only the code paths that matter

## Documentation

| Guide | Description |
|-------|-------------|
| [ADR Concepts](docs/ADR_CONCEPTS.md) | Architecture Decision Records explained |
| [Configuration](docs/CONFIGURATION.md) | Config file setup, database options |
| [Harness Compatibility](docs/HARNESS_COMPATIBILITY.md) | Feature × harness matrix (MCP, hooks, session context, Plan-to-ADR) |
| [Hooks Guide](docs/HOOKS_GUIDE.md) | Claude Code, Codex, Grok Build, Hermes, and oh-my-pi (omp) integration |
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
