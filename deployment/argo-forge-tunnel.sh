#!/usr/bin/env bash
set -euo pipefail

deployment_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "$deployment_dir/.." && pwd)"
control_dir="$project_root/runtime/state/tmp/argo-forge-tunnel"
control_socket="$control_dir/control.sock"
local_port="${ARGO_FORGE_TUNNEL_PORT:-18080}"
remote_host="${ARGO_FORGE_SSH_HOST:-Argo3}"

docker_gateway="$(ip -4 -o addr show dev docker0 2>/dev/null | awk '{split($4, parts, "/"); print parts[1]; exit}')"
if [[ -z "$docker_gateway" ]]; then
  echo "Docker bridge docker0 has no IPv4 address; refusing to expose the tunnel on another interface." >&2
  exit 1
fi

ssh_control() {
  ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -S "$control_socket" "$@" "$remote_host"
}

case "${1:-}" in
  start)
    mkdir -p "$control_dir"
    chmod 700 "$control_dir"
    if ssh_control -O check >/dev/null 2>&1; then
      echo "Argo Forge tunnel already running: http://host.docker.internal:$local_port/v1"
      exit 0
    fi
    rm -f "$control_socket"
    if ss -ltnH "sport = :$local_port" | grep -q .; then
      echo "Local port $local_port is already in use; refusing to replace its listener." >&2
      exit 1
    fi
    ssh \
      -o BatchMode=yes \
      -o StrictHostKeyChecking=yes \
      -o ExitOnForwardFailure=yes \
      -M -S "$control_socket" -fNT \
      -L "$docker_gateway:$local_port:127.0.0.1:8080" \
      "$remote_host"
    echo "Argo Forge tunnel started: http://host.docker.internal:$local_port/v1"
    ;;
  status)
    if ssh_control -O check >/dev/null 2>&1; then
      curl -fsS --max-time 5 "http://$docker_gateway:$local_port/health"
      printf '\nTunnel endpoint: http://host.docker.internal:%s/v1\n' "$local_port"
    else
      echo "Argo Forge tunnel is stopped."
      exit 1
    fi
    ;;
  stop)
    if ssh_control -O check >/dev/null 2>&1; then
      ssh_control -O exit >/dev/null
      echo "Argo Forge tunnel stopped."
    else
      rm -f "$control_socket"
      echo "Argo Forge tunnel is already stopped."
    fi
    ;;
  *)
    echo "Usage: $0 {start|status|stop}" >&2
    exit 2
    ;;
esac
