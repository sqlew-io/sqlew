# Harness Compatibility Matrix

Which sqlew features work on which AI harness (client). Install [sqlew-plugin](https://github.com/sqlew-io/sqlew-plugin) for hooks and skills unless you use an **Other harness** setup (MCP server only, no plugin).

**Harnesses:** Claude Code · Codex · Grok Build · Hermes · oh-my-pi (omp) · **Other harness** (MCP tools only — Cursor, Claude Desktop, custom clients, …)

## Legend

| Symbol | Meaning |
|--------|---------|
| ✓ | Full support via plugin hooks and/or skills |
| △ | Partial support, fallback path, or environment-dependent (see notes) |
| ◎ | Skills only — plugin skill guides the agent; hook stdout injection does not apply |
| ✎ | Manual — call MCP tools yourself (`decision`, `suggest`, …); no automation |
| — | Not available |

Minimum sqlew versions: Grok Build **5.2+**, Codex **5.2.1+**, Hermes **5.3.0+**, oh-my-pi (omp) Extension **5.4.0+**, session context injection **5.4.0+** (unreleased until tagged).

---

## Feature matrix

| Feature | Claude Code | Codex | Grok Build | Hermes | omp | Other harness |
|---------|:-----------:|:-----:|:----------:|:------:|:---:|:--------------:|
| **MCP tools** (`decision`, `constraint`, `suggest`, `project`, `queue`, …) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Session context injection** (recent decisions + active constraints at session start) | ✓ | △ | — | ✓ | ✓ | ✎ |
| **Plan mode enforcement** (suggest-before-plan, 📌/🚫 format) | ✓ | △ | ◎+file | ✓ | ✓ | ✎ |
| **Plan-to-ADR extraction** (📌 Decision / 🚫 Constraint → DB) | ✓ | △ | △ | ✓ | ✓ | ✎ |
| **Plan file tracking** (`track-plan`) | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| **Decision draft on code edit** (`save` hook) | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| **Related-context suggest** (`suggest` on Task / delegate) | ✓ | ✓ | △ | △ | △ | ✎ |
| **PR ADR guard** (`pr-adr` on `gh pr create`) | ✓ | ✓ | △ | ✓ | ✓ | — |
| **Todo completion → decision status** (`check-completion`) | ✓ | ✓ | △ | ✓ | ✓ | — |
| **Plan-to-ADR rescue on session clear** (`on-session-start`, source=clear) | ✓ | △ | — | — | △ | — |
| **PR body ADR enrichment** (`sqlew-pr-adr` skill) | ✓ | ✓ | ◎ | ◎ | ◎ | — |
| **Slash command** `/sqlew` | ✓ | △ | △ | — | — | — |
| **Desktop project targeting** (`project` tool / `_sqlew_project`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

### Other harness — what is this column?

Any client that connects the sqlew MCP server via `.mcp.json` (or MCP settings) **without** sqlew-plugin hooks or skills. Typical cases: Cursor, Claude Desktop, custom MCP clients, `npx @modelcontextprotocol/inspector`.

- ✓ **MCP tools** and **project targeting** work.
- ✎ Automation (session recall, Plan-to-ADR, suggest-on-task) requires **you or the agent** to call MCP tools explicitly.
- — Hook-only features (`save`, `track-plan`, `pr-adr`, …) do not run.

See [README — Other harness setup](../README.md#other-harness-mcp-only).

Session context injection (v5.4.0+): see the matrix row above. Config: `[hooks] session_context_budget` in [CONFIGURATION.md](CONFIGURATION.md) (default 500; `0` disables). Architecture: [HOOKS_GUIDE.md](HOOKS_GUIDE.md#session-context-injection-v540).

---

## How to Auto-ADR in each harness

Plan normally, mark architectural choices in the plan, and sqlew saves them to the database. Use these markers in the plan body:

- `### 📌 Decision:` — architectural choice (becomes a decision record)
- `### 🚫 Constraint:` — rule or limitation (becomes a constraint record)

Plugin skills (`sqlew-decision-format`) remind the agent of this format when needed.

| Harness | How you plan | When ADR is saved | Notes |
|---------|--------------|-------------------|-------|
| **Claude Code** | **Plan mode** (`Shift+Tab` or permission mode) | When you **approve the plan** (move to implement) | Best-supported path. If you clear the session without approving, sqlew may rescue on the next session start. |
| **Codex** | **Plan mode** (enable `[features] collaboration_modes = true` first) | When the agent **stops** after planning | Trust bundled hooks via `/hooks` after install. |
| **Grok Build** | **Plan mode** | When you **approve the plan** | Skills guide 📌/🚫 format; hooks read `plan.md` on approve (stdout injection is passive). |
| **Hermes** | **`/plan <prompt>`** (plan skill → `.hermes/plans/*.md`) | When the **plan file is written or updated** | No native Plan mode — extraction runs on plan-file saves; `save` promotes drafts when you edit code. |
| **oh-my-pi (omp)** | **Plan mode** + `local://*-plan.md` | When you **write xd://propose** (approve) | Extension maps events in-process; `plan_path` points at the session `local://` file (no project `.sqlew/plans/` copy by default). |
| **Other harness** | No auto flow | When **you** call MCP `decision` / `constraint` | Use `decision set` and `constraint add` explicitly. |

---

## Per-harness quick notes

### Claude Code

Full hook + skill coverage. Best-supported harness.

### Codex

Most hooks work after trusting bundled hooks (`/hooks`). Plan mode needs `collaboration_modes = true`.

### Grok Build

**Passive hooks:** stdout from hooks is ignored except deny JSON on `pre_tool_use`. Plan **format** guidance comes from **skills** (◎). The 📌/🚫 **template block** is maintained on disk in `plan.md` via multi-trigger file injection (`enter_plan_mode`, plan-mode `UserPromptSubmit`, PostToolUse re-inject after overwrites). **Exit gate:** `exit_plan_mode` is denied when `hooks.grok_require_patterns` is true (default) and the plan has no filled 📌/🚫 (template placeholders alone fail). Plan-to-ADR reads `plan.md` when you **approve the plan**. Do not duplicate hooks in `~/.grok/hooks/`.

### Hermes

Context injection only on `pre_llm_call` and `pre_tool_call` block. No `ExitPlanMode` — extraction relies on writes to `.hermes/plans/`. Install via `.hermes-plugin` bundle, not the Claude/Codex manifest.

### oh-my-pi (omp)

In-process **Extension** (not shell `hooks.json`). Install `.omp-plugin` from sqlew-plugin; requires `sqlew` with `sqlew/hooks` export. Session context via `before_agent_start`; Plan-to-ADR on `xd://propose` / `/xdev/propose`; `local://*-plan.md` is resolved to the session artifacts path and stored as `plan_path` (legacy fallback: `.sqlew/plans/<slug>-plan.md` only if resolve fails). Propose gate: `hooks.omp_require_patterns` (default true). MCP still comes from project `.mcp.json`.

### Other harness

All eight MCP tools work (✓). No plugin hooks or skills: record and recall decisions by calling MCP tools (✎). Hook-only automation (—) does not run.

---

## Related docs

- [HOOKS_GUIDE.md](HOOKS_GUIDE.md) — Install steps per harness
- [HERMES_HOOKS.md](HERMES_HOOKS.md) — Hermes wire protocol and config.yaml
- [CONFIGURATION.md](CONFIGURATION.md) — `[hooks] session_context_budget`
- [SHARED_DATABASE.md](SHARED_DATABASE.md) — Desktop agents and `project` tool