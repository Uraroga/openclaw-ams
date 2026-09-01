# Goal 2: native OpenClaw Docker runtime (historical record)

## Outcome

The deployment uses OpenClaw's official Docker Compose topology and native
workspace bootstrap. Project-owned files select persistent host paths and add
pin/cleanliness guards; they do not replace the Gateway, configuration schema,
workspace bootstrap, memory model, or container topology.

The pinned upstream checkout remains unchanged:

- repository: <https://github.com/openclaw/openclaw.git>
- commit: `270c8230969ca9c0bd8a220a71d4c4c8664cd311`
- path: `upstream/openclaw/`

## Official files and commands used

Runtime and deployment guidance:

- `upstream/openclaw/docs/install/docker.md`
- `upstream/openclaw/docs/start/setup.md`
- `upstream/openclaw/docs/concepts/agent-workspace.md`
- `upstream/openclaw/docs/concepts/memory.md`
- `upstream/openclaw/docs/gateway/configuration.md`
- `upstream/openclaw/Dockerfile`
- `upstream/openclaw/docker-compose.yml`
- `upstream/openclaw/scripts/docker/setup.sh`

Workspace template and seed implementation:

- `upstream/openclaw/docs/reference/templates/AGENTS.md`
- `upstream/openclaw/docs/reference/templates/SOUL.md`
- `upstream/openclaw/docs/reference/templates/IDENTITY.md`
- `upstream/openclaw/docs/reference/templates/USER.md`
- `upstream/openclaw/docs/reference/templates/BOOTSTRAP.md`
- `upstream/openclaw/src/agents/workspace.ts`
- `upstream/openclaw/src/commands/setup.ts`

The workspace was created through the native baseline command inside the
official container:

```bash
./deployment/initialize-workspace.sh
```

That wrapper executes:

```bash
node dist/index.js setup --baseline \
  --workspace /home/node/.openclaw/workspace \
  --json
```

The official Docker manual-flow config was applied with native `config set`:

```bash
./deployment/openclaw-compose.sh run --rm --no-deps \
  --entrypoint node openclaw-gateway \
  dist/index.js config set --batch-json \
  '[{"path":"gateway.mode","value":"local"},{"path":"gateway.bind","value":"lan"},{"path":"gateway.controlUi.allowedOrigins","value":["http://localhost:18789","http://127.0.0.1:18789"]}]'
```

## Image provenance and source-build boundary

The preferred exact-source build is:

```bash
./deployment/build-image.sh
```

The script builds `upstream/openclaw/Dockerfile`, passes the pinned Git commit
and UTC build timestamp as the two official provenance build arguments, and
refuses a different or dirty upstream checkout.

On 2026-08-31, two attempts reached the official pnpm dependency stages but
npm registry tarball transfers repeatedly timed out. The final actionable
failure was `ERR_PNPM_TARBALL_FETCH_TARBALL` while retrieving
`@microsoft/mxc-sdk@0.7.0`. No source-build image was falsely labeled as
successful.

Runtime validation therefore used an immutable, official fallback image:

```text
ghcr.io/openclaw/openclaw@sha256:e7849cb6c1ef1ead39ab4be7d85edb2df89611f486e283284c7cf35ce39a20d4
```

Verified OCI metadata:

- source: `https://github.com/openclaw/openclaw`
- revision: `ea806575e6450e4d1efdfc72c19f04be982a1b9b`
- version: `2026.8.1`
- local image ID: `sha256:e7849cb6c1ef1ead39ab4be7d85edb2df89611f486e283284c7cf35ce39a20d4`

The fallback image revision is not the pinned checkout and is recorded as such.
Before using it, the packaged `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`,
and `BOOTSTRAP.md` template files were SHA-256 compared with the pinned checkout;
all five raw files matched byte-for-byte. The native baseline command then
produced workspace files that exactly match the pinned template bodies after
the runtime's documented front-matter removal.

When the exact source build succeeds, set `OPENCLAW_IMAGE=openclaw-ams:270c8230`
for the Compose invocation or update the non-secret image selection in
`deployment/openclaw.env` after verifying the local image provenance.

## Persistence layout

The official Compose mounts are redirected to project-owned persistent paths:

| Host path | Container path | Purpose |
| --- | --- | --- |
| `runtime/state/` | `/home/node/.openclaw` | Config, shared SQLite state, agents, sessions |
| `runtime/workspace/` | `/home/node/.openclaw/workspace` | Native workspace, identity templates, memory |
| `runtime/auth-profile-secrets/` | `/home/node/.config/openclaw` | Future auth-profile encryption-key material |

These are bind mounts, so container replacement does not delete their data.
`runtime/state/` and `runtime/auth-profile-secrets/` are ignored because they
can eventually contain credentials or sensitive runtime data. The workspace is
initialized by OpenClaw as its own Git repository and should remain private.

## Workspace and memory state

Native baseline files:

- `runtime/workspace/AGENTS.md` - exact official template body
- `runtime/workspace/SOUL.md` - exact official template body; not Felix-specific
- `runtime/workspace/IDENTITY.md` - official unfilled identity template
- `runtime/workspace/USER.md` - official unfilled user-model template
- `runtime/workspace/BOOTSTRAP.md` - retained for a future identity conversation

After the factual memory files were added, an idempotency check with a second
`setup --baseline` correctly preserved the workspace but reconciled
`BOOTSTRAP.md` as complete because the workspace now contained user-authored
content. Goal 2 has not completed the identity ritual, so the file was restored
from the exact pinned official template body. Baseline setup was not run again
after that restoration; the future identity goal remains responsible for
following and deleting it.

OpenClaw intentionally has no stock `MEMORY.md` template and normally creates
no memory directory until something is written. To establish real native memory
without empty placeholders, Goal 2 added only factual bootstrap records:

- `runtime/workspace/MEMORY.md`
- `runtime/workspace/memory/2026-08-31.md`

They contain no Felix personality, personal user information, credentials, or
external-service data.

## Starting and stopping

Gateway authentication is mandatory for the Docker `lan` bind. Supply a real,
operator-owned token at process start; do not write it to tracked files:

```bash
export OPENCLAW_GATEWAY_TOKEN='<generate/store outside this repository>'
./deployment/openclaw-compose.sh up -d openclaw-gateway
```

Check native probes:

```bash
curl -fsS http://127.0.0.1:18789/healthz
curl -fsS http://127.0.0.1:18789/startupz
curl -fsS http://127.0.0.1:18789/readyz
./deployment/openclaw-compose.sh ps
```

Stop containers without deleting bind-mounted state:

```bash
./deployment/openclaw-compose.sh down
```

## Validation performed

On 2026-08-31:

- `docker compose config --quiet` passed using the unmodified upstream Compose file.
- Native `openclaw config validate` passed.
- Re-running native `setup --baseline` passed and preserved workspace content.
- The Gateway container started and Docker reported it `healthy`.
- `GET /healthz` returned `{"ok":true,"status":"live"}`.
- `GET /startupz` returned `{"ok":true,"status":"started"}`.
- `GET /readyz` returned HTTP 200 and `{"ready":true}`.
- Native channel status returned an empty chat-channel map.
- The validation container was stopped and removed afterward; persistent bind
  mounts were retained.

The validation token was deliberately labeled non-secret and existed only in
the validation process/container environment. It was not written to project or
runtime files.

## Credential boundary

The Gateway itself starts without a model credential. Native model status
resolves the default route to `openai/gpt-5.6-sol` and reports provider
`openai` as missing. A real model-backed agent turn therefore requires a valid
OpenAI credential configured through OpenClaw's supported onboarding/auth
mechanisms.

No credential was invented, and no agent turn was sent because that would both
fail at provider authentication and begin the retained `BOOTSTRAP.md` identity
ritual. No Telegram, email, GitHub, Stripe, social, Atlas/Argo, or other external
integration was configured.

During the startup smoke test, native defaults started the built-in heartbeat
and the bundled memory plugin created its managed dreaming schedule. Goal 2 did
not customize either behavior and did not add any user cron job or automation.

## Project tree after Goal 2

```text
openclaw-ams/
├── .gitignore                              # deployment-owned
├── README.md                               # deployment-owned
├── deployment/                             # deployment-owned
│   ├── build-image.sh                      # exact pinned-source build
│   ├── initialize-workspace.sh             # native setup --baseline
│   ├── openclaw-compose.sh                 # pin guard + official Compose wrapper
│   └── openclaw.env                        # non-secret runtime selection/settings
├── docs/                                   # deployment-owned
│   ├── runtime.md
│   └── upstream.md
├── runtime/                                # persistent deployment data
│   ├── auth-profile-secrets/               # empty; future sensitive key mount
│   ├── state/                              # native config/SQLite/session state
│   │   ├── agents/
│   │   ├── config-journal-fingerprint.key
│   │   ├── openclaw.json
│   │   └── state/openclaw.sqlite
│   └── workspace/                          # native private agent workspace
│       ├── .git/
│       ├── AGENTS.md
│       ├── BOOTSTRAP.md
│       ├── IDENTITY.md
│       ├── MEMORY.md
│       ├── SOUL.md
│       ├── USER.md
│       └── memory/2026-08-31.md
└── upstream/
    └── openclaw/                            # official unmodified pinned checkout
        └── ...                              # upstream-owned source and docs
```
