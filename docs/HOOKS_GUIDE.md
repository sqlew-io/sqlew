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
npm i -g sqlew
codex plugin marketplace add sqlew-io/sqlew-plugin
codex plugin install sqlew --source sqlew-plugin
```

After install, trust bundled hooks via `/hooks` in Codex.

Enable Plan mode when needed:

```toml
[features]
collaboration_modes = true
```

The plugin automatically configures:
- MCP server settings (`.mcp.json`)
- Skills (plan mode guidance, decision format, PR ADR)
- Hooks (plan enforcement, PR ADR guard, decision extraction)

To uninstall:

```bash
codex plugin remove sqlew
```

**Legacy manual install** (deprecated): see [sqlew-codex-skills](https://github.com/sqlew-io/sqlew-codex-skills).

Source: https://github.com/sqlew-io/sqlew-plugin

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
| Install | `claude plugin install` | `codex plugin install` | `grok plugin install` |
| MCP server | Plugin `.mcp.json` | Plugin `.mcp.json` | Plugin `.mcp.json` |
| Plan-to-ADR | Skills + Hooks | Skills + Hooks | Skills + Hooks |
| PR enrichment | Skill + Hook | Skill + Hook | Skill + Hook |
| Decision format guidance | Skill (sqlew-decision-format) | Skill (sqlew-decision-format) | Skill (sqlew-decision-format) |

## Version History

- **v5.2.1**: Codex plugin support via sqlew-plugin (`.codex-plugin`, marketplace, hook normalization, transcript-based plan extraction)
- **v5.2.0**: Grok Build support via sqlew-plugin (hook normalization, Grok plan path, skills-based plan guidance)
- **v5.0.0**: Plugin-first architecture (sqlew-plugin for Claude Code; manual sqlew-codex-skills for Codex — now deprecated)
- **v4.3.0**: Plan-to-ADR - Automatic ADR from Plan Mode
- **v4.1.0**: Initial Claude Code Hooks integration
