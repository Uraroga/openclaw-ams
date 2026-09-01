#!/usr/bin/env bash
set -euo pipefail

deployment_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "$deployment_dir/.." && pwd)"
upstream_dir="$project_root/upstream/openclaw-v2026.8.1"
release_tag="v2026.8.1"
pinned_commit="ea806575e6450e4d1efdfc72c19f04be982a1b9b"
image_name="openclaw-ams:2026.8.1-source"

actual_commit="$(git -C "$upstream_dir" rev-parse HEAD)"
if [[ "$actual_commit" != "$pinned_commit" ]]; then
  echo "Refusing to build: stable upstream HEAD is $actual_commit, expected $release_tag ($pinned_commit)" >&2
  exit 1
fi

actual_tag="$(git -C "$upstream_dir" describe --tags --exact-match 2>/dev/null || true)"
if [[ "$actual_tag" != "$release_tag" ]]; then
  echo "Refusing to build: stable upstream checkout is not exactly tagged $release_tag" >&2
  exit 1
fi

if [[ -n "$(git -C "$upstream_dir" status --porcelain)" ]]; then
  echo "Refusing to build: upstream/openclaw-v2026.8.1 has local modifications" >&2
  exit 1
fi

build_timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
docker build \
  --build-arg "GIT_COMMIT=$actual_commit" \
  --build-arg "OPENCLAW_BUILD_TIMESTAMP=$build_timestamp" \
  --tag "$image_name" \
  --file "$upstream_dir/Dockerfile" \
  "$upstream_dir"
