<div align="center">
  <img src="openclaw-ams-mascot.png" alt="openclaw-ams mascot" width="280">

  <h1>openclaw-ams</h1>
  <h3>Persistent OpenClaw Agent Memory System with Local CPU Inference</h3>
</div>



`openclaw-ams` is a working experimental foundation for persistent agents,
memory systems, local inference, tool use, and automation. It is inspired by
the concepts demonstrated with Felix, but it is an independent project built
from public OpenClaw functionality and documentation. It is not a finished
Felix replacement and does not claim frontier-model quality.

This repository does **not** implement a competing memory engine. It pins and
configures OpenClaw v2026.8.1's native memory stack, adds reproducible
deployment boundaries, and documents explicit placement and privacy choices.

> **The architecture is operational, but the current practical bottleneck is
> local inference on the available CPU-only hardware.**

The project focuses primarily on how an OpenClaw agent can retain useful,
auditable context across sessions without mixing private runtime data into the
source repository. Local-model support is a second research track: it makes the
stack self-hostable, but capable models on old CPUs can take tens of minutes or
several hours to complete complex agent tasks.

## What this repository contains

- project-owned deployment wrappers for a pinned OpenClaw release;
- a documented three-tier persistent-memory architecture;
- a sanitized OpenClaw configuration example;
- a safe SSH-tunnel helper for an optional remote inference host;
- records from CPU-only llama.cpp experiments;
- reproducible setup and security boundaries.

The repository intentionally contains no live agent workspace, personal
memory, session history, credentials, runtime databases, logs, model weights,
or vendored OpenClaw checkout.

## Native OpenClaw memory, configured deliberately

The memory design follows the public documentation shipped with OpenClaw
v2026.8.1. It uses OpenClaw's native mechanisms rather than introducing a
parallel memory engine:

| Layer | Canonical location | Role |
| --- | --- | --- |
| Daily episodic memory | `runtime/workspace/memory/YYYY-MM-DD.md` | Recent work, observations, unresolved loops, and session summaries |
| Curated persistent memory | `runtime/workspace/MEMORY.md` | Compact durable decisions, lessons, and non-profile facts |
| User directives | `runtime/workspace/USER.md` | Stable preferences and active user/project guidance, kept separate from general memory |
| Structured knowledge | `runtime/state/wiki/<agent>/` | Source-backed claims, evidence, entities, relationships, syntheses, and provenance |

The ownership boundary is intentional:

| OpenClaw v2026.8.1 provides | This project configures or documents |
| --- | --- |
| `USER.md`, `MEMORY.md`, daily memory files, and `DREAMS.md` | Episodic / curated / structured terminology and strict placement rules |
| Bundled `memory-core`, SQLite-backed memory, FTS/vector-capable retrieval, pre-compaction flush, and dreaming | Credential-free FTS-only search with `memory.search.provider: "none"` |
| Bundled optional `memory-wiki` | Enabled agent-scoped bridge mode, provenance rules, and no compiled digest in every prompt |
| Native workspace and plugin lifecycle | Docker persistence, private runtime separation, and reproducible validation |

The three tiers are therefore a project organization policy over public
OpenClaw surfaces—not a new storage or retrieval implementation.

The design emphasizes:

- persistence across sessions and container recreation;
- explicit ownership of each memory tier;
- retrieval without treating memory as authorization;
- separation of stable user guidance from general long-term memory;
- evidence and provenance for structured knowledge;
- controlled consolidation rather than indiscriminate prompt growth.

The detailed architecture, operational commands, and validation record are in
[docs/memory-architecture.md](docs/memory-architecture.md). The author's actual
`MEMORY.md`, `USER.md`, daily notes, wiki vault, and database indexes are
private runtime data and are not included.

## Reference hardware architecture

The reference deployment separates the persistent agent environment from local
inference:

```text
OpenClaw / Atlas5
Intel Core i5-4590
        |
        | SSH tunnel
        | OpenAI-compatible HTTP API
        v
llama.cpp / Argo Forge / Argo3
Intel Core i3-3240
local GGUF model
```

Atlas5 runs OpenClaw and owns the persistent agent environment. Argo3 runs the
CPU-only model through the separate
[Argo Forge](https://github.com/Uraroga/argo-forge) project. The inference
endpoint is bound to localhost on Argo3 and is reachable from the OpenClaw
container only through a host-verified SSH tunnel.

Argo3 is an HP Elite 8300 SFF with two physical Ivy Bridge cores / four logical
threads, 32 GB DDR3, AVX/F16C, no AVX2/FMA, and no GPU inference. Atlas5 owns
OpenClaw, its UI, persistent agent runtime, memory, and telemetry. The route is:

```text
OpenClaw container on Atlas5
  -> host.docker.internal on the Atlas5 Docker bridge
  -> host-verified SSH local forward
  -> Argo3 127.0.0.1:8080
  -> Argo Forge managed llama-server
```

Argo3 port 8080 is not intentionally exposed to the LAN.

The older i3-3240 is deliberately used for inference because it runs
considerably cooler during sustained workloads. It has sustained approximately
200% CPU utilization for many hours, including overnight work. The faster
i5-4590 has shown excessive temperatures and kernel panics during heavy,
long-running inference. Stability and thermal behavior matter more here than
short benchmark speed.

The current validated integration uses Qwen3 14B Q2_K, context 16,384, two
generation threads, two batch threads, CPU-only mmap, reasoning off, one slot,
`n_batch=256`, and `n_ubatch=128`.

## What the slow-provider research found

Privacy-safe metadata instrumentation separated prompt construction, provider
wall time, llama.cpp processing, and queue/slot lifecycle without logging
prompt, memory, tool, or response contents. It showed that one apparently
31-minute successful request contained about 10 minutes 57 seconds of actual
llama.cpp work and about 20 minutes 50 seconds waiting behind a cancelled slot.

On the pinned llama.cpp Ivy Bridge runtime, cancellation is serviced after a
logical decode batch rather than an internal physical microbatch. A controlled
2,100-token sweep found sub-percent prompt-throughput differences—treated as
noise—while reducing batch size materially improved cancellation:

| `n_batch / n_ubatch` | Prompt tok/s | Cancel-to-release |
| ---: | ---: | ---: |
| 2048 / 512 | 1.5206 | 1,271.790 s (`HISTORICAL_GOAL_5J`) |
| 1024 / 512 | 1.5132 | 651.869 s |
| 512 / 256 | 1.5216 | 322.765 s |
| 256 / 128 | 1.5235 | 159.462 s |

The adopted 256/128 pair improved cancellation latency by 87.462% against the
historical 2,048 baseline with no measured prompt-throughput penalty. This is
evidence for one model, runtime, prompt, and old CPU—not a universal llama.cpp
setting. See [the complete local-inference record](docs/local-model-integration.md),
[telemetry semantics](docs/prompt-telemetry.md), and the
[machine-readable sweep](telemetry/results/goal5k-batch-sweep.json).

## Pinned OpenClaw release

This project targets:

- OpenClaw `v2026.8.1`;
- commit `ea806575e6450e4d1efdfc72c19f04be982a1b9b`;
- official immutable image
  `ghcr.io/openclaw/openclaw@sha256:e7849cb6c1ef1ead39ab4be7d85edb2df89611f486e283284c7cf35ce39a20d4`.

OpenClaw is not vendored. The deployment wrapper requires a separate clean
checkout at the exact tag and commit:

```bash
mkdir -p upstream
git clone --branch v2026.8.1 --depth 1 \
  https://github.com/openclaw/openclaw.git \
  upstream/openclaw-v2026.8.1
test "$(git -C upstream/openclaw-v2026.8.1 rev-parse HEAD)" = \
  ea806575e6450e4d1efdfc72c19f04be982a1b9b
```

The wrapper refuses a different, untagged, or locally modified checkout.

## Quick start

Prerequisites are Linux, Git, Docker Engine with Compose v2, `curl`, and a
strong operator-owned Gateway token. For remote inference, also install an SSH
client and configure key-based access with host verification.

```bash
cp deployment/openclaw.env.example deployment/openclaw.env
mkdir -p runtime/state runtime/workspace runtime/auth-profile-secrets
cp config/openclaw.example.json runtime/state/openclaw.json
./deployment/initialize-workspace.sh

export OPENCLAW_GATEWAY_TOKEN='<generate and store outside the repository>'
./deployment/openclaw-compose.sh up -d openclaw-gateway
unset OPENCLAW_GATEWAY_TOKEN

curl -fsS http://127.0.0.1:18789/healthz
curl -fsS http://127.0.0.1:18789/startupz
curl -fsS http://127.0.0.1:18789/readyz
```

Copy the sanitized configuration example only for a new deployment; never
overwrite an existing live configuration blindly.

For the complete setup, memory initialization, local-model options, tunnel
configuration, and security notes, read [docs/setup.md](docs/setup.md).

The local inference host is optional. Developers reproducing the reference
split should also read the separate
[Argo Forge repository](https://github.com/Uraroga/argo-forge) and verify their
own CPU flags, GGUF license, context, batch sizes, and port bindings.

## Security boundary

Everything under `runtime/` is local and private. In particular, never commit:

- Gateway tokens, provider API keys, or auth profiles;
- `runtime/state/`, SQLite databases, session history, caches, or logs;
- `runtime/workspace/`, including `USER.md`, `MEMORY.md`, and daily memory;
- `runtime/auth-profile-secrets/`;
- SSH private keys, cookies, model files, or GGUF weights;
- `.env`, backup, or temporary files.

The root `.gitignore` excludes those paths and file classes. Treat it as a
backstop, not as a substitute for reviewing `git diff --cached` before every
push.

## Project layout

```text
openclaw-ams/
├── config/                         # sanitized examples only
├── deployment/                     # project-owned wrappers and safe templates
├── docs/                           # architecture, setup, and experiment records
├── telemetry/                      # metadata-only plugin, parser, tests, results
├── runtime/                        # created locally; entirely ignored/private
└── upstream/                       # separately cloned OpenClaw; entirely ignored
```

Key reading:

- [Native memory configuration](docs/memory-architecture.md)
- [Stable runtime](docs/runtime.md)
- [Reproducible setup](docs/setup.md)
- [Local CPU inference research](docs/local-model-integration.md)
- [Privacy-safe prompt telemetry](docs/prompt-telemetry.md)
- [OpenClaw provenance](docs/upstream.md)

## Scope and limitations

This is primarily a learning and research project covering OpenClaw
architecture, persistent agent memory, local LLM inference, tool use, and
autonomous-agent workflows. It demonstrates an operational architecture, not a
production security certification or a claim that current local models match
hosted frontier systems. CPU-only inference on the reference machines is the
dominant limitation.

## Third-party software and licensing

The MIT License in [LICENSE](LICENSE) applies only to the original
`openclaw-ams` code and documentation created in this repository, copyright
2026 Sergio De Rossi.

OpenClaw, llama.cpp, Argo Forge, model weights, container images, and all other
third-party components remain separate works under their respective licenses
and terms. This repository does not relicense, redistribute, or claim ownership
of them. Review each upstream project's license and every model's license or
usage terms before installation.
