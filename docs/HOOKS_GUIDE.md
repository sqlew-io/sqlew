# Plugin Installation

sqlew integrates with AI coding assistants through plugins.

> **Feature × harness matrix:** See [HARNESS_COMPATIBILITY.md](HARNESS_COMPATIBILITY.md) for which capabilities (MCP, session context, Plan-to-ADR, PR guard, etc.) work on Claude Code, Codex, Grok Build, Hermes, and other harness setups (MCP only).

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
- Plan guidance **format** uses plugin skills (`sqlew-plan-guidance`, `sqlew-decision-format`); Grok ignores hook **stdout**, so format reminders are not injected via `UserPromptSubmit`
- Decision/Constraint **template sections** are seeded on `plan.md` via file side-effects (not stdout):
  1. `enter_plan_mode` PreToolUse → `track-plan` creates/appends template
  2. `UserPromptSubmit` when session `plan_mode.json` is Active/Pending → `on-prompt` ensures template (covers `/plan` without `enter_plan_mode`)
  3. PostToolUse on `plan.md` write/edit → `track-plan` re-appends if the agent overwrote the template
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

## oh-my-pi (omp)

Requires sqlew **>= 5.4.0** with the `sqlew/hooks` package export. Uses an in-process **Extension** (`.omp-plugin/`), not Claude-style shell hooks.

**Install:**

```bash
npm i -g sqlew
omp --extension /path/to/sqlew-plugin/.omp-plugin
# or:
omp plugin install /path/to/sqlew-plugin/.omp-plugin
```

Sync skills into the bundle before install:

```powershell
pwsh ./scripts/sync-omp-skills.ps1
```

**Event map (Extension):**

| omp event | Behavior |
|-----------|----------|
| `session_start` | Load snapshot → pending session context + marker (`harness: omp`) |
| `before_agent_start` | Deliver session context once (first message wins) |
| `turn_start` (plan mode) | FULL then SHORT plan guidance via `sendMessage` |
| `tool_call` write `local://*-plan.md` | Ensure 📌/🚫 template; track session `local://` path as `plan_path` |
| `tool_call` write `xd://propose` | Optional filled-pattern gate; `processPlanPatterns` |
| `tool_result` implementation write | `sqlew save` CLI |
| `session_stop` | Fallback extract if `decision_pending && !recorded` |

**Config:**

```toml
[hooks]
session_context_budget = 500
omp_require_patterns = true   # block propose without filled 📌/🚫 (default)
```

`local://` plans resolve to the session artifacts file (`<sessionDir>/local/<slug>-plan.md`) so extraction has an absolute `plan_path` without copying into the project. Legacy fallback writes `.sqlew/plans/` only when resolve fails.

MCP: keep using project `.mcp.json`; the Extension does not re-register MCP when already present.

Source: https://github.com/sqlew-io/sqlew-plugin (`.omp-plugin/`)

## What Gets Configured

| Feature | Claude Code | Codex | Grok Build | Hermes | omp |
|---------|-------------|-------|------------|--------|-----|
| Install | `claude plugin install` | `codex plugin install` | `grok plugin install` | `hermes plugins install …/.hermes-plugin` | `omp --extension …/.omp-plugin` |
| MCP server | Plugin `.mcp.json` | Plugin `.mcp.json` | Plugin `.mcp.json` | `config.yaml` merge | Project `.mcp.json` |
| Plan-to-ADR | Skills + Hooks | Skills + Hooks | Skills + Hooks | Skills + shell hooks | Extension + `sqlew/hooks` |
| PR enrichment | Skill + Hook | Skill + Hook | Skill + Hook | Hook (`pr-adr`) | Extension → `pr-adr` CLI |
| Decision format guidance | Skill (sqlew-decision-format) | Skill (sqlew-decision-format) | Skill (sqlew-decision-format) | Skill | Skill |

## Session Context Injection (v5.4.0+)

sqlew proactively injects recent decisions and active constraints at session start so agents do not need to call `suggest` first.

### Architecture

The MCP server writes `.sqlew/session-context.json` (top-N decisions + active constraints). Hooks read this file only — they never open the database. This mirrors the existing hook queue (`.sqlew/queue/pending.json`) in the reverse direction.

```
decision.set / constraint.add  →  session-context.json  →  on-session-start / on-prompt
```

Snapshot writes are fail-soft: a snapshot failure never fails the primary MCP operation.

Harness support (✓ / △ / — / ◎ / ✎): [HARNESS_COMPATIBILITY.md](HARNESS_COMPATIBILITY.md) feature matrix.

### Configuration

```toml
[hooks]
session_context_budget = 500   # default; set 0 to disable injection and snapshot writes
```

See [CONFIGURATION.md](CONFIGURATION.md) for priority rules (local config overrides global; no deep merge).

### Grok Build limitation

Grok Build hooks are passive — stdout injection is ignored. Session context injection is not available in v5.4. Use `/sqlew search` or the `sqlew-plan-guidance` skill to recall context manually.

**Plan template file injection (v5.5+):** Because stdout cannot carry plan enforcement, sqlew writes the 📌/🚫 template block directly into `~/.grok/sessions/<encoded-cwd>/<sessionId>/plan.md`. Triggers: `enter_plan_mode`, `UserPromptSubmit` while plan mode is Active/Pending (`plan_mode.json`), and PostToolUse after plan.md edits (re-inject if wiped). Skip when the marker or real patterns already exist.

**Exit gate (v5.5+):** PreToolUse on `exit_plan_mode` denies approval when `hooks.grok_require_patterns` is true (default) and `plan.md` has no **filled** Decision/Constraint blocks (placeholders from the auto-template do not count). Fill real 📌/🚫 values, or set Value/Rule to `N/A`, or disable with `grok_require_patterns = false`.

## Version History

- **v5.4.0**: Session context injection (snapshot file, multi-harness delivery, `[hooks]` config); oh-my-pi (omp) Extension (`sqlew/hooks` export, plan materialize, propose gate)
- **v5.3.0**: Hermes hook adapter (event/tool normalization, `.hermes/plans`, `pre_llm_call` context injection)
- **v5.2.1**: Codex plugin support via sqlew-plugin (`.codex-plugin`, marketplace, hook normalization, transcript-based plan extraction)
- **v5.2.0**: Grok Build support via sqlew-plugin (hook normalization, Grok plan path, skills-based plan guidance)
- **v5.0.0**: Plugin-first architecture (sqlew-plugin for Claude Code; manual sqlew-codex-skills for Codex — now deprecated)
- **v4.3.0**: Plan-to-ADR - Automatic ADR from Plan Mode
- **v4.1.0**: Initial Claude Code Hooks integration
