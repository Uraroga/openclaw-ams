# Local model integration

## Preserved distributed provider

The existing `atlas-llamacpp` provider remains configured for later comparison.
It points at the Atlas5 + Argo3 distributed llama.cpp deployment, but that
deployment stayed stopped throughout Goal 5C. No RPC server or distributed
cluster process was started for this experiment.

## Goal 5C: standalone Argo3 small model

### Architecture

```text
OpenClaw Gateway container (Atlas5)
  -> host.docker.internal:18080
  -> SSH local forward bound only to Atlas5's Docker bridge
  -> Argo3 127.0.0.1:8080
  -> Argo Forge managed llama-server container
  -> Qwen3-4B-Q4_K_M.gguf (CPU only)
```

Argo Forge is a separate checkout at
`${HOME}/Projects/argo-forge`, whose `origin` is
`https://github.com/Uraroga/argo-forge.git`. Its initial Git state was clean at
commit `7ca653add7f7700f8344fd105583b3936a8ad310` on `main`. Goal 5C added only
a `partial` `qwen3-4b-q4` entry to `models.json`; the existing validated
30B and 35B entries were preserved. The final expected Argo Forge status is
therefore only `M models.json`.

The selected model already existed on Argo3; no small-model transfer or model
download was needed:

- alias: `qwen3-4b-q4`
- GGUF: `Qwen3-4B-Q4_K_M.gguf`
- Argo3 path: `${HOME}/llama-cpp-models/Qwen3-4B-Q4_K_M.gguf`
- file size: 2,497,280,256 bytes
- SHA-256: `7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5`
- runtime: `local/argo-forge-llama-server-ivybridge:dev`
- runtime image ID: `sha256:d2946c22720cbe7e84814cd0a05caf02e976eb686e6fc9322118177f45f3354a`
- llama.cpp commit: `bb4caa7540188872173c44d161602d9271386413`
- CPU baseline: Ivy Bridge, AVX/F16C, no AVX2/FMA/BMI2, no GPU
- context: 8192 tokens
- output allowance: 512 tokens
- threads and batch threads: 2 each

The reusable runtime image had been missing after an Argo3 restart. A build
from Argo Forge's unchanged, pinned Dockerfile was already underway when the
goal was corrected from a large-model test to this small-model test, so it was
allowed to finish. No replacement llama.cpp stack was created. A partially
started 30B copy was not resumed; the user intentionally removed the 30B GGUF,
and Goal 5C did not restore, load, or benchmark it.

Argo Forge publishes the container's port only as
`127.0.0.1:8080:8080`. The Atlas5 helper
`deployment/argo-forge-tunnel.sh` preserves that boundary: SSH host-key
verification and batch authentication remain enabled, the local listener is
bound only to the Docker bridge address, and the OpenClaw container reaches it
through the Compose-provided `host.docker.internal:host-gateway` mapping. Port
8080 is not exposed on Argo3's LAN interface, and port 18080 is not bound on
Atlas5's LAN interface.

### OpenClaw provider

The separate provider ID is `argo-forge`. Its essential configuration is:

```json
{
  "baseUrl": "http://host.docker.internal:18080/v1",
  "api": "openai-completions",
  "timeoutSeconds": 14400,
  "modelId": "/models/Qwen3-4B-Q4_K_M.gguf",
  "contextWindow": 8192,
  "maxTokens": 512
}
```

The exact model ref selected by OpenClaw is
`argo-forge//models/Qwen3-4B-Q4_K_M.gguf`; the doubled slash is intentional
because llama.cpp returned a provider-local model ID beginning with `/`.
Fallbacks are empty. The existing `atlas-llamacpp` provider and OpenAI auth
configuration remain available, but OpenAI was not selected or called.

Pinned OpenClaw v2026.8.1 officially supports
`agents.defaults.experimental.localModelLean`, and it remains explicitly
enabled for this test. Lean mode removes `browser`, `cron`, `message`,
`image_generate`, `music_generate`, `video_generate`, `tts`, and `pdf` from the
direct tool surface unless explicitly required. It defaults larger
plugin/MCP/client catalogs behind structured `tool_search`, `tool_describe`,
and `tool_call` controls while keeping `exec` directly visible. It does not
disable workspace context, memory-core, memory-wiki, read/write/edit, memory
tools, or normal tool policy. Gateway logs confirmed that nine tools were
cataloged behind the compact Tool Search surface.

### Startup and shutdown

Start the Argo3 server, tunnel, and Gateway in that order:

```bash
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes Argo3 \
  'cd "${HOME}/Projects/argo-forge" && ./localcode.py qwen3-4b-q4 --ctx 8192 --steps 24 --output 512 --server-only'

./deployment/argo-forge-tunnel.sh start
./deployment/argo-forge-tunnel.sh status

export OPENCLAW_GATEWAY_TOKEN='<operator-owned token>'
./deployment/openclaw-compose.sh up -d openclaw-gateway
unset OPENCLAW_GATEWAY_TOKEN
```

Validate from inside the Gateway container with a metadata-only request:

```bash
./deployment/openclaw-compose.sh exec -T openclaw-gateway \
  node -e 'Promise.all([fetch("http://host.docker.internal:18080/health").then(r=>r.json()),fetch("http://host.docker.internal:18080/v1/models").then(r=>r.json())]).then(console.log)'
```

Shut down in the reverse order. This retains OpenClaw state, workspace, and all
model files:

```bash
./deployment/openclaw-compose.sh down
./deployment/argo-forge-tunnel.sh stop
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes Argo3 \
  'cd "${HOME}/Projects/argo-forge" && ./localcode.py --stop'
```

### Initial measurements

One exploratory direct request was made; this is not a benchmark campaign.

| Measurement | Result |
| --- | ---: |
| Model load wall time | 4.59 s |
| Loaded container memory | about 1.19 GiB |
| Direct prompt | 13 tokens |
| Direct prompt processing | 6.68 tok/s |
| Direct generation | 5.23 tok/s |
| Direct generation budget/result | 16 tokens; empty visible content, `length` finish |
| CPU during direct request | about 200% Docker CPU (two cores) |
| Peak sampled package temperature | 51°C during direct request |
| Post-request package temperature | 41°C |

The direct response used a deliberately tiny 16-token generation cap. Qwen's
hidden reasoning exhausted that cap before visible `DIRECT_OK`, so the empty
content is recorded as a limitation rather than a successful text assertion.
The server remained stable and cooled immediately after the request.

The fresh OpenClaw session key is `goal5c-argo3-small-20260901`. The exact
message was:

```text
Reply exactly: OPENCLAW_OK

Do not use tools or modify files.
```

Gateway evidence at request start showed:

- a 7,780-token estimated prompt after lean-mode/tool-search reduction;
- provider `argo-forge` and model `/models/Qwen3-4B-Q4_K_M.gguf`;
- only `http://host.docker.internal:18080/v1/chat/completions` as the request URL;
- HTTP 200 with a streaming response from llama.cpp;
- Argo3 llama.cpp at about 200% CPU and 1.27 GiB RAM; package temperature was
  54°C initially and 58°C after about three minutes, safely below the 85°C
  high threshold;
- no llama.cpp/RPC process on Atlas5 and no RPC process on Argo3.

The request was left running for manual observation rather than making Codex
wait through an old-CPU prompt evaluation. Consequently no OpenClaw wall time
or final `OPENCLAW_OK` result is claimed yet. At the small direct prompt rate,
the 7,780-token assembled prompt suggests that prompt overhead—not 4B token
generation—is still the main responsiveness constraint. Increasing context to
16K would add headroom but would not reduce those prompt-processing tokens, so
Goal 5C retains 8192 pending evidence from this run.

The prior distributed 30B run took about 26 minutes to its first OpenClaw
response. The standalone 4B path loads dramatically faster and has practical
direct throughput, but an end-to-end comparison remains incomplete until the
fresh OpenClaw turn finishes. Memory files, memory-core, memory-wiki, and the
structured wiki were not tested or modified in Goal 5C.

## Preserved Goal 5C follow-up: standalone Argo3 Qwen3.5 9B

The later Qwen3.5-9B-UD-Q4_K_XL experiment used a 16,384-token context and did
not immediately overflow OpenClaw's initial prompt. One OpenClaw turn was
observed at approximately 32 minutes, but it is not a valid quality benchmark:
OpenClaw converted the long pasted user prompt into a text attachment and the
model misunderstood the task. Goal 5D did not rerun that model or reuse that
test design.

## Goal 5D: standalone Argo3 Qwen3 8B

### Registry, runtime, and isolation

Goal 5D added this one `partial` registry entry while preserving the existing
4B, 30B, 35B, and 9B entries:

```json
{
  "alias": "qwen3-8b-q4",
  "name": "Qwen3-8B Q4_K_M",
  "file": "qwen3-8b-q4_k_m.gguf",
  "context": 16384,
  "runtime": "local/argo-forge-llama-server-ivybridge:dev",
  "reasoning": "off",
  "server_args": [],
  "status": "partial",
  "note": "Experimental standalone Argo3 model for OpenClaw Goal 5D; full Argo Forge validation not completed"
}
```

The exact existing GGUF is
`${HOME}/llama-cpp-models/qwen3-8b-q4_k_m.gguf`, 5,027,783,872 bytes.
It was mounted read-only without copying, renaming, or downloading. The runtime
is `local/argo-forge-llama-server-ivybridge:dev`, image ID
`sha256:d2946c22720cbe7e84814cd0a05caf02e976eb686e6fc9322118177f45f3354a`,
with llama.cpp commit `bb4caa7540188872173c44d161602d9271386413`
(`b10566-bb4caa754`).

Argo Forge was at commit `7ca653add7f7700f8344fd105583b3936a8ad310`
on `main`. Its pre-change status was `M models.json` plus the pre-existing
untracked `models.json.before-qwen35-9b`; its post-change status is the same at
path level. The Goal 5D change inside `models.json` is only the appended 8B
entry above. The prior dirty entries and backup were preserved.

The actual running llama-server arguments include:

```text
--model /models/qwen3-8b-q4_k_m.gguf
--ctx-size 16384
--threads 2
--threads-batch 2
--n-gpu-layers 0
--load-mode mmap
--reasoning off
```

The pinned runtime's own help officially exposes `--reasoning
[on|off|auto]`. `/props` confirmed a disabled-thinking generation prefix and
the launched container inspection confirmed `--reasoning off`; the direct
response also produced visible content without spending its allowance on
hidden thinking. `/health` returned `ok`, `/v1/models` returned the exact ID
`/models/qwen3-8b-q4_k_m.gguf`, and both `/v1/models` and `/props` reported
`n_ctx: 16384`.

Only Argo3 ran llama-server. Atlas5 ran OpenClaw but no llama.cpp process. The
distributed project and Argo3 RPC remained stopped, and no 27B or other model
was loaded. Argo3 exposed llama-server only on `127.0.0.1:8080`. The existing
project-owned tunnel remained bound only to Atlas5's Docker bridge on port
`18080` and
forwarded through verified SSH host keys to Argo3 localhost. Health and model
discovery passed from Atlas5 and from inside the OpenClaw container.

### Short direct measurement

One short OpenAI-compatible request was used, with a 17-token prompt, a
32-token cap, and the requested reply `DIRECT_OK`. This is a single
reproducible observation, not a benchmark campaign.

| Measurement | Result |
| --- | ---: |
| Model load wall time | 4.58 s |
| Loaded container memory before request | about 2.319 GiB |
| Loaded container memory during request | about 2.324 GiB |
| Prompt processing | 3.62 tok/s (17 tokens, 4.691 s) |
| Generation | 2.96 tok/s (3 tokens, 0.677 s) |
| Direct request wall time | 5.38 s |
| Docker CPU during request | about 200% (two cores) |
| Peak sampled package temperature | 49°C |
| Post-request package temperature | 39°C |
| Visible result | `DIRECT_OK`, `stop`, no hidden-reasoning exhaustion |

The 16K KV/cache configuration explains why loaded memory is higher than the
prior 4B/8K observation. It also provides the headroom that the prior 4B test
lacked, at the cost of lower speed and a much longer OpenClaw prompt prefill.

### OpenClaw route and short tests

Only the existing `argo-forge` provider model was switched. Its base URL
remains `http://host.docker.internal:18080/v1`, API compatibility remains
`openai-completions`, `timeoutSeconds` remains 14,400, and the model limits are
16,384 context tokens and 512 output tokens. The active ref is
`argo-forge//models/qwen3-8b-q4_k_m.gguf`. The existing `atlas-llamacpp`
provider and OpenAI auth/model metadata were preserved, fallbacks remained
empty, and every observed model-fetch URL used only the `argo-forge` tunnel;
no OpenAI cloud inference call occurred.

`agents.defaults.experimental.localModelLean` remained `true`. OpenClaw
cataloged nine tools behind its compact search surface. Workspace access,
memory-core, memory-wiki, the structured wiki, `MEMORY.md`, `USER.md`, and
daily memory were not reconfigured or benchmarked.

The fresh minimal session was
`agent:main:goal5d-minimal-qwen3-8b-20260901` with exactly the requested
`OPENCLAW_OK` prompt. OpenClaw accepted it, selected `argo-forge` and the 8B
model, received HTTP 200 streaming from Argo3, and began prompt processing at
about 200% CPU. The llama.cpp slot was 16,384 tokens and showed no immediate
overflow or truncation. It did not finish within the short observation window,
so no wall time or final `OPENCLAW_OK` is claimed. The run was cancelled by
restarting only the Gateway and then recreating only the managed Argo Forge
server; persistent OpenClaw state and memory mounts were retained.

OpenClaw did not expose a complete prompt-token estimate while either observed
turn was still running (`totalTokens` remained unavailable). llama.cpp exposed
2,048-token prompt-evaluation batches, not the full assembled prompt size. The
prior 4B measurement of approximately 7,780–7,900 initial tokens is therefore
the best comparison point, not a claimed Goal 5D measurement.

The second fresh session is
`agent:main:goal5d-agentic-qwen3-8b-20260901`. It received the required short
workspace-analysis prompt directly as text, not as an attachment. OpenClaw
again selected `argo-forge`, the exact 8B model, thinking off, and 16,384
context; Argo3 began prompt evaluation at about 200% CPU, about 2.421 GiB, and
55°C. No immediate overflow occurred. The request was left running for manual
observation because reaching the first tool call would require a long initial
prefill on this CPU. At documentation time, no tool invocation, file read,
hallucination assessment, final five-item analysis, or `ANALISI_COMPLETATA`
marker could yet be claimed.

Compared with Qwen3 4B, this 8B run has twice the context headroom but direct
throughput fell from about 6.68 to 3.62 prompt tok/s and from about 5.23 to 2.96
generation tok/s; loaded container memory rose from about 1.19 GiB to about
2.32 GiB. Compared with the prior 9B observation, 8B routing and direct output
are validly demonstrated here, but neither experiment has a completed,
controlled OpenClaw quality result. The remaining limitation is OpenClaw's
large initial prompt prefill on a two-core Ivy Bridge CPU, not model loading,
tunnel routing, context capacity, or hidden reasoning.

## Goal 5E: standalone Argo3 Qwen3.8 27B for human evaluation

**Quality result: NOT YET TESTED BY THE HUMAN EVALUATOR.** Goal 5E prepared
infrastructure only. Codex sent no test, agentic, workspace-analysis, or
quality-evaluation prompt to this model and did not inspect a model answer.

The existing readable GGUF was used in place without downloading, copying,
renaming, or deleting any model:

- alias: `qwen38-27b-q4`
- name: `Qwen3.8-27B-Uncensored Q4_K_M`
- GGUF: `${HOME}/llama-cpp-models/Qwen3.8-27B-Uncensored-Q4_K_M.gguf`
- exact file size: 16,810,714,528 bytes
- status: `partial`
- runtime: `local/argo-forge-llama-server-ivybridge:dev`
- runtime image ID:
  `sha256:d2946c22720cbe7e84814cd0a05caf02e976eb686e6fc9322118177f45f3354a`
- llama.cpp revision: `bb4caa7540188872173c44d161602d9271386413`
  (`b10566-bb4caa754`)

The added Argo Forge registry entry is:

```json
{
  "alias": "qwen38-27b-q4",
  "name": "Qwen3.8-27B-Uncensored Q4_K_M",
  "file": "Qwen3.8-27B-Uncensored-Q4_K_M.gguf",
  "context": 16384,
  "runtime": "local/argo-forge-llama-server-ivybridge:dev",
  "reasoning": "off",
  "server_args": [],
  "status": "partial",
  "note": "Experimental standalone Argo3 model prepared for human OpenClaw evaluation in Goal 5E"
}
```

All existing 4B, 8B, 9B, 30B, and 35B entries remain unchanged. Argo Forge
was still at commit `7ca653add7f7700f8344fd105583b3936a8ad310` on `main`.
Its status before Goal 5E was `M models.json` plus the pre-existing untracked
`models.json.before-qwen35-9b`; its path-level status is identical afterward.
The Goal 5E change within `models.json` is only the new 27B entry.

The actual server command uses 16,384 context, 2 inference threads, 2 batch
threads, zero GPU layers, mmap loading, and `--reasoning off`. The runtime
officially exposes that reasoning switch; `/props` reported 16,384 context and
no reasoning generation prefix. The Argo Forge output label is 2,048 tokens.

The model loaded successfully in 49.10 seconds. `/health` returned `ok` and
`/v1/models` returned the exact ID
`/models/Qwen3.8-27B-Uncensored-Q4_K_M.gguf` with `n_ctx: 16384`. Loaded
container memory was approximately 17.39 GiB and the idle package temperature
was 41°C. No direct generation smoke test or benchmark was performed.

The existing SSH tunnel remains bound only to Atlas5's Docker bridge on port
`18080` and
forwards to Argo3 `127.0.0.1:8080`. Health and model discovery passed from
Atlas5 and inside the OpenClaw container. The OpenClaw provider remains
`argo-forge`, with `timeoutSeconds: 14400`, `contextWindow: 16384`,
`contextTokens: 16384`, and `maxTokens: 2048`. The active model is
`argo-forge//models/Qwen3.8-27B-Uncensored-Q4_K_M.gguf`, reasoning is disabled,
and `agents.defaults.experimental.localModelLean` remains enabled.

Before the final Gateway start, the interrupted Goal 5D agentic session was
still durably marked running. To prevent automatic replay against the 27B
model, the tunnel was stopped and that old session was archived through
OpenClaw's lifecycle API, preserving its transcript. The recovery transport
attempt failed locally with `ECONNREFUSED`; Argo3 logs confirmed that no
inference task or prompt processing began. The tunnel was then restored and
the Gateway started cleanly without restart recovery or any model fetch.

In the ready state, OpenClaw is healthy on Atlas5 and its startup log selects
the 27B `argo-forge` model. Argo3 alone runs llama-server, bound only to
localhost. Atlas5 runs no llama.cpp process, RPC and the distributed cluster
remain stopped, and no OpenAI cloud inference request occurred. Workspace,
memory-core, memory-wiki, `MEMORY.md`, `USER.md`, daily memory, and structured
wiki content remain intact and were not tested or redesigned.
