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

## What Gets Configured

| Feature | Claude Code | Codex |
|---------|-------------|-------|
| MCP server | Auto-configured | Manual (config.toml) |
| Plan-to-ADR | Skills + Hooks | Skills + System prompt |
| PR enrichment | Skill (sqlew-pr-adr) | Skill (sqlew-pr-adr) |
| Decision format guidance | Skill (sqlew-decision-format) | Skill (sqlew-decision-format) |

## Version History

- **v5.0.0**: Plugin-first architecture (sqlew-plugin for Claude Code, sqlew-codex for Codex)
- **v4.3.0**: Plan-to-ADR - Automatic ADR from Plan Mode
- **v4.1.0**: Initial Claude Code Hooks integration
