# Goal 3: stable OpenClaw v2026.8.1 runtime

> Historical boundary: this document records the state at the end of Goal 3.
> Goal 4 subsequently enabled the bundled `memory-wiki` plugin and established
> native memory configuration; see [memory-architecture.md](memory-architecture.md).

## Outcome

The active source checkout and Docker runtime now represent one verified
official stable release. Existing state and workspace data were retained, and
the historical Goal 1/2 checkout and documentation remain available.

## Stable release verification

GitHub's official release API reported the latest non-draft, non-prerelease
release on 2026-08-31 as
[v2026.8.1](https://github.com/openclaw/openclaw/releases/tag/v2026.8.1),
published at `2026-08-31T03:30:51Z`.

| Artifact | Verified identity |
| --- | --- |
| Repository | `https://github.com/openclaw/openclaw.git` |
| Release tag | `v2026.8.1` |
| Tag commit | `ea806575e6450e4d1efdfc72c19f04be982a1b9b` |
| Active checkout | `upstream/openclaw-v2026.8.1/` |
| Official image tag | `ghcr.io/openclaw/openclaw:2026.8.1` |
| Immutable OCI index | `sha256:e7849cb6c1ef1ead39ab4be7d85edb2df89611f486e283284c7cf35ce39a20d4` |
| Linux/amd64 manifest | `sha256:2d10a4f97ef114c544cf4fb5848662965f4e37114119572f1a5d5361f5af11c6` |
| OCI source label | `https://github.com/openclaw/openclaw` |
| OCI revision label | `ea806575e6450e4d1efdfc72c19f04be982a1b9b` |
| OCI version label | `2026.8.1` |

The release tag was resolved independently with `git ls-remote`. The official
image tag was resolved with `docker buildx imagetools inspect`; its immutable
index and revision label tie it directly to the selected release commit.

## Historical provenance retained

Goal 3 does not rewrite the earlier record:

- `docs/upstream.md` records the Goal 1 checkout.
- `docs/goal-2-runtime.md` preserves the complete Goal 2 runtime report.
- `upstream/openclaw/` remains clean at
  `270c8230969ca9c0bd8a220a71d4c4c8664cd311`.
- `upstream/openclaw-v2026.8.1/` is the separate clean stable checkout used by
  the active deployment.

The immutable image used as a documented fallback in Goal 2 was already the
official v2026.8.1 image. Goal 3 aligns the source guard and build path to its
matching release, removing the previous source/runtime mismatch.

## Official deployment mechanism

The project wrapper invokes these files from the unmodified stable checkout:

- `upstream/openclaw-v2026.8.1/Dockerfile`
- `upstream/openclaw-v2026.8.1/docker-compose.yml`
- `upstream/openclaw-v2026.8.1/docs/install/docker.md`

`deployment/openclaw-compose.sh` refuses to run unless the checkout is clean,
its HEAD is the release commit, and HEAD is exactly tagged `v2026.8.1`.
`deployment/openclaw.env` selects the official immutable image digest.

An optional exact-source build remains available:

```bash
./deployment/build-image.sh
```

It uses the stable Dockerfile, passes the official `GIT_COMMIT` and
`OPENCLAW_BUILD_TIMESTAMP` arguments, and produces
`openclaw-ams:2026.8.1-source`. The deployment continues to select the
official immutable image unless the operator explicitly changes that setting.

## Persistent layout

The official Compose mounts are redirected to existing project-owned paths:

| Host path | Container path | Contents |
| --- | --- | --- |
| `runtime/state/` | `/home/node/.openclaw` | Config, SQLite state, agents, sessions, plugin state |
| `runtime/workspace/` | `/home/node/.openclaw/workspace` | Native workspace and Markdown memory |
| `runtime/auth-profile-secrets/` | `/home/node/.config/openclaw` | Future auth-profile encryption-key material |

All three mounts were observed as read/write bind mounts on the running
v2026.8.1 Gateway. They survived container removal after validation.

## Controlled workspace migration

The current official workspace and memory documentation reviewed was:

- `docs/concepts/agent-workspace.md`
- `docs/concepts/memory.md`
- `docs/gateway/heartbeat.md`
- `docs/reference/templates/AGENTS.md`
- `docs/reference/templates/SOUL.md`
- `docs/reference/templates/IDENTITY.md`
- `docs/reference/templates/USER.md`
- `docs/reference/templates/BOOTSTRAP.md`
- `docs/reference/templates/HEARTBEAT.md`

The existing `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, and
`BOOTSTRAP.md` were compared against the v2026.8.1 template bodies after the
same documentation front-matter removal used by native setup. All matched;
none was overwritten. Identity and user fields remain unfilled, and
`BOOTSTRAP.md` remains pending for a future identity goal.

`MEMORY.md` has no stock workspace template. Its existing factual foundation
was preserved and its active source reference was updated to v2026.8.1; the
old commit remains recorded as history. The existing daily note was appended
with the factual migration result. No personality or user fact was added.

`HEARTBEAT.md` is retired in v2026.8.1. The runtime no longer reads it and new
workspaces do not create it; current instructions live in the system-owned
monitor's database-backed cron scratch. The workspace has no `HEARTBEAT.md`,
so no doctor migration was necessary and no heartbeat customization was made.

## Current memory conventions and future three-tier fit

The release's native mechanisms already provide the foundation without a
custom memory architecture:

1. Episodic memory: `memory/YYYY-MM-DD.md` daily notes, indexed by the active
   memory plugin and recent files supplied in startup context.
2. Curated long-term memory: compact durable non-profile facts and decisions
   in `MEMORY.md`; stable user directives remain separately in `USER.md`.
   Bundled `memory-core` owns recall and the default dreaming consolidation.
3. Structured knowledge/project memory: v2026.8.1 includes the bundled,
   optional `memory-wiki` layer for provenance-rich pages, claims, evidence,
   entities, projects, and dashboards alongside the active memory plugin.

Goal 3 does not enable or configure `memory-wiki`, create a vault, customize
dreaming, or implement the three tiers. This records the official current path
so a later goal can make an explicit controlled choice.

## Startup commands

Provide a strong Gateway token from an external secret store or process
environment; never add it to `deployment/openclaw.env`:

```bash
export OPENCLAW_GATEWAY_TOKEN='<generate and store externally>'
./deployment/openclaw-compose.sh up -d openclaw-gateway
```

Validate and inspect:

```bash
curl -fsS http://127.0.0.1:18789/healthz
curl -fsS http://127.0.0.1:18789/startupz
curl -fsS http://127.0.0.1:18789/readyz
./deployment/openclaw-compose.sh ps
```

Stop the container without deleting persistent data:

```bash
./deployment/openclaw-compose.sh down
```

The native initializer remains available for a genuinely new or intentionally
reconciled workspace:

```bash
./deployment/initialize-workspace.sh
```

It was not rerun during Goal 3 because the persistent workspace was already
valid and controlled comparison showed that no templates needed seeding.

## Validation performed

On 2026-08-31:

- shell syntax validation passed for all deployment scripts;
- `docker compose config --quiet` passed against the stable official Compose
  file;
- native `openclaw config validate` passed;
- the CLI reported `OpenClaw 2026.8.1 (ea80657)`;
- the Gateway started from the immutable official image and became Docker
  `healthy`;
- `/healthz` returned `{"ok":true,"status":"live"}`;
- `/startupz` returned `{"ok":true,"status":"started"}`;
- `/readyz` returned `{"ready":true}`;
- Docker inspection confirmed all three expected persistent bind mounts;
- channel status returned an empty chat map;
- model status reported the default `openai/gpt-5.6-sol` route and a missing
  OpenAI credential;
- both upstream checkouts remained clean;
- the validation container and network were removed, while persistent paths
  remained present.

The validation Gateway token was a clearly labeled non-secret test value
supplied only in process/container environment. It is not stored in project or
runtime files.

## Credential and integration boundary

The Gateway can start without a provider credential, but a real agent turn
requires a supported OpenAI credential for the current default route or an
explicitly configured alternative provider. No credential was invented.

No Telegram, email, social network, Stripe, GitHub credential, external
account, Atlas/Argo cluster, local LLM, unofficial plugin, fictional Felix
personality, or user-specific memory was configured. Native bundled plugins
may load as part of OpenClaw itself, but no optional integration was activated.
