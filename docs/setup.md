# Reproducible setup

This guide creates a new `openclaw-ams` deployment without access to the
author's machines, network, credentials, model files, or private memory.

## Prerequisites

- Linux with Git, `curl`, and Bash;
- Docker Engine and Docker Compose v2;
- enough disk space for the OpenClaw image and local runtime data;
- a strong Gateway token stored outside the repository;
- optionally, a separate Linux inference host with Docker, llama.cpp or Argo
  Forge, a legally obtained GGUF model, and key-based SSH access.

The reference scripts assume Docker's standard `docker0` bridge exists. Review
all port bindings and firewall rules for your host before starting the Gateway.

## 1. Clone this repository and pinned OpenClaw

```bash
git clone https://github.com/Uraroga/openclaw-ams.git
cd openclaw-ams

mkdir -p upstream
git clone --branch v2026.8.1 --depth 1 \
  https://github.com/openclaw/openclaw.git \
  upstream/openclaw-v2026.8.1

test "$(git -C upstream/openclaw-v2026.8.1 rev-parse HEAD)" = \
  ea806575e6450e4d1efdfc72c19f04be982a1b9b
test "$(git -C upstream/openclaw-v2026.8.1 describe --tags --exact-match)" = \
  v2026.8.1
```

The `upstream/` directory is ignored. OpenClaw remains a separate project under
its own license and is never committed into this repository.

## 2. Create private local configuration

```bash
cp deployment/openclaw.env.example deployment/openclaw.env
mkdir -p runtime/state runtime/workspace runtime/auth-profile-secrets
cp config/openclaw.example.json runtime/state/openclaw.json
```

Review both copies. `deployment/openclaw.env` and everything under `runtime/`
are ignored. Do not put credentials in the example or live JSON files.

The example selects a remote OpenAI-compatible llama.cpp endpoint. Replace
`/models/your-model.gguf` everywhere with the exact ID returned by your
server's `/v1/models` endpoint. Keep the leading slash when the server returns
one; this produces an intentional doubled slash in the OpenClaw model ref.
Adjust context and output limits to values the loaded model and hardware can
actually sustain.

If you are not using a local model, configure a supported provider through the
official OpenClaw CLI and documentation. Store provider credentials only with
OpenClaw's supported auth mechanism, never in this repository.

## 3. Initialize the private workspace

```bash
./deployment/initialize-workspace.sh
```

This invokes OpenClaw's native baseline setup inside the pinned container. The
resulting workspace is private. It may contain `AGENTS.md`, `SOUL.md`,
`IDENTITY.md`, `USER.md`, `MEMORY.md`, and dated files under `memory/`; none of
those files should be committed.

For a new memory foundation:

1. keep detailed recent work in `memory/YYYY-MM-DD.md`;
2. keep compact durable non-profile knowledge in `MEMORY.md`;
3. keep stable user guidance separately in `USER.md`;
4. use `memory-wiki` for source-backed structured knowledge and provenance;
5. review every promotion and never treat recalled memory as authorization.

The example uses credential-free FTS retrieval with
`memory.search.provider: "none"`. Configure embeddings only through a provider
you have explicitly authorized, then rebuild the index according to the pinned
OpenClaw documentation.

## 4. Optional remote CPU inference

Run exactly one OpenAI-compatible llama.cpp server on the inference machine.
Bind its published host port to loopback only:

```text
127.0.0.1:8080 -> llama-server container:8080
```

Argo Forge can manage this lifecycle, but it remains a separate project. This
repository does not vendor Argo Forge or model weights. Follow its own
installation and licensing documentation.

Configure a reviewed SSH alias on the OpenClaw host, for example:

```sshconfig
Host inference-host
    HostName <inference-host-address>
    User <remote-user>
    IdentityFile <path-to-private-key-outside-this-repository>
```

Connect interactively once and verify the host key. The tunnel helper enforces
batch authentication, strict host-key verification, and exit-on-forward
failure:

```bash
export ARGO_FORGE_SSH_HOST=inference-host
./deployment/argo-forge-tunnel.sh start
./deployment/argo-forge-tunnel.sh status
```

The helper discovers the local Docker bridge address dynamically and binds
port `18080` only there. It forwards to `127.0.0.1:8080` on the inference host.
The OpenClaw container reaches it as
`http://host.docker.internal:18080/v1`. Do not bind llama.cpp broadly to the
LAN or Internet.

Validate metadata without sending a generation prompt:

```bash
curl -fsS http://127.0.0.1:8080/health       # on the inference host
DOCKER_BRIDGE_IP="$(ip -4 -o addr show dev docker0 | awk '{split($4,a,"/"); print a[1]; exit}')"
curl -fsS "http://${DOCKER_BRIDGE_IP}:18080/health"
curl -fsS "http://${DOCKER_BRIDGE_IP}:18080/v1/models"
```

## 5. Gateway authentication and startup

Generate a strong token with an appropriate secret manager or password tool.
Do not put it in shell history, `.env`, JSON, documentation, or source control.

```bash
read -rsp 'Gateway token: ' OPENCLAW_GATEWAY_TOKEN
export OPENCLAW_GATEWAY_TOKEN
printf '\n'

./deployment/openclaw-compose.sh up -d openclaw-gateway
unset OPENCLAW_GATEWAY_TOKEN
```

Verify the native health probes:

```bash
curl -fsS http://127.0.0.1:18789/healthz
curl -fsS http://127.0.0.1:18789/startupz
curl -fsS http://127.0.0.1:18789/readyz
./deployment/openclaw-compose.sh ps
```

The example binds the Gateway according to OpenClaw's Compose configuration.
Use host firewall rules and OpenClaw authentication appropriate to your threat
model. Do not expose an unauthenticated Gateway publicly.

## 6. Memory operations

```bash
# Rebuild and inspect episodic/curated retrieval.
./deployment/openclaw-compose.sh run --rm --no-deps \
  --entrypoint node openclaw-gateway \
  dist/index.js memory index --force --agent main

./deployment/openclaw-compose.sh run --rm --no-deps \
  --entrypoint node openclaw-gateway \
  dist/index.js memory status --agent main --json

# Inspect the structured wiki bridge.
./deployment/openclaw-compose.sh exec -T openclaw-gateway \
  node dist/index.js wiki doctor --agent main --json
```

Read [memory-architecture.md](memory-architecture.md) before enabling automatic
consolidation or changing memory ownership rules.

## 7. Stop safely

```bash
./deployment/openclaw-compose.sh down
./deployment/argo-forge-tunnel.sh stop
```

Container removal retains the ignored bind-mounted state. Back up private
runtime data to an encrypted destination; never commit it as a backup.

## Public/private checklist

Before every push, inspect `git status`, `git ls-files`, and
`git diff --cached`. The public repository must contain only reusable source,
sanitized examples, and aggregate documentation. It must not contain runtime
state, workspaces, memories, auth stores, session transcripts, logs, databases,
SSH keys, `.env` files, model weights, or machine-specific backups.
