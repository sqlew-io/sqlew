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

sqlew-plugin provides unified support for Claude Code, Grok Build (v5.2+), Codex (v5.2.1+), and Hermes (v5.3.0+).
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

## Hermes (Claude Code / Nous)

Requires sqlew **>= 5.3.0**. Uses the `.hermes-plugin/` bundle (not the Claude/Codex plugin manifest).

**Install:**

```bash
npm i -g sqlew
hermes plugins install sqlew-io/sqlew-plugin/.hermes-plugin
hermes plugins enable sqlew
```

The plugin merges MCP + shell hooks into `~/.hermes/config.yaml` and copies planning skills to `~/.hermes/skills/`.

See [HERMES_HOOKS.md](HERMES_HOOKS.md) for manual `config.yaml` setup, event/tool mapping, and Hermes-specific limitations.

**Uninstall:**

```bash
hermes plugins remove sqlew
```

Merged `config.yaml` entries and skills under `~/.hermes/skills/sqlew-*` are not removed automatically.

## What Gets Configured

| Feature | Claude Code | Codex | Grok Build | Hermes |
|---------|-------------|-------|------------|--------|
| Install | `claude plugin install` | `codex plugin install` | `grok plugin install` | `hermes plugins install …/.hermes-plugin` |
| MCP server | Plugin `.mcp.json` | Plugin `.mcp.json` | Plugin `.mcp.json` | `config.yaml` merge |
| Plan-to-ADR | Skills + Hooks | Skills + Hooks | Skills + Hooks | Skills + shell hooks |
| PR enrichment | Skill + Hook | Skill + Hook | Skill + Hook | Hook (`pr-adr`) |
| Decision format guidance | Skill (sqlew-decision-format) | Skill (sqlew-decision-format) | Skill (sqlew-decision-format) | Skill |

## Version History

- **v5.3.0**: Hermes hook adapter (event/tool normalization, `.hermes/plans`, `pre_llm_call` context injection)
- **v5.2.1**: Codex plugin support via sqlew-plugin (`.codex-plugin`, marketplace, hook normalization, transcript-based plan extraction)
- **v5.2.0**: Grok Build support via sqlew-plugin (hook normalization, Grok plan path, skills-based plan guidance)
- **v5.0.0**: Plugin-first architecture (sqlew-plugin for Claude Code; manual sqlew-codex-skills for Codex — now deprecated)
- **v4.3.0**: Plan-to-ADR - Automatic ADR from Plan Mode
- **v4.1.0**: Initial Claude Code Hooks integration
