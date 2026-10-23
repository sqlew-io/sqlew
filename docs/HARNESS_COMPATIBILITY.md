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
| **Research Post suggest** (Grep / WebSearch / WebFetch → related context) | ✓ | △ | △ | ◎ | ✓ | ✎ |
| **Plan-less ADR draft** (Write → `pending.json` enqueue; Stop / flush → DB upsert) | ✓ | △ | △ | ◎ | ✓ | ✎ |
| **Plan mode enforcement** (suggest-before-plan, 📌/🚫 format) | ✓ | △ | ◎+file | ✓ | ✓ | ✎ |
| **Plan-to-ADR extraction** (📌 Decision / 🚫 Constraint → DB) | ✓ | △ | △ | ✓ | ✓ | ✎ |
| **Plan file tracking** (`track-plan`) | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| **Decision draft on code edit** (`save` hook; plan promote **or** plan-less enqueue) | ✓ | ✓ | ✓ | ✓ | ✓ | — |
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

**Plan Mode is not required.** Two capture paths:

### A. Research → ADR (plan-less)

```text
Post(Grep | WebSearch | WebFetch)  → suggest inject (related ADRs)
Post(Write | Edit)                 → enqueue draft to .sqlew/queue/pending.json
Stop / flush-queue / QueueWatcher  → upsert into the database
```

Works wherever Post hooks can inject context and enqueue (Claude Code, omp, Codex/Grok with caveats). **Hermes cannot** drive this automatic trigger via Hooks — use a Skill (`/learn`); see [HERMES_HOOKS.md](HERMES_HOOKS.md).

### B. Plan Mode → ADR (unchanged)

Plan normally, mark architectural choices in the plan, and sqlew saves them to the database. Use these markers in the plan body:

- `### 📌 Decision:` — architectural choice (becomes a decision record)
- `### 🚫 Constraint:` — rule or limitation (becomes a constraint record)

Plugin skills (`sqlew-decision-format`) remind the agent of this format when needed.

| Harness | How you plan | When ADR is saved | Notes |
|---------|--------------|-------------------|-------|
| **Claude Code** | **Plan mode** (`Shift+Tab` or permission mode) **or** research + Write | Plan approve **or** Stop / flush after Write enqueue | Best-supported path. Plan Mode optional. |
| **Codex** | **Plan mode** (enable `[features] collaboration_modes = true` first) **or** research + Write | Agent **stop** after planning / flush | Trust bundled hooks via `/hooks` after install. |
| **Grok Build** | **Plan mode** **or** research + Write | When you **approve the plan**; plan-less enqueue via `save` | Skills guide 📌/🚫; stdout inject is passive — suggest-on-Post is limited. |
| **Hermes** | **`/plan <prompt>`** (plan skill → `.hermes/plans/*.md`) **or** Skill obligating `suggest` + ADR | Plan-file write/update; MCP tools via Skill | No Post-hook research→ADR inject — create a Skill with `/learn` (例: 「調査開始時にsqlewを使ってサジェストを取得し、実装前にADRをsqlewで記録することを義務付けて」). |
| **oh-my-pi (omp)** | **Plan mode** + `local://*-plan.md` **or** research + Write | `xd://propose` **or** `session_stop` flush | Extension maps events in-process; plan-less enqueue on implementation `tool_result`. |
| **Other harness** | No auto flow | When **you** call MCP `decision` / `constraint` | Use `decision set` and `constraint add` explicitly; or install Cursor/plugin hooks where available. |

---

## Per-harness quick notes

### Claude Code

Full hook + skill coverage. Best-supported harness.

### Codex

Most hooks work after trusting bundled hooks (`/hooks`). Plan mode needs `collaboration_modes = true`.

### Grok Build

**Passive hooks:** stdout from hooks is ignored except deny JSON on `pre_tool_use`. Plan **format** guidance comes from **skills** (◎). The 📌/🚫 **template block** is maintained on disk in `plan.md` via multi-trigger file injection (`enter_plan_mode`, plan-mode `UserPromptSubmit`, PostToolUse re-inject after overwrites). **Exit gate:** `exit_plan_mode` is denied when `hooks.grok_require_patterns` is true (default) and the plan has no filled 📌/🚫 (template placeholders alone fail). Plan-to-ADR reads `plan.md` when you **approve the plan**. Do not duplicate hooks in `~/.grok/hooks/`.

### Hermes

Context injection only on `pre_llm_call` and `pre_tool_call` block. **No automatic research→ADR via Post hooks** (`post_tool_call` cannot inject model context). Recommend a Skill via `/learn` that obligates `suggest` at investigation start and ADR recording before implementation. Plan-to-ADR via `.hermes/plans/` still works. Install via `.hermes-plugin` bundle, not the Claude/Codex manifest.

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