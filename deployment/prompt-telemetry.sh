#!/usr/bin/env bash
set -euo pipefail

deployment_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "$deployment_dir/.." && pwd)"
plugin_id="openclaw-ams-prompt-telemetry"
state_dir="${OPENCLAW_AMS_TELEMETRY_STATE_DIR:-$project_root/runtime/state}"
config_path="${OPENCLAW_AMS_CONFIG_PATH:-$state_dir/openclaw.json}"
marker_path="$state_dir/.openclaw-ams-prompt-telemetry.enabled"
snapshot_path="$state_dir/.openclaw-ams-prompt-telemetry.rollback.json"

usage() {
  cat <<'EOF'
Usage: ./deployment/prompt-telemetry.sh <enable|disable|status|watch|test>

  enable   Opt in, grant the plugin's conversation-metadata hook permission,
           and prepare the next Gateway start (does not start any service)
  disable  Restore the exact prior plugin entry/allow-list state
  status   Show whether project-owned telemetry is enabled
  watch    Follow metadata-only Gateway telemetry and selected llama.cpp timing lines
  test     Run the offline telemetry/privacy self-test
EOF
}

require_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    echo "jq is required for safe JSON configuration updates." >&2
    exit 1
  fi
}

replace_config() {
  local temporary_path="$1"
  local config_mode
  config_mode="$(stat -c '%a' "$config_path")"
  chmod "$config_mode" "$temporary_path"
  mv -f -- "$temporary_path" "$config_path"
}

enable_telemetry() {
  require_jq
  if [[ ! -f "$config_path" ]]; then
    echo "OpenClaw configuration not found: $config_path" >&2
    exit 1
  fi
  if ! jq -e 'type == "object"' "$config_path" >/dev/null; then
    echo "Refusing to edit invalid OpenClaw JSON: $config_path" >&2
    exit 1
  fi

  mkdir -p "$state_dir"
  if [[ ! -f "$snapshot_path" ]]; then
    local snapshot_tmp
    snapshot_tmp="$(mktemp "$state_dir/.prompt-telemetry-snapshot.XXXXXX")"
    chmod 600 "$snapshot_tmp"
    jq --arg id "$plugin_id" '{
      version: 1,
      had_entry: (.plugins.entries | type == "object" and has($id)),
      entry: .plugins.entries[$id],
      had_allow: (.plugins | type == "object" and has("allow")),
      allow: .plugins.allow
    }' "$config_path" >"$snapshot_tmp"
    mv -f -- "$snapshot_tmp" "$snapshot_path"
  fi

  local config_tmp
  config_tmp="$(mktemp "$state_dir/.prompt-telemetry-config.XXXXXX")"
  jq --arg id "$plugin_id" '
    .plugins = (.plugins // {}) |
    .plugins.entries = (.plugins.entries // {}) |
    .plugins.entries[$id] = ((.plugins.entries[$id] // {}) + {
      enabled: true,
      hooks: ((.plugins.entries[$id].hooks // {}) + {allowConversationAccess: true})
    }) |
    if ((.plugins.allow | type) == "array" and (.plugins.allow | length) > 0 and (.plugins.allow | index($id)) == null)
    then .plugins.allow += [$id]
    else .
    end
  ' "$config_path" >"$config_tmp"
  replace_config "$config_tmp"
  install -m 600 /dev/null "$marker_path"

  echo "Prompt telemetry is enabled for the next OpenClaw Compose invocation."
  echo "No Gateway, tunnel, or inference service was started."
  echo "Start the Gateway only when the operator-owned token is present:"
  echo "  export OPENCLAW_GATEWAY_TOKEN='<operator-owned strong token>'"
  echo "  ./deployment/openclaw-compose.sh up -d openclaw-gateway"
  echo "  unset OPENCLAW_GATEWAY_TOKEN"
}

disable_telemetry() {
  require_jq
  if [[ -f "$snapshot_path" ]]; then
    if [[ ! -f "$config_path" ]]; then
      echo "Cannot restore telemetry configuration; missing: $config_path" >&2
      exit 1
    fi
    local config_tmp
    config_tmp="$(mktemp "$state_dir/.prompt-telemetry-config.XXXXXX")"
    jq --arg id "$plugin_id" --slurpfile saved "$snapshot_path" '
      ($saved[0]) as $s |
      if $s.had_entry then .plugins.entries[$id] = $s.entry else del(.plugins.entries[$id]) end |
      if $s.had_allow then .plugins.allow = $s.allow else del(.plugins.allow) end
    ' "$config_path" >"$config_tmp"
    replace_config "$config_tmp"
    rm -f -- "$snapshot_path"
  fi
  rm -f -- "$marker_path"
  echo "Prompt telemetry is disabled; the prior plugin configuration was restored."
  echo "Recreate or restart the Gateway for this to take effect if it is currently running."
}

status_telemetry() {
  if [[ -f "$marker_path" ]]; then
    echo "Prompt telemetry: enabled (project marker present)"
  else
    echo "Prompt telemetry: disabled"
  fi
  if [[ -f "$snapshot_path" ]]; then
    echo "Rollback snapshot: present (mode $(stat -c '%a' "$snapshot_path"))"
  else
    echo "Rollback snapshot: absent"
  fi
}

watch_telemetry() {
  echo "Following metadata-only OpenClaw telemetry and llama.cpp timing lines; Ctrl-C stops this viewer."
  echo "The viewer does not start either service."

  set +e
  (
    "$deployment_dir/openclaw-compose.sh" logs --follow --no-log-prefix openclaw-gateway 2>&1 |
      grep --line-buffered -F '[PROMPT-TELEMETRY]'
  ) &
  local gateway_pid=$!
  (
    ssh -o BatchMode=yes -o StrictHostKeyChecking=yes Argo3 \
      'docker logs --tail 0 --follow --timestamps localcode-llama-server 2>&1' |
      grep --line-buffered -E \
        'selected slot|processing task, is_child|cancel task|no slot is available, defer task|prompt processing|prompt eval time|eval time|total time|stop processing' |
      python3 "$project_root/telemetry/llama-log-normalizer.py"
  ) &
  local llama_pid=$!
  trap "kill '$gateway_pid' '$llama_pid' 2>/dev/null || true; wait '$gateway_pid' '$llama_pid' 2>/dev/null || true" EXIT INT TERM
  wait "$gateway_pid" "$llama_pid"
  trap - EXIT INT TERM
}

case "${1:-}" in
  enable)
    enable_telemetry
    ;;
  disable)
    disable_telemetry
    ;;
  status)
    status_telemetry
    ;;
  watch)
    watch_telemetry
    ;;
  test)
    node "$project_root/telemetry/openclaw-ams-prompt-telemetry/self-test.cjs"
    normalized="$({
      printf '%s\n' '2026-09-03T13:00:00.123456789Z 35.33.879.328 I slot print_timing: id  0 | task 2 | prompt processing, n_tokens =   2048, progress = 0.26, t = 1606.96 s / 1.27 tokens per second'
      cat "$project_root/telemetry/fixtures/llama-goal5j-lifecycle.txt"
    } | python3 "$project_root/telemetry/llama-log-normalizer.py")"
    grep -q 'PROMPT_EVAL_PROGRESS.*ACTUAL_PROMPT_EVAL_TOKENS=2048' <<<"$normalized"
    grep -q 'source_wall_at=2026-09-03T13:00:00.123456789Z' <<<"$normalized"
    grep -q 'PROMPT_EVAL_COMPLETE.*ACTUAL_PROMPT_EVAL_TOKENS=974' <<<"$normalized"
    grep -q 'GENERATION_COMPLETE.*ACTUAL_GENERATED_TOKENS=6' <<<"$normalized"
    grep -q 'CANCEL_TO_SLOT_RELEASE_MS=1271790' <<<"$normalized"
    grep -q 'LAST_CANCEL_TO_SLOT_RELEASE_MS=1235839' <<<"$normalized"
    grep -q 'TOKENS_PROCESSED_AFTER_CANCEL=NOT_OBSERVABLE' <<<"$normalized"
    grep -q 'LLAMA_TASK_SUMMARY.*LLAMA_TOTAL_MS=657026.92' <<<"$normalized"
    echo "llama lifecycle normalizer self-test passed"
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
