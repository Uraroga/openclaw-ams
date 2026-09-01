#!/usr/bin/env bash
set -euo pipefail

deployment_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"$deployment_dir/openclaw-compose.sh" run --rm --no-deps \
  --entrypoint node openclaw-gateway \
  dist/index.js setup --baseline \
  --workspace /home/node/.openclaw/workspace \
  --json
