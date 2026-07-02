# Hermes Hook Setup

sqlew Plan-to-ADR hooks for [Hermes](https://github.com/NousResearch/hermes-agent) (Claude Code / Nous). Requires **sqlew >= 5.3.0**.

Cross-harness feature matrix: [HARNESS_COMPATIBILITY.md](HARNESS_COMPATIBILITY.md).

## Quick Install (recommended)

Use the [sqlew-plugin](https://github.com/sqlew-io/sqlew-plugin) Hermes bundle:

```bash
npm i -g sqlew
hermes plugins install sqlew-io/sqlew-plugin/.hermes-plugin
hermes plugins enable sqlew
```

The plugin merges MCP + hooks into `~/.hermes/config.yaml` and copies skills to `~/.hermes/skills/`.

## Manual Setup

### MCP server

Add to `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  sqlew:
    command: sqlew
    args: []
    env: {}
```

### Shell hooks

```yaml
hooks:
  pre_tool_call:
    - matcher: "terminal"
      command: "sqlew pr-adr"
      timeout: 10
    - matcher: "write_file|patch"
      command: "sqlew track-plan"
      timeout: 30
    - matcher: "delegate_task"
      command: "sqlew suggest"
      timeout: 30
  post_tool_call:
    - matcher: "write_file|patch"
      command: "sqlew save"
      timeout: 30
    - matcher: "todo"
      command: "sqlew check-completion"
      timeout: 30
  pre_llm_call:
    - command: "sqlew on-prompt"
      timeout: 10
  on_session_start:
    - command: "sqlew on-session-start"
      timeout: 30
  subagent_stop:
    - command: "sqlew on-subagent-stop"
      timeout: 30

hooks_auto_accept: false   # first run prompts per (event, command)
```

Matchers apply only to `pre_tool_call` and `post_tool_call`.

## Verify

```bash
hermes hooks list
hermes hooks test pre_tool_call --for-tool terminal
hermes hooks test pre_llm_call
```

## Differences from Claude Code

| Aspect | Claude / Codex / Grok | Hermes |
|--------|----------------------|--------|
| Hook registration | Plugin `hooks/hooks.json` | `~/.hermes/config.yaml` `hooks:` block |
| Event names | PascalCase (`PreToolUse`) | snake_case (`pre_tool_call`) — normalized by sqlew |
| Tool names | `Bash`, `Write`, `Edit` | `terminal`, `write_file`, `patch` — normalized by sqlew |
| Plan mode | `permission_mode: plan` or Enter/ExitPlanMode | No native plan mode; `plan` skill writes `.hermes/plans/*.md` |
| Context injection | `SessionStart`, `UserPromptSubmit`, `PostToolUse` | **`pre_llm_call` only** (`{"context":"..."}`) — includes session memory + plan guidance |
| Tool blocking | PreToolUse deny JSON | **`pre_tool_call` only** (`{"decision":"block","reason"}`) |
| Plan exit hook | `ExitPlanMode` → `on-exit-plan` | **Not available** — use `track-plan`/`save` on `.hermes/plans/` writes |

## Plan-to-ADR workflow on Hermes

1. **`pre_llm_call`** — sqlew injects session context (recent decisions + active constraints, first prompt per session) combined with plan guidance in one `{"context":"..."}` line (FULL on first prompt, SHORT after).
2. **Write plan** — use the `plan` skill; files land in `.hermes/plans/*.md`.
3. **`track-plan`** — fires on `write_file|patch` to plan paths; caches plan metadata.
4. **`save`** — promotes decisions when implementation files are edited.
5. **MCP tools** — agent can call `decision` / `constraint` directly per skill guidance.

There is no `ExitPlanMode` equivalent. Extraction relies on plan-file writes and optional `subagent_stop`.

## Hook allowlist

Hermes prompts for `(event, command)` approval on first run. For CI / gateway:

- `hooks_auto_accept: true` in config, or
- `HERMES_ACCEPT_HOOKS=1`, or
- `hermes --accept-hooks` (when supported by your entrypoint)

## Optional: `post_llm_call` (Stop)

sqlew's `on-stop` cleanup is not wired by default on Hermes (stdout ignored except on `pre_llm_call` / `pre_tool_call`). Add manually if needed:

```yaml
hooks:
  post_llm_call:
    - command: "sqlew on-stop"
      timeout: 30
```

## Skills

Copy from sqlew-plugin or install via the Hermes plugin bundle:

- `sqlew-decision-format` — `📌` / `🚫` block format
- `sqlew-plan-guidance` — suggest search + Related Context section
- `sqlew-pr-adr` — PR body enrichment

## `delegate_task` caveat

Hermes `delegate_task` maps to Claude `Task`, but has no `subagent_type: Plan`. The `suggest` hook clears Plan-agent cache only — under Hermes it is mostly a no-op. Use MCP `suggest` directly in plans instead.

## Uninstall

**Plugin install:**

```bash
hermes plugins remove sqlew
```

Removes `~/.hermes/plugins/sqlew/`. Merged config and copied skills are **not** reverted automatically.

**Full cleanup (optional):**

1. Edit `~/.hermes/config.yaml` — remove `mcp_servers.sqlew` and sqlew `hooks:` entries
2. Delete `~/.hermes/skills/sqlew-decision-format`, `sqlew-plan-guidance`, and `sqlew-pr-adr` if no longer needed
3. `hermes gateway restart` if the gateway is running