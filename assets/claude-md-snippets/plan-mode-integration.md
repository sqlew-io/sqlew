## Plan Mode Integration

### REQUIRED: Suggest Search BEFORE Planning

**CRITICAL**: Before writing any plan, you MUST search for related context.

**Step 1**: Extract keywords from the user's task (e.g., migration, auth, database)

**Step 2**: Run suggest search:
```
suggest { action: "by_context", key: "<keyword>", tags: ["<relevant-tags>"] }
suggest { action: "by_context", target: "constraint", text: "<topic>" }
```

**Step 3**: Include results in plan (MANDATORY section):
```markdown
## Related Context (from sqlew)

### Past Decisions
| Key | Value | Score |
|-----|-------|-------|
| path/to/decision | description | 85 |

> If empty: "No related decisions found for: <keywords>"

### Applicable Constraints
- **[category]**: constraint text (Priority: high)

> If empty: "No constraints found for: <keywords>"
```

**FAILURE TO INCLUDE "Related Context" SECTION = INVALID PLAN**

---

### REQUIRED: Decision & Constraint Recording

**When writing plans, you MUST include the following sections:**

1. **📌 Decisions** - Technology choices, architecture patterns, implementation approaches
2. **🚫 Constraints** - Rules, restrictions, limitations, prohibited patterns from user requirements

**IMPORTANT**: If the user mentions any restrictions, prohibitions, or "don't use X", these MUST be recorded as 🚫 Constraints.

---

**Decision format (REQUIRED for any technical choice):**

```markdown
### 📌 Decision: [key/path]
- **Value**: Description of the decision
- **Layer**: presentation | business | data | infrastructure | cross-cutting
- **Tags**: tag1, tag2 (optional)
```

**Constraint format (REQUIRED when user specifies restrictions):**

```markdown
### 🚫 Constraint: [category]
- **Rule**: Description of the constraint
- **Priority**: critical | high | medium | low
- **Tags**: tag1, tag2 (optional)
```

Category options: `architecture` | `security` | `code-style` | `performance`

---

### With Claude Code Hooks (Recommended)

If you've run `sqlew --hooks`, sqlew integration is **fully automatic**:

- 📌/🚫 patterns are auto-detected and registered as draft on ExitPlanMode
- Related decisions are auto-suggested before Task execution
- Decisions are auto-saved when code is edited

### Manual Usage (Without Hooks)

**Research Phase:**
- `/sqlew search for <topic>` - find related decisions

**Final Plan Phase:**
- `/sqlew record <decision>` - record key architectural decisions

---

### Failed Queue Check (IMPORTANT)

**At the start of plan mode**, check if `.sqlew/queue/failed.json` exists:

```bash
# Check failed queue status
queue { action: "list" }  # Shows both pending and failed items
```

**If failed items exist:**

1. **Review each failed item** - Common failure: HighSimilarity (60%+) means the item is similar to an existing decision
2. **Resolution options:**
   - **If truly duplicate**: Delete the failed queue file or use `queue { action: "clear" }` with `target: "failed"`
   - **If different intent**: Use a more specific key and re-register manually via `/sqlew record <decision>`
3. **After resolving**: Delete or empty the failed queue file

**Why this happens**: Items that fail processing (e.g., high similarity to existing decisions) are moved to `failed.json` instead of being retried indefinitely. This prevents infinite retry loops.
