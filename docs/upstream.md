# OpenClaw upstream provenance

## Source identity

| Field | Value |
| --- | --- |
| Official repository | <https://github.com/openclaw/openclaw> |
| Git remote | `https://github.com/openclaw/openclaw.git` |
| Local checkout | `upstream/openclaw/` |
| Branch | `main` |
| Commit | `270c8230969ca9c0bd8a220a71d4c4c8664cd311` |
| Commit date | `2026-08-31T12:16:02-07:00` |
| Commit subject | `fix(cli): omit hidden options from generated shell completions (#134247)` |
| Clone mode | Shallow clone (`--depth 1`) |
| Bootstrap review date | 2026-08-31 |

The URL and commit were read directly from the local Git checkout with
`git remote get-url origin` and `git rev-parse HEAD`.

## Official material reviewed

The bootstrap review used only files from the official checkout:

- `upstream/openclaw/README.md`
- `upstream/openclaw/docs/install/index.md`
- `upstream/openclaw/docs/install/docker.md`
- `upstream/openclaw/docs/start/getting-started.md`
- `upstream/openclaw/docs/start/setup.md`
- `upstream/openclaw/docs/concepts/architecture.md`
- `upstream/openclaw/docs/concepts/agent-workspace.md`
- `upstream/openclaw/docs/concepts/memory.md`
- `upstream/openclaw/docs/gateway/configuration.md`
- `upstream/openclaw/Dockerfile`
- `upstream/openclaw/docker-compose.yml`
- `upstream/openclaw/.env.example`

The documentation index was generated from the official checkout by running
`node scripts/docs-list.js`. The equivalent documented command is
`pnpm docs:list`; `pnpm` was not installed on the bootstrap host, so its direct
Node.js script was used without installing dependencies or modifying upstream.

## Bootstrap conclusions from official documentation

- The Gateway is OpenClaw's control plane. Its default local WebSocket/HTTP
  endpoint is `127.0.0.1:18789` for a non-container local setup.
- Source builds are a pnpm workspace. The official instructions require the
  pnpm version pinned by upstream and explicitly do not support a root
  `npm install` as a source setup.
- Docker is optional. The official container flow is owned by the upstream
  `Dockerfile`, `docker-compose.yml`, and `scripts/docker/setup.sh`.
- The official Docker flow can build `openclaw:local` from this source checkout.
  Official prebuilt images also exist, but no image has been selected for AMS.
- OpenClaw configuration is normally stored at
  `~/.openclaw/openclaw.json`; configuration is strictly schema-validated.
- The default agent workspace is `~/.openclaw/workspace`. It is distinct from
  source, configuration, credentials, sessions, and runtime state.
- Workspace identity and memory files include `AGENTS.md`, `SOUL.md`,
  `IDENTITY.md`, optional `USER.md`, optional `MEMORY.md`, and dated files under
  `memory/`. The workspace should be treated as private memory.
- In the official Compose setup, configuration/state, workspace, and the auth
  profile secret-key directory are persistent mounts. Secrets and runtime state
  must not be committed with project documentation or source.
- The official setup guidance says tailoring should live outside the upstream
  source checkout so source updates do not overwrite it.

## Decisions intentionally deferred

No AMS runtime mode, image tag, port exposure, bind mode, provider, channel,
workspace contents, memory engine, secrets mechanism, or startup supervisor was
chosen during this goal. Those decisions require AMS-specific requirements and
must be checked against the corresponding official documentation at this pinned
upstream commit.

No upstream OpenClaw file was edited during bootstrap.
