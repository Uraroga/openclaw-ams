#!/usr/bin/env bash
set -euo pipefail

deployment_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "$deployment_dir/.." && pwd)"
upstream_dir="$project_root/upstream/openclaw-v2026.8.1"
env_file="${OPENCLAW_ENV_FILE:-$deployment_dir/openclaw.env}"
release_tag="v2026.8.1"
pinned_commit="ea806575e6450e4d1efdfc72c19f04be982a1b9b"

if [[ ! -f "$env_file" ]]; then
  echo "Missing deployment environment file: $env_file" >&2
  echo "Copy deployment/openclaw.env.example to deployment/openclaw.env and review it." >&2
  exit 1
fi

actual_commit="$(git -C "$upstream_dir" rev-parse HEAD)"
if [[ "$actual_commit" != "$pinned_commit" ]]; then
  echo "Refusing to run: stable upstream HEAD is $actual_commit, expected $release_tag ($pinned_commit)" >&2
  exit 1
fi

actual_tag="$(git -C "$upstream_dir" describe --tags --exact-match 2>/dev/null || true)"
if [[ "$actual_tag" != "$release_tag" ]]; then
  echo "Refusing to run: stable upstream checkout is not exactly tagged $release_tag" >&2
  exit 1
fi

if [[ -n "$(git -C "$upstream_dir" status --porcelain)" ]]; then
  echo "Refusing to run: upstream/openclaw-v2026.8.1 has local modifications" >&2
  exit 1
fi

mkdir -p \
  "$project_root/runtime/state" \
  "$project_root/runtime/workspace" \
  "$project_root/runtime/auth-profile-secrets"

export OPENCLAW_CONFIG_DIR="$project_root/runtime/state"
export OPENCLAW_WORKSPACE_DIR="$project_root/runtime/workspace"
export OPENCLAW_AUTH_PROFILE_SECRET_DIR="$project_root/runtime/auth-profile-secrets"

compose_files=(-f "$upstream_dir/docker-compose.yml")
telemetry_marker="$project_root/runtime/state/.openclaw-ams-prompt-telemetry.enabled"
telemetry_setting="${OPENCLAW_AMS_PROMPT_TELEMETRY:-}"
if [[ -z "$telemetry_setting" && -f "$telemetry_marker" ]]; then
  telemetry_setting="1"
fi
if [[ "$telemetry_setting" =~ ^(1|true|yes|on)$ ]]; then
  export OPENCLAW_AMS_PROMPT_TELEMETRY="1"
  export OPENCLAW_AMS_PROJECT_ROOT="$project_root"
  compose_files+=(-f "$deployment_dir/openclaw-telemetry.compose.yml")
fi

exec docker compose \
  --env-file "$env_file" \
  --project-directory "$upstream_dir" \
  "${compose_files[@]}" \
  "$@"
