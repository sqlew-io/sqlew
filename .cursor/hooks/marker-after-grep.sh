#!/usr/bin/env bash
# postToolUse marker for Grep — fail-open (never non-zero)
set +e
# Drain stdin so the hook runner does not block on a full pipe
cat >/dev/null 2>&1 || true
printf '%s\n' '{"additional_context":"SQLEW_CLOUD_HOOK_MARKER_v1"}'
exit 0
