# Plugin Installation

sqlew integrates with AI coding assistants through plugins.

## Prerequisites

Install the sqlew MCP server globally:

```bash
npm i -g sqlew
```

## Claude Code

Two commands to install:

```bash
claude plugin marketplace add sqlew-io/sqlew-plugin
claude plugin install sqlew
```

The plugin automatically configures:
- MCP server settings (`.mcp.json`)
- Claude Code Hooks (plan tracking, decision extraction)
- Claude Code Skills (plan mode guidance, PR enrichment)

To uninstall:

```bash
claude plugin remove sqlew
```

Source: https://github.com/sqlew-io/sqlew-plugin

## Codex

```bash
git clone https://github.com/sqlew-io/sqlew-codex.git
cp -r sqlew-codex/copy_to_codex_dir/* ~/.codex/
```

Then add to `~/.codex/config.toml`:

```toml
[mcp_servers.sqlew]
command = "sqlew"
args = []
```

To uninstall, remove the copied skill directories and config entries.

Source: https://github.com/sqlew-io/sqlew-codex

## Grok Build

sqlew-plugin provides unified support for Claude Code and Grok Build (v5.2+).
No separate adapter is required.

```bash
npm i -g sqlew
grok plugin install sqlew-io/sqlew-plugin --trust
grok plugin update
```

For local development, install from a cloned directory instead:

```bash
git clone https://github.com/sqlew-io/sqlew-plugin.git
grok plugin install ./sqlew-plugin --trust
```

Verify installation:

```bash
grok plugin list          # sqlew enabled + trusted
grok inspect              # hooks, MCP, skills visible
```

**Important**:
- Do NOT register sqlew hooks in `~/.grok/hooks/` (causes double-firing with plugin hooks)
- Do NOT add `[mcp_servers.sqlew]` to `~/.grok/config.toml` (plugin `.mcp.json` handles MCP)
- Plan mode guidance uses plugin skills (`sqlew-plan-guidance`, `sqlew-decision-format`), not hook injection
- Plan-to-ADR extracts `### 📌 Decision:` / `### 🚫 Constraint:` from `plan.md` on `exit_plan_mode`

Source: https://github.com/sqlew-io/sqlew-plugin

## What Gets Configured

| Feature | Claude Code | Codex | Grok Build |
|---------|-------------|-------|------------|
| MCP server | Auto-configured | Manual (config.toml) | Plugin `.mcp.json` |
| Plan-to-ADR | Skills + Hooks | Skills + System prompt | Skills + Hooks |
| PR enrichment | Skill (sqlew-pr-adr) | Skill (sqlew-pr-adr) | Skill (sqlew-pr-adr) |
| Decision format guidance | Skill (sqlew-decision-format) | Skill (sqlew-decision-format) | Skill (sqlew-decision-format) |

## Version History

- **v5.2.0**: Grok Build support via sqlew-plugin (hook normalization, Grok plan path, skills-based plan guidance)
- **v5.0.0**: Plugin-first architecture (sqlew-plugin for Claude Code, sqlew-codex for Codex)
- **v4.3.0**: Plan-to-ADR - Automatic ADR from Plan Mode
- **v4.1.0**: Initial Claude Code Hooks integration
