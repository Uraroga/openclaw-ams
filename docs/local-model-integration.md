# Local model integration

## Current reference architecture and findings

This document preserves the detailed chronological experiment record below.
For public readers, the current outcome is simpler:

```text
Atlas5: OpenClaw v2026.8.1, persistent runtime/memory/UI, metadata telemetry
  -> SSH local forward bound only to the Atlas5 Docker bridge
  -> Argo3: HP Elite 8300 SFF, localhost-only llama-server, CPU-only GGUF
```

Argo3 uses an Intel Core i3-3240 (Ivy Bridge), two physical cores / four
logical threads, 32 GB DDR3, AVX/F16C, no AVX2/FMA, and no GPU inference. Its
port 8080 is published only on `127.0.0.1`; the OpenClaw container reaches the
tunnel through `host.docker.internal`. The active experimental integration is
Qwen3 14B Q2_K with context 16,384, two generation threads, two batch threads,
mmap, reasoning off, one slot, logical batch 256, and physical batch 128.

Goals 5I–5L form one investigation rather than four independent performance
claims:

1. **Goal 5I — privacy-safe observability.** Supported OpenClaw hooks reported
   prompt-category sizes, provider lifecycle, usage, and monotonic timings
   without logging prompt, memory, history, tool-schema, or response contents.
2. **Goal 5J — queue/slot attribution.** An apparently 1,907,368 ms successful
   provider call contained 657,026.92 ms of llama.cpp work: 974 newly evaluated
   prompt tokens at 1.50 tok/s plus six generated tokens. Approximately
   1,250,327 ms was inferred queue/slot wait behind a cancelled request. The
   pinned server released that request 1,271.790 s after the first cancel log
   and 1,235.839 s after the second. A controlled 64/32 reference released in
   38.315545 s.
3. **Goal 5K — controlled batch sweep.** The same 2,100-token synthetic prompt
   measured 1.5206 tok/s at 2048/512, 1.5132 at 1024/512, 1.5216 at 512/256,
   and 1.5235 at 256/128. Corresponding cancellation times were 1,271.790 s
   (`HISTORICAL_GOAL_5J`), 651.869 s, 322.765 s, and 159.462 s. Throughput
   differences were sub-percent and treated as noise; 256/128 had no measured
   penalty, improved cancellation by 87.462%, and was the best balance. Batch
   128 was not tested because its trigger condition was not met.
4. **Goal 5L — production adoption.** Argo Forge's experimental
   `qwen3-14b-q2` entry adopted 256/128. Dry-run and live process inspection
   proved the flags reached llama-server; direct health/model checks, the
   localhost-only Argo3 listener, Atlas5 tunnel, and OpenClaw-container network
   path all passed. Only a tiny functional generation was used, not a new
   benchmark, and no cloud inference occurred.

The machine-readable Goal 5K measurements are in
[`telemetry/results/goal5k-batch-sweep.json`](../telemetry/results/goal5k-batch-sweep.json).
The detailed sections below retain historical versus fresh evidence labels and
limitations.

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

A fresh isolated Goal 5C OpenClaw session received the exact message:

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

A fresh minimal Goal 5D session received exactly the requested `OPENCLAW_OK`
prompt. OpenClaw accepted it, selected `argo-forge` and the 8B
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

A separate fresh agentic Goal 5D session received the required short
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

## Goal 5F: standalone Argo3 Qwen3 14B Q3_K_M

**Experimental — quality has NOT yet been evaluated by the human user.** Goal
5F performed infrastructure, protocol, and one tiny direct-generation smoke
test only. It did not run an agentic quality evaluation, inspect the project
with the model, exercise tools, or ask the model to analyze memory.

**Goal 5G historical update:** the later human Q3_K_M evaluation attempt is
contaminated and inconclusive because additional content was accidentally
submitted while the run was active. It is invalid for quality comparison. The
Goal 5F infrastructure measurements below remain valid and unchanged; the raw
Gateway and llama-server logs from the contaminated run were preserved during
the Goal 5G clean reset.

### Model, host, and runtime

The existing GGUF was used in place. It was not downloaded, renamed, copied,
moved, quantized, or modified:

- alias: `qwen3-14b-q3`
- model: `Qwen3 14B Q3_K_M`
- Argo3 path:
  `${HOME}/llama-cpp-models/Qwen_Qwen3-14B-Q3_K_M.gguf`
- exact file size: 7,321,313,312 bytes
- SHA-256:
  `3c49c800881cf97b77d6a6a7d3f653e35b6134e0cb6fd6f7c379b354b48af781`
- llama.cpp metadata: 14,768,307,200 parameters, `Q3_K - Medium`, 151,936
  vocabulary entries, 32,768-token trained context
- runtime: `local/argo-forge-llama-server-ivybridge:dev`
- runtime image ID:
  `sha256:d2946c22720cbe7e84814cd0a05caf02e976eb686e6fc9322118177f45f3354a`
- llama.cpp: `0.2.0-dev`, build 10566, commit
  `bb4caa7540188872173c44d161602d9271386413`
  (`b10566-bb4caa754`)

Argo3 is an Intel Core i3-3240 Ivy Bridge host with 2 physical cores, 4
logical threads, and 32 GB RAM. The pinned image remains CPU-only and was
built with `GGML_NATIVE=OFF`, AVX/F16C enabled, and AVX2/FMA/BMI2 disabled.
No GPU backend or unsupported CPU baseline was introduced.

Argo Forge remained at commit
`7ca653add7f7700f8344fd105583b3936a8ad310` on `main`. Its pre-existing dirty
state (`M models.json` and untracked `models.json.before-qwen35-9b`) was
preserved. Goal 5F appended only this model definition; all earlier 4B, 8B,
9B, 27B, 30B, and 35B definitions remain present:

```json
{
  "alias": "qwen3-14b-q3",
  "name": "Qwen3 14B Q3_K_M",
  "file": "Qwen_Qwen3-14B-Q3_K_M.gguf",
  "context": 16384,
  "runtime": "local/argo-forge-llama-server-ivybridge:dev",
  "reasoning": "off",
  "server_args": ["--parallel", "1"],
  "status": "partial",
  "note": "Experimental standalone Argo3 model for OpenClaw Goal 5F; infrastructure and minimal transport validation only, pending human quality evaluation"
}
```

`partial` is intentional: Argo Forge reserves `ready` for a completed agentic
edit-and-test workflow, which Goal 5F explicitly did not perform.

### Effective launch and isolation

The effective llama-server arguments are:

```text
--model /models/Qwen_Qwen3-14B-Q3_K_M.gguf
--host 0.0.0.0
--port 8080
--ctx-size 16384
--threads 2
--threads-batch 2
--n-gpu-layers 0
--load-mode mmap
--reasoning off
--parallel 1
```

The container's port publication is strictly `127.0.0.1:8080:8080`, so the
container-internal `--host 0.0.0.0` does not expose inference on Argo3's LAN.
The selected GGUF is the container's sole model mount and is read-only.
`/props` reported one slot and `n_ctx: 16384`; container inspection confirmed
the two thread settings, zero GPU layers, disabled reasoning, and one-request
parallelism. Gateway startup independently reported `thinking=off`.

Only Argo3 ran `llama-server`. Atlas5 ran the OpenClaw Gateway and SSH client,
with no llama.cpp or RPC inference process. The route remained:

```text
OpenClaw Gateway container on Atlas5
  -> http://host.docker.internal:18080/v1
  -> SSH local forward on Atlas5 docker0 (172.17.0.1:18080)
  -> Argo3 127.0.0.1:8080
  -> Argo Forge managed llama-server
  -> Qwen_Qwen3-14B-Q3_K_M.gguf
```

The existing tunnel helper retained batch authentication and strict SSH
host-key verification. Port 18080 listened only on Atlas5's Docker bridge and
port 8080 listened only on Argo3 localhost.

### OpenClaw selection and validation

The active OpenClaw reference is
`argo-forge//models/Qwen_Qwen3-14B-Q3_K_M.gguf`. The provider remains
`argo-forge`, uses `openai-completions`, and points only to
`http://host.docker.internal:18080/v1`. It advertises a 16,384-token context,
2,048 output tokens, and `reasoning: false`. Fallbacks are explicitly empty.
`agents.defaults.experimental.localModelLean` remains enabled.

The existing `atlas-llamacpp` provider and OpenAI model/auth configuration
remain preserved but inactive. No credential was read, printed, rotated,
deleted, or modified. Gateway logs contained only the `argo-forge` model-fetch
URL above and no paid-cloud endpoint; no cloud inference occurred.

Validation passed for `/health`, `/v1/models`, and `/props` directly on Argo3,
from Atlas5 through the tunnel, and from inside the Gateway container. The
discovered ID was exactly
`/models/Qwen_Qwen3-14B-Q3_K_M.gguf`, with `n_ctx: 16384` and Q3_K Medium
metadata. OpenClaw configuration validation passed, Gateway health/readiness
passed, and startup selected the exact 14B model.

On Gateway startup, OpenClaw automatically resumed one preserved, previously
interrupted dashboard session. This was not initiated as a Goal 5F test. Its
transport established an HTTP 200 streaming response through the local
`argo-forge` URL, proving OpenClaw-to-Argo3 transport, but the run was promptly
aborted through `sessions.abort` and the managed server was restarted so the
out-of-scope long task could not continue. No `OPENCLAW_OK` completion is
claimed. The final server was idle and healthy. `MEMORY.md`, `USER.md`, and
the daily memory files retained their pre-goal sizes and modification times,
and the structured wiki was not changed. During normal Gateway startup, the
OpenClaw runtime refreshed six existing/new dream artifacts under
`memory/.dreams`, `memory/dreaming`, and `DREAMS.md`; these persistent runtime
artifacts were preserved rather than deleted. No memory content was sent to a
cloud provider.

### Tiny direct measurement

One request asked only `Reply exactly: DIRECT_OK`, with a 16-token output cap.
This is a single smoke observation, not a benchmark-quality result.

| Measurement | Result |
| --- | ---: |
| Final model load wall time | 6.66 s |
| Loaded container memory before request | about 2.574 GiB |
| Loaded container memory during request | about 2.577 GiB |
| Prompt processing | 1.32 tok/s (17 tokens, 12.887 s) |
| Generation | 1.15 tok/s (3 tokens, 1.743 s) |
| Direct request wall time | 14.66 s |
| Docker CPU during request | about 200% (two cores) |
| Peak sampled package temperature | 50°C |
| Post-request package temperature | 39°C |
| Visible result | `DIRECT_OK`, `stop` |

The 14B model is materially slower than the earlier 8B direct observation and
uses slightly more memory, but whether its quality makes it a better practical
OpenClaw brain than the larger Q4 experiments is deliberately unanswered.
Only the human evaluation can establish that tradeoff.

### Start and stop

Start Argo3 inference, the project-owned tunnel, and the Gateway in order:

```bash
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes Argo3 \
  'cd "${HOME}/Progetti/argo-forge" && ./localcode.py --stop && ./localcode.py qwen3-14b-q3 --ctx 16384 --steps 24 --output 512 --server-only'

./deployment/argo-forge-tunnel.sh start
./deployment/argo-forge-tunnel.sh status

export OPENCLAW_GATEWAY_TOKEN='<operator-owned strong token>'
./deployment/openclaw-compose.sh up -d openclaw-gateway
unset OPENCLAW_GATEWAY_TOKEN
```

Stop in reverse order without deleting persistent state or model files:

```bash
./deployment/openclaw-compose.sh down
./deployment/argo-forge-tunnel.sh stop
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes Argo3 \
  'cd "${HOME}/Progetti/argo-forge" && ./localcode.py --stop'
```

## Goal 5G: clean Qwen3 14B Q2_K human-evaluation baseline

**Human quality evaluation has NOT yet started.** Goal 5G discarded the
contaminated Q3_K_M attempt as a comparison result, retained its session and
logs as historical evidence, and prepared a separate empty session for the
first clean Q2_K evaluation. No OpenClaw agentic test, evaluation prompt,
workspace inspection, tool call, or autonomous task was submitted.

### Clean reset and preservation

Before changing configuration, Atlas5's running OpenClaw Gateway and
project-owned SSH tunnel were stopped. Argo3's managed Q3_K_M server was
actively using approximately 199% CPU; it was stopped, and subsequent process
and listener checks found no llama.cpp/RPC process on either host and no
Argo3 port-8080 listener. No session, memory, model, or persistent database was
deleted.

Raw pre-reset evidence is retained privately at:

- Atlas5:
  `runtime/state/tmp/goal5g-reset-evidence/q3-contaminated-gateway.log`
- Argo3:
  `${HOME}/Progetti/argo-forge/logs/goal5g-pre-reset-q3-contaminated-server.log`

The contaminated dashboard session was labeled `Goal 5F Q3_K_M contaminated
- inconclusive` and archived through OpenClaw's
session lifecycle API. Its transcript was retained. A maintenance-only
Gateway start was performed while both the tunnel and inference server were
stopped, so automatic restart recovery failed locally with `ECONNREFUSED` and
could not execute any Q2_K or cloud inference.

### Model and runtime

The existing GGUF was used at its original path without downloading, copying,
renaming, moving, quantizing, or modifying it:

- alias: `qwen3-14b-q2`
- model: `Qwen3 14B Q2_K`
- exact path:
  `${HOME}/llama-cpp-models/Qwen_Qwen3-14B-Q2_K.gguf`
- exact file size: 5,753,984,032 bytes
- SHA-256:
  `4496a2dc7805120ae48c381e41bc81abee89eb7a82c5f33f72868f5d973e2cb2`
- model metadata: 14,768,307,200 parameters, 151,936 vocabulary entries,
  32,768-token trained context
- quantization reported by llama.cpp: `Q2_K - Medium`
- runtime: `local/argo-forge-llama-server-ivybridge:dev`
- runtime image ID:
  `sha256:d2946c22720cbe7e84814cd0a05caf02e976eb686e6fc9322118177f45f3354a`
- llama.cpp: `0.2.0-dev`, build 10566, commit
  `bb4caa7540188872173c44d161602d9271386413`
  (`b10566-bb4caa754`)

Argo3 remains the Intel Core i3-3240 Ivy Bridge inference host with 2 physical
cores, 4 logical threads, 32 GB RAM, AVX/F16C, no AVX2/FMA, and no GPU. The
pinned CPU-only image retains `GGML_NATIVE=OFF`, enables AVX/F16C, and disables
AVX2/FMA/BMI2. No second llama.cpp installation or unsupported instruction
requirement was introduced.

Argo Forge remained at commit
`7ca653add7f7700f8344fd105583b3936a8ad310` on `main`. Its pre-existing
`models.json` modifications and untracked `models.json.before-qwen35-9b` were
preserved. Goal 5G appended only this eighth model entry; the Q3_K_M, 4B, 8B,
9B, 27B, 30B, and 35B definitions remain intact:

```json
{
  "alias": "qwen3-14b-q2",
  "name": "Qwen3 14B Q2_K",
  "file": "Qwen_Qwen3-14B-Q2_K.gguf",
  "context": 16384,
  "runtime": "local/argo-forge-llama-server-ivybridge:dev",
  "reasoning": "off",
  "server_args": ["--parallel", "1"],
  "status": "partial",
  "note": "Experimental standalone Argo3 model for OpenClaw Goal 5G; clean infrastructure and transport validation only, pending first human quality evaluation"
}
```

### Launch, isolation, and route

The effective llama-server arguments are:

```text
--model /models/Qwen_Qwen3-14B-Q2_K.gguf
--host 0.0.0.0
--port 8080
--ctx-size 16384
--threads 2
--threads-batch 2
--n-gpu-layers 0
--load-mode mmap
--reasoning off
--parallel 1
```

Docker publishes the container port only as `127.0.0.1:8080:8080`, and the
GGUF is the sole read-only model mount. `/props` reported one slot and a
16,384-token context. Container inspection confirmed two inference threads,
two batch threads, zero GPU layers, mmap, reasoning off, and parallelism one.

The unchanged route is:

```text
OpenClaw Gateway on Atlas5
  -> http://host.docker.internal:18080/v1
  -> SSH local forward bound only to Atlas5 docker0
  -> Argo3 127.0.0.1:8080
  -> Argo Forge managed llama-server
  -> Qwen_Qwen3-14B-Q2_K.gguf
```

The tunnel continues to use batch authentication and strict SSH host-key
verification. Argo3 alone runs llama-server; Atlas5 runs no llama.cpp or RPC
inference process.

### OpenClaw and clean-session validation

The active model is
`argo-forge//models/Qwen_Qwen3-14B-Q2_K.gguf`. The `argo-forge` provider still
uses `openai-completions`, `http://host.docker.internal:18080/v1`, a 16,384
context, a 2,048-token output allowance, and `reasoning: false`. Fallbacks are
explicitly empty and `localModelLean` remains enabled. The existing
`atlas-llamacpp` provider and OpenAI configuration remain preserved but
inactive; no credential was read, printed, rotated, deleted, or modified.

Validation passed for `/health`, `/v1/models`, and `/props` on Argo3, from
Atlas5 through the tunnel, and from inside the OpenClaw container. The exact
discovered model ID was `/models/Qwen_Qwen3-14B-Q2_K.gguf`, with
`n_ctx: 16384` and `Q2_K - Medium`. OpenClaw configuration validation and
Gateway health/readiness passed. Clean final startup selected the Q2_K model
with thinking off and produced zero restart-recovery starts, zero model-fetch
requests, and zero paid-cloud endpoint matches. The server remained idle.

A fresh isolated Goal 5G human-evaluation session selects the exact Q2_K model,
thinking off, has no active run, and its chat history contains zero messages.
No message was automatically submitted.

`MEMORY.md`, `USER.md`, and the daily memory files produced the same four-file
hash manifest before and after the maintenance/final startup sequence. The 24
structured-wiki files also produced an identical manifest. Existing
memory-core, memory-wiki, structured state, and persistent runtime state were
not reconfigured or deleted.

### Tiny direct measurement

One direct request asked only `Reply exactly: DIRECT_OK` with a 16-token cap.
It returned exactly `DIRECT_OK`. This is one smoke observation, not a quality
test or benchmark-quality comparison.

| Measurement | Result |
| --- | ---: |
| Model load wall time | 6.59 s |
| Loaded container memory before request | about 2.571 GiB |
| Loaded container memory during request | about 2.575 GiB |
| Prompt processing | 1.56 tok/s (17 tokens, 10.924 s) |
| Generation | 1.33 tok/s (3 tokens, 1.500 s) |
| Direct request wall time | 12.44 s |
| Docker CPU during request | about 200% (two cores) |
| Peak sampled package temperature | 51°C |
| Post-request package temperature | 39°C |
| Visible result | `DIRECT_OK`, `stop` |

No claim that Q2_K is better or practically faster than Q3_K_M or the larger
Q4 models is made from this single short observation. Human quality evaluation
has not started.

### Start and stop

Start the exact configuration in order:

```bash
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes Argo3 \
  'cd "${HOME}/Progetti/argo-forge" && ./localcode.py --stop && ./localcode.py qwen3-14b-q2 --ctx 16384 --steps 24 --output 512 --server-only'

./deployment/argo-forge-tunnel.sh start
./deployment/argo-forge-tunnel.sh status

export OPENCLAW_GATEWAY_TOKEN='<operator-owned strong token>'
./deployment/openclaw-compose.sh up -d openclaw-gateway
unset OPENCLAW_GATEWAY_TOKEN
```

Stop in reverse order without deleting persistent data or model files:

```bash
./deployment/openclaw-compose.sh down
./deployment/argo-forge-tunnel.sh stop
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes Argo3 \
  'cd "${HOME}/Progetti/argo-forge" && ./localcode.py --stop'
```


## Goal 5H: CPU-lean OpenClaw prompt profile

**HUMAN QUALITY EVALUATION HAS NOT YET BEEN PERFORMED ON THE GOAL 5H
CONFIGURATION.** Goal 5H changes only OpenClaw prompt construction. The active
brain remains the experimental Qwen3 14B Q2_K model on Argo3; its GGUF,
quantization, context, thread counts, reasoning setting, and inference route
were not changed.

### Goal 5G baseline and prompt investigation

The real Goal 5G human request reached llama.cpp with 7,715 prompt tokens.
llama.cpp measured 5,505.685 seconds of prompt evaluation at 1.40 tok/s and
171.230 seconds for 82 generated tokens at 0.47 tok/s. That human run remains
historical evidence; no part of it was deleted or reused as the Goal 5H human
session.

The pinned OpenClaw v2026.8.1 prompt-report implementation and the stored Goal
5G run report identified 26,973 system-prompt characters: 12,437 project
context characters and 14,536 non-project characters. The original automatic
context contained all five bootstrap files. Direct tokenization of the raw
files with this exact Qwen llama.cpp tokenizer produced:

| Automatically injected file | Characters | Raw Qwen tokens |
| --- | ---: | ---: |
| `AGENTS.md` | 7,927 | 1,753 |
| `SOUL.md` | 1,510 | 363 |
| `IDENTITY.md` | 1,276 | 335 |
| `USER.md` | 871 | 184 |
| `MEMORY.md` | 287 | 60 |
| **Raw-file total** | **11,871** | **2,695** |

The project-context total is larger than the raw files because OpenClaw adds
file headings and prompt wrappers. Daily memory was not automatically injected
on this ordinary turn. The run report also showed zero runtime-context and
model-only-prompt characters, so there was no evidence of an additional eager
memory-core or memory-wiki text block. The memory-wiki compiled-digest prompt
was already disabled.

The original skills block listed 17 skills and contained 4,732 characters.
The direct tool surface had seven schemas (`read`, `edit`, `write`,
`apply_patch`, `tool_search`, `tool_describe`, and `tool_call`) totaling 2,496
schema characters, while Tool Search advertised nine additional deferred
catalog tools. Those catalog entries included memory and wiki retrieval, along
with other plugin tools that were unnecessary for the planned read-only human
inspection.

To separate contributors without running inference, controlled fresh requests
were sent to a temporary Docker-bridge-only capture endpoint. The captured
OpenAI-compatible request was rendered by Argo3's own `/apply-template`
endpoint and counted by its own `/tokenize` endpoint. The capture returned a
synthetic response and never contacted a model or cloud service. Each row below
uses the same 44-character diagnostic instruction:

| Controlled request | Exact tokens | Marginal finding |
| --- | ---: | ---: |
| Goal 5G configuration | 7,365 | clean-session comparison baseline |
| Bootstrap injection disabled | 4,536 | 2,829 tokens removed |
| Bootstrap and skills disabled | 3,295 | another 1,241 tokens removed |
| Final CPU-lean profile | **2,149** | another 1,146 tokens removed by the lean tool surface |

The controlled 7,365-token baseline is 350 tokens below the historical 7,715
request because the historical request had different user/session/runtime
material. The historical 7,715-token value remains the before figure for Goal
5H. The controlled variants establish the marginal costs without attributing
that session-specific remainder to a component that was not independently
observable.

The controlled baseline can therefore be decomposed without double-counting:

| Major contributor | Tokens | Evidence |
| --- | ---: | --- |
| Workspace bootstrap and wrappers | 2,829 | marginal removal |
| Skills catalog and wrappers | 1,241 | marginal removal after bootstrap |
| Original extra tools/Tool Search over the final surface | 1,146 | marginal removal after skills |
| Remaining OpenClaw core/runtime/safety prompt and chat template | 1,708 | final system-only tokenization |
| Remaining `read` + `session_status` schemas/tool template | 401 | final with/without-tools difference |
| Diagnostic user turn and message envelope | 40 | final system-only versus full messages |
| **Controlled total** | **7,365** | exact Qwen tokenization |
| Historical session-specific difference | 350 | 7,715 historical minus controlled total |

The 1,708-token core bucket includes OpenClaw's mandatory agent instructions,
runtime/environment guidance, safety text, and chat-template control tokens.
The pinned report does not expose safe independent boundaries within that
bucket, so Goal 5H does not claim invented per-subsection counts.

### Reversible CPU-lean configuration

The optimization uses supported v2026.8.1 configuration only; no upstream
OpenClaw source was modified:

```json
{
  "agents": {
    "defaults": {
      "contextInjection": "never",
      "skills": []
    }
  },
  "tools": {
    "profile": "minimal",
    "alsoAllow": ["read"],
    "toolSearch": false
  }
}
```

`contextInjection: "never"` stops `AGENTS.md`, `SOUL.md`, `IDENTITY.md`,
`USER.md`, and `MEMORY.md` from being copied into every initial request. It
does not remove them: the model can retrieve workspace files explicitly with
`read`. `skills: []` omits the skills catalog, and disabling Tool Search omits
its control schema and deferred catalog. Write/edit/patch tools, browser and
media tools, messaging, cron, unrelated MCP/plugin tools, and eager memory/wiki
search tools are intentionally unavailable in this experiment.

OpenClaw retains one built-in `session_status` tool in addition to `read`, so
the measured effective surface is two direct read-only/non-mutating schemas and
zero Tool Search catalog entries. The previous surface was seven direct
schemas plus nine deferred catalog entries. In the final captured request the
two tool schemas and Qwen tool-template wrapper contributed 401 tokens; the
message path without tools was 1,748 tokens, including a 1,708-token core
system/template prompt and 40 tokens for the diagnostic user message and chat
envelope.

All 36 workspace files and all 24 structured-wiki files had identical SHA-256
manifests before and after Goal 5H. `MEMORY.md`, `USER.md`, daily memory,
memory-core data, memory-wiki data, persistent runtime state, prior sessions,
and logs remain intact. CPU-lean mode defers their contents rather than
deleting them. Direct memory/wiki search tools are deliberately not advertised;
known memory files can still be read on demand, and the normal retrieval tool
surface returns with the rollback below.

The exact Goal 5G configuration is preserved privately with mode `0600` at
`runtime/state/tmp/goal5h-rollback/goal5g-openclaw.json`. Its preserved SHA-256
is `cb553895f6fa29269a7dd0f42dd5ccb59c3ff67085d2a9600c7745904ba69d29`.
Restore it without displaying its credential-bearing contents:

```bash
install -m 600 \
  runtime/state/tmp/goal5h-rollback/goal5g-openclaw.json \
  runtime/state/openclaw.json
./deployment/openclaw-compose.sh restart openclaw-gateway
```

### Result and final state

The optimized initial request is exactly **2,149 tokens**, a reduction of
5,566 tokens or **72.1%** from the real 7,715-token Goal 5G request. At the
previously measured 1.40 prompt tok/s, the old request estimates to 5,511
seconds (91.8 minutes), while the optimized request estimates to 1,535 seconds
(25.6 minutes), saving approximately 3,976 seconds (66.3 minutes). These are
rate-based estimates, not new measured wall-clock results; Goal 5H intentionally
did not run a long llama.cpp prefill or an OpenClaw quality test.

The active model remains
`argo-forge//models/Qwen_Qwen3-14B-Q2_K.gguf`, fallbacks remain empty,
`localModelLean` remains enabled, and inactive OpenAI and `atlas-llamacpp`
configuration remains preserved. The effective model launch is unchanged:
16,384 context, two inference threads, two batch threads, zero GPU layers,
mmap, reasoning off, and parallelism one. Atlas5 has no llama.cpp/RPC process.
Argo3 alone runs llama-server, still published only on
`127.0.0.1:8080:8080`, through the unchanged strict-host-key SSH route:

```text
OpenClaw Gateway on Atlas5
  -> http://host.docker.internal:18080/v1
  -> SSH local forward bound only to Atlas5 docker0
  -> Argo3 127.0.0.1:8080
  -> Qwen_Qwen3-14B-Q2_K.gguf
```

Final health and model discovery passed from Atlas5 and from inside the Gateway
container. Argo3 was idle at 0.01% CPU and approximately 2.76 GiB container
memory after validation. No paid-cloud endpoint was contacted, no cloud
inference was attempted, and no API credential was read or changed.

A fresh, zero-message Goal 5H human-evaluation session selects the Q2_K provider model
with thinking off. The five synthetic capture/diagnostic sessions were archived
without deletion so they cannot be mistaken for the human run. No evaluation
prompt was submitted. The stack is idle and ready for CPU-lean human
evaluation.

## Goal 5I: observable prompt telemetry

Goal 5I adds an optional, metadata-only diagnostic stream around the pinned
OpenClaw v2026.8.1 prompt and provider lifecycle. It uses supported
`before_model_resolve`, `before_prompt_build`, `llm_input`, `model_call_started`,
`model_call_ended`, and `llm_output` plugin hooks; upstream OpenClaw source was
not modified. The read-only project plugin observes final system sections,
ordered project-context files, history, current input, tool groups, provider
send/completion timing, and provider-reported usage without logging their
contents.

Token counts from prompt assembly are deliberately labeled estimates using
`ceil(UTF-8 bytes / 4)`. They remain distinct from llama.cpp's authoritative
prompt-evaluation and generation token/timing lines. The combined viewer
correlates the two streams by ISO-millisecond timestamps and llama.cpp
slot/task numbers; exact cross-process request-ID correlation is unavailable
in the current OpenAI-compatible transport and is not claimed.

Enable, view, and disable the reversible mode with:

```bash
./deployment/prompt-telemetry.sh test
./deployment/prompt-telemetry.sh enable
./deployment/prompt-telemetry.sh watch
./deployment/prompt-telemetry.sh disable
```

Enabling does not start the Gateway or inference. The next normal Gateway
start still requires the operator-owned token. Disabled mode does not mount or
load the plugin, and the helper restores the exact pre-enable plugin entry and
allow-list. No model, provider, memory, workspace, session, historical log,
network, or SSH configuration is changed.

Offline validation proved that disabled mode registers no hooks or output,
synthetic prompt/memory/history/tool/assistant secrets never appear in the
stream, timestamps and counters are present, the plugin loads in the exact
pinned image, the Compose merge is valid, and an isolated enable/disable cycle
restores its test configuration byte-for-byte. No live OpenClaw request or
cloud inference was performed. OpenClaw, the tunnel, and Argo3 inference were
left stopped.

The full architecture, category rules, exact-versus-estimated accounting,
timestamp/correlation behavior, privacy guarantees, limitations, operator
commands, and rollback procedure are documented in
[Prompt telemetry for local CPU experiments](prompt-telemetry.md).

## Goal 5J: queue-aware CPU telemetry

The apparently 31-minute 47.368-second OpenClaw call was not a 31-minute
successful inference. Measured llama.cpp processing for the successful task
was 657,026.92 ms (10 minutes 57.027 seconds): 974 newly evaluated prompt
tokens in 651,191.95 ms at 1.50 tok/s, followed by six reported output tokens
in 5,834.97 ms at 0.86 tok/s. OpenClaw's 1,250,327 ms first-response interval
matches the remaining approximately 20 minutes 50 seconds and is inferred to
be single-slot wait plus small provider/tunnel overhead.

The prior task's first `cancel task` event to `slot release` measured
1,271,790 ms (21 minutes 11.790 seconds); a second cancellation event to
release measured 1,235,839 ms. Source inspection of pinned llama.cpp build
10566 (`bb4caa7540188872173c44d161602d9271386413`) shows that the HTTP reader
queues a high-priority cancel, but `process_single_task(..., is_yielding)`
declines cancellation while synchronous `llama_decode` is active. Release is
processed only after the logical decode call returns. Production uses the
pinned defaults `n_batch=2048` and `n_ubatch=512`, and the cancelled task's
2048-token release is consistent with that interruptibility boundary. This is
best classified as expected behavior/a responsiveness limitation in the
pinned design, not proof of a stuck child task. Current official source still
has the same boundary; nothing was upgraded or patched.

A small local-only reproduction used the same Q2_K model in a temporary
Argo3-loopback container with an isolated 64-token logical batch. Cancellation
to release measured 38,315.545 ms, the waiting request launched 5.858 ms after
release, and the cancelled clean slot contained exactly 64 tokens. The latter
is an inference about work completed after cancellation from the empty-slot
setup and release count. Production configuration was untouched and the
temporary container was removed.

The successful call's 1,415 cache-read tokens plus 974 new input tokens equal
a 2,389-token effective prompt. llama.cpp—not OpenClaw—retains the common
prompt prefix in the slot/KV cache and evaluates only the suffix. Normal
non-child release, including cancellation after an active batch completes,
retains that decoded prefix while the server and compatible slot remain.

Goal 5J adds monotonic `PROMPT_BUILD_MS`, `PROVIDER_CALL_MS`, and
`REQUEST_TOTAL_MS`, separates inferred provider/slot wait from native prompt
and generation timing, reconstructs the first-response occurrence instead of
timestamping it at terminal-hook delivery, and calculates exact
cancel-to-release intervals from llama.cpp process timestamps. It fixes Goal
5I's 1–2 ms request total by retaining run state across the observed
`agent_end`-before-`llm_output` ordering. The combined viewer now follows the
live remote Docker stderr stream rather than Argo Forge's manager log:

```bash
./deployment/prompt-telemetry.sh test
./deployment/prompt-telemetry.sh watch
```

The watcher remains read-only, uses the existing strict-host-key SSH alias,
and emits only fixed lifecycle labels and numeric metadata. It neither opens
Argo3 port 8080 nor starts a service. OpenClaw cancellation request time and an
exact cross-process request-ID join remain unavailable through supported
hooks, so those boundaries are explicitly `NOT_OBSERVABLE` or
`INFERRED_FROM_TIMESTAMPS`. Full source paths, measurements, state names,
cache rules, security properties, enable/disable commands, and limitations are
in [Goal 5J telemetry details](prompt-telemetry.md#goal-5j-queue-cancellation-and-slot-timing).

## Goal 5K: Argo3 llama.cpp batch-size sweep

Goal 5K isolated llama.cpp batch behavior; it did not involve OpenClaw prompt
composition or an agent run. Measurements were made on Argo3's Intel Core
i3-3240 (Ivy Bridge, 2 physical cores / 4 logical threads, 32 GB DDR3,
AVX/F16C, no AVX2/FMA) with CPU-only inference. The model remained
`Qwen_Qwen3-14B-Q2_K.gguf` (SHA-256
`4496a2dc7805120ae48c381e41bc81abee89eb7a82c5f33f72868f5d973e2cb2`)
and the runtime remained llama.cpp build 10566 at
`bb4caa7540188872173c44d161602d9271386413`.

### Pinned implementation behavior

The exact pinned source, not current upstream, establishes the terminology and
release boundary:

- `n_batch` is the logical maximum batch accepted by one `llama_decode` call.
  The server fills a prompt chunk up to that value and submits it as a
  synchronous decode. For causal attention, context creation caps it at
  `n_ctx`; here the context is 16,384.
- `n_ubatch` is the physical maximum microbatch used inside that logical
  decode. Context creation caps it at `n_batch`; values of 512, 256, and 128
  used here are supported. It changes physical graph/work-buffer geometry but
  is not a server cancellation boundary.
- `threads-batch=2` is selected for prompt and multi-token batch processing;
  `threads=2` is selected for single-token generation. `parallel=1` provides
  one slot.
- `server_queue::yield_to_queue()` permits the worker to inspect queued tasks
  during compute, but pinned `process_single_task(..., is_yielding)` declines
  everything except metrics and slot inspection. A queued cancel is therefore
  serviced only after the synchronous logical `llama_decode` returns. Internal
  `n_ubatch` completion does not release the slot.

This matches each fresh cancellation: the clean slot released with exactly
256, 512, or 1,024 processed tokens, respectively. Cancel time per processed
token was 622.900, 630.401, and 636.590 ms; the reused 2,048 result was
620.991 ms/token. The near-linear relationship is strong evidence that logical
batch size controls practical cancellation latency on this host.

### Method

A temporary container using the production image mounted the same GGUF
read-only and published only `127.0.0.1:18081`. Every throughput request used
the native llama.cpp `/completion` endpoint with the same deterministic,
non-private synthetic text, exactly 2,100 tokens according to `/tokenize` and
the response timing object, `ctx=16384`, two generation threads, two batch
threads, no GPU layers, mmap, reasoning off, one slot, temperature zero, fixed
seed, prompt caching disabled, and an eight-token output allowance. Prompt
text is not stored in telemetry.

Each cancellation test restarted the server to ensure an empty slot, began the
same 2,100-token request, disconnected two seconds after request start (away
from a batch boundary), and immediately started a small waiting request. Times
below use llama.cpp's process-relative cancel, release, and launch log events,
not client or SSH timing. Each configuration has one long throughput run, so
sub-percent throughput differences are noise-level rather than evidence of a
durable ranking.

The selected primary pairs keep `n_ubatch <= n_batch` and halve physical size
with the smaller logical candidates: 2,048/512, 1,024/512, 512/256, and
256/128. A second physical-batch variant was not run: 256/128 had already
removed the cancellation problem without a measured throughput penalty, so no
specific ambiguity justified another approximately 23-minute prefill.

### Results

| Source | n_batch | n_ubatch | prompt tokens | prompt ms | prompt tok/s | vs 2048 | generated | generation tok/s | request wall | cancel-to-release | improvement vs 2048 | release to waiting launch | container RAM peak | RSS peak | package °C idle/peak/post |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `GOAL_5K_MEASUREMENT` + historical cancel | 2048 | 512 | 2100 | 1,381,054.268 | 1.5206 | baseline | 8 | 0.8946 | 1,388.895 s | 1,271.790 s | baseline | not recorded | 2.720 GiB | 8.071 GiB | 45/58/41 |
| `GOAL_5K_MEASUREMENT` | 1024 | 512 | 2100 | 1,387,768.581 | 1.5132 | -0.484% | 8 | 0.8856 | 1,395.688 s | 651.869 s | 48.744% | 87.104 ms | 2.720 GiB | 8.071 GiB | 46/58/40 |
| `GOAL_5K_MEASUREMENT` | 512 | 256 | 2100 | 1,380,117.752 | 1.5216 | +0.068% | 8 | 0.8864 | 1,388.028 s | 322.765 s | 74.621% | 45.261 ms | 2.646 GiB | 7.998 GiB | 37/58/41 |
| `GOAL_5K_MEASUREMENT` | 256 | 128 | 2100 | 1,378,445.832 | 1.5235 | +0.189% | 8 | 0.8861 | 1,386.357 s | 159.462 s | 87.462% | 22.904 ms | 2.607 GiB | 7.959 GiB | 43/58/41 |

The 2,048 cancellation cell reuses the first exact Goal 5J value and is marked
`HISTORICAL_GOAL_5J`; its second exact cancel-to-release observation remains
1,235.839 s. Goal 5J's separate 64/32, `ctx=512` reference also remains
unchanged: 38.315545 s cancel-to-release, 64 tokens at release, and 5.858 ms
release-to-waiting-launch. It is useful scaling evidence but is not a directly
comparable Goal 5K throughput candidate.

Docker container accounting is the practical RAM comparison. Process RSS is
higher because mmap-resident/shared model pages are counted there. CPU usage
averaged approximately 200% for every throughput run and sampled peaks were
201.4–201.6%. All four completions returned eight well-formed tokens with a
normal `limit` stop, no truncation, zero matched llama error lines, and no
container crash or OOM. Package temperature peaked at 58°C in every throughput
run, comfortably below the reported 85°C high threshold, and returned to
40–41°C after each 30-second post-test interval. Differing idle temperatures
reflect run order and cooldown history.

Unprivileged `dmesg` access was unavailable; the kernel journal contained no
error-priority entries during the benchmark window. This and the single run
per pair are the principal stability limitations.

### Decision

- **BEST THROUGHPUT:** 256/128 measured 1.5235 tok/s. Its +0.189% result versus
  2,048 is too small to claim a true speed advantage, but it proves there was
  no measurable throughput sacrifice in this sweep.
- **BEST RESPONSIVENESS:** 256/128 among the Goal 5K candidates, at 159.462 s.
  It is 87.462% faster to release than the first historical 2,048 cancellation.
- **BEST BALANCE:** 256/128. It combines the shortest primary-candidate cancel,
  tied throughput, the lowest container-memory peak, and identical thermal
  stability.

The recommendation for a later, separately approved OpenClaw deployment is
`n_batch=256`, `n_ubatch=128`. Batch 128 was not tested because its trigger was
not met: 256 already reduced cancellation to a practical 2 minutes 39.462
seconds and did so without losing throughput. Production settings were not
changed. No cloud inference occurred. The Gateway, SSH tunnel, normal Argo
Forge server, and all temporary test containers were stopped after collection.

Machine-readable numeric evidence is in
[`telemetry/results/goal5k-batch-sweep.json`](../telemetry/results/goal5k-batch-sweep.json).

## Goal 5L: adopt the validated production batch size

Goal 5L applied the Goal 5K recommendation to the normal OpenClaw AMS → Argo
Forge model route. This section distinguishes the earlier performance evidence
from the production adoption:

- **MEASURED IN GOAL 5K:** 256/128 produced 1.5235 prompt tokens/s and a
  159.462-second cancel-to-release interval, an 87.462% improvement over the
  first historical 2,048/512 cancellation, with no measured throughput loss.
- **APPLIED IN GOAL 5L:** Argo Forge's `qwen3-14b-q2` registry `server_args`
  now append `--batch-size 256 --ubatch-size 128` to the managed llama-server
  command. No Goal 5J or Goal 5K measurement was altered.

### Configuration authority and effective command

The Ivy Bridge runtime's general llama.cpp defaults had supplied 2,048/512
when no override existed. OpenClaw AMS supplies the endpoint and model ID but
does not add server batch flags. Argo Forge's `localcode.py` constructs the
common CPU-only command and appends the selected model's `server_args`
verbatim. Goal 5K's benchmark harness supplied separate flags only to its
temporary loopback container. The authoritative persistent setting is
therefore the `qwen3-14b-q2` entry in Argo Forge `models.json`.

Both the post-change `localcode.py --dry-run` output and the live managed
container process showed this effective tail:

```text
--ctx-size 16384 --threads 2 --threads-batch 2 --n-gpu-layers 0
--load-mode mmap --reasoning off --parallel 1
--batch-size 256 --ubatch-size 128
```

The image remained `local/argo-forge-llama-server-ivybridge:dev`, pinned to
llama.cpp build 10566 / `bb4caa7540188872173c44d161602d9271386413`, and the
read-only model remained `Qwen_Qwen3-14B-Q2_K.gguf`. Docker published container
port 8080 only as Argo3 `127.0.0.1:8080`; `ss` confirmed no LAN listener.

### Short validation

The normal managed server reached `/health` with `{"status":"ok"}`.
`/v1/models` identified the Q2_K GGUF, Q2_K quantization, 14,768,307,200
parameters, and a 16,384 runtime context. A deliberately tiny direct native
completion used eight prompt tokens and an eight-token output allowance. It
returned a well-formed, non-truncated response with a normal `limit` stop in
10.281 seconds. This is a functionality check, not a throughput benchmark;
Goal 5K remains the performance authority.

At idle after the request, Docker accounted for approximately 2.574 GiB and
the llama-server process RSS was 8,310,352 KiB, consistent with mmap counting
model pages in process RSS. Package temperature moved from a 37°C pre-start
idle observation to 41°C immediately after the short request and later
returned to 37°C. Logs contained no llama.cpp error, failure, exception, fatal,
or OOM line; the container remained running and the kernel journal had no
error-priority entry during validation.

The project tunnel then bound only Atlas5's Docker bridge
`172.17.0.1:18080` and forwarded to Argo3 loopback. `/health` and `/v1/models`
both succeeded through the tunnel. A disposable container using the pinned
OpenClaw image also received HTTP 200 from
`http://host.docker.internal:18080/health` and `/v1/models`, proving the same
container-side network route the Gateway uses. Starting the Gateway or sending
an OpenClaw model request was unnecessary; no agent, tool, or memory request
was made.

After validation, the disposable probe, Gateway, tunnel, and managed Argo
Forge server were stopped, with no inference process or test listener left.
The new 256/128 registry configuration remains on disk. No cloud inference,
SSH trust change, publication, commit, or push occurred.
