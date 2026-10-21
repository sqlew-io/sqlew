#!/usr/bin/env bash
# beforeSubmitPrompt marker — fail-open (never non-zero; always continue)
set +e
cat >/dev/null 2>&1 || true
printf '%s\n' '{"continue":true,"additional_context":"SQLEW_CLOUD_BSP_MARKER_v1"}'
exit 0
