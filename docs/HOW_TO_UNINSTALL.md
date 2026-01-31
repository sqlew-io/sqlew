# How to Uninstall sqlew

This guide explains how to completely remove sqlew from your system.

---

## All Clients (Common Steps)

These steps apply to all MCP clients (Claude Code, Codex, Gemini CLI, etc.).

### 1. Remove SaaS Configuration (if using cloud mode)

If you configured sqlew for SaaS/cloud mode, remove the environment file:

```bash
# Windows
del %USERPROFILE%\.sqlew.env

# macOS / Linux
rm ~/.sqlew.env
```

### 2. Remove Project-Local Data

Each project may have a `.sqlew/` directory containing:
- `sqlew.db` - Local SQLite database
- `config.toml` - Project configuration
- `queue/` - Hook queue files (pending.json, failed.json)

```bash
# In each project directory
rm -rf .sqlew/
```

---

## Claude Code

### 1. Remove sqlew-plugin (if installed)

```bash
# List installed plugins
/plugin list

# Remove sqlew plugin
/plugin remove sqlew

# Remove from marketplace (if added)
/plugin marketplace remove sqlew-io/sqlew-plugin
```

### 2. Remove Plugin Repository (if cloned)

If you cloned the plugin repository locally:

```bash
# Windows
rmdir /s /q %USERPROFILE%\.claude\plugins\sqlew-plugin

# macOS / Linux
rm -rf ~/.claude/plugins/sqlew-plugin
```

### 3. Remove MCP Server Configuration

Edit your Claude Code MCP settings file:

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

Remove the sqlew entry from `mcpServers`:

```json
{
  "mcpServers": {
    "sqlew": { ... }  // ← Delete this entire block
  }
}
```

### 4. Remove Injected CLAUDE.md Section

sqlew automatically injects a section into `~/.claude/CLAUDE.md`. Remove it manually:

1. Open `~/.claude/CLAUDE.md` in your editor
2. Find and delete the section between these markers:

```markdown
<!-- sqlew:auto-injected:start -->
...
<!-- sqlew:auto-injected:end -->
```

**Quick removal (Unix/macOS/WSL):**

```bash
# Backup first
cp ~/.claude/CLAUDE.md ~/.claude/CLAUDE.md.bak

# Remove injected section using sed
sed -i '/<!-- sqlew:auto-injected:start -->/,/<!-- sqlew:auto-injected:end -->/d' ~/.claude/CLAUDE.md
```

**Quick removal (Windows PowerShell):**

```powershell
# Backup first
Copy-Item "$env:USERPROFILE\.claude\CLAUDE.md" "$env:USERPROFILE\.claude\CLAUDE.md.bak"

# Remove injected section
$content = Get-Content "$env:USERPROFILE\.claude\CLAUDE.md" -Raw
$content = $content -replace '(?s)<!-- sqlew:auto-injected:start -->.*?<!-- sqlew:auto-injected:end -->\r?\n?', ''
Set-Content "$env:USERPROFILE\.claude\CLAUDE.md" $content
```

### 5. Remove Global Rules (Legacy v5.0.0)

If you used sqlew v5.0.0 (before v5.0.0), rules were copied to `~/.claude/rules/sqlew/`:

```bash
# Windows
rmdir /s /q %USERPROFILE%\.claude\rules\sqlew

# macOS / Linux
rm -rf ~/.claude/rules/sqlew
```

---

## Codex / Gemini CLI / Other Clients

### 1. Remove MCP Server Configuration

Remove sqlew from your client's MCP configuration file. The location varies by client:

- **Codex**: Check Codex documentation for MCP config location
- **Gemini CLI**: Check Gemini CLI documentation for MCP config location

### 2. Remove Client-Specific Injections (if any)

Future versions may inject into client-specific configuration files. Check for sqlew markers:

```
<!-- sqlew:auto-injected:start -->
...
<!-- sqlew:auto-injected:end -->
```

---

## npm Package Removal

### Uninstall Global Package

If installed globally:

```bash
npm uninstall -g sqlew
# or
npm uninstall -g mcp-sqlew
```

### Remove npm link (Development)

If you used `npm link` for local development:

```bash
# In the mcp-sqlew project directory
npm unlink

# Remove global symlink
npm unlink -g sqlew
```

---

## Verification

After uninstalling, verify removal:

```bash
# Check if sqlew command is available (should fail)
sqlew --version

# Check if MCP server is removed
# Restart your MCP client and verify no sqlew tools appear
```

---

## Reinstallation

To reinstall sqlew:

1. **Recommended (Plugin)**: `/plugin marketplace add sqlew-io/sqlew-plugin`
2. **Manual (MCP)**: Add sqlew to your MCP configuration

See [README.md](../README.md) for installation instructions.
