# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 5.x     | :white_check_mark: |
| < 5.0   | :x:                |

Only the latest minor release receives security patches.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Use [GitHub Private Vulnerability Reporting](https://github.com/sqlew-io/sqlew/security/advisories/new) to submit a report. This allows us to discuss and fix the issue before public disclosure.

### What to include

- Type of vulnerability (e.g., SQL injection, path traversal, arbitrary code execution)
- Affected source file(s) and line numbers if known
- Steps to reproduce the issue
- Potential impact

### Response timeline

- **Acknowledgment**: within 72 hours
- **Initial assessment**: within 1 week
- **Fix for Critical/High severity**: within 30 days

## Scope

### In scope

| Area | Examples |
|------|----------|
| SQL injection | Unsanitized input passed to better-sqlite3 queries |
| Path traversal | Manipulated file paths in database or config resolution |
| Code execution | Unintended command execution via MCP tool parameters |
| Dependency vulnerabilities | Known CVEs in direct dependencies |

### Out of scope

| Area | Reason |
|------|--------|
| Denial of service | Local stdio transport; single-client by design |
| Network-based attacks | No network listener; runs locally over stdio |
| Social engineering | Out of scope for this project |
| Vulnerabilities in indirect/dev dependencies | Report upstream instead |

## Threat Model

sqlew is an MCP server that communicates exclusively over **local stdio**. It is not exposed to the network. The primary attack surface is:

1. **MCP tool inputs** - Arguments passed from MCP clients (e.g., Claude Code) to sqlew tools. These may originate from prompt injection or malicious user input.
2. **Configuration files** - `config.toml` and environment files parsed at startup.
3. **Database operations** - SQL queries constructed from tool parameters via better-sqlite3.

## Disclosure Policy

We follow [Coordinated Vulnerability Disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure). After a fix is released, we will:

1. Publish a GitHub Security Advisory
2. Credit the reporter (unless they prefer anonymity)
3. Release a patched version to npm
