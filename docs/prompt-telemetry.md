# Prompt telemetry for local CPU experiments

Goal 5I adds an opt-in, metadata-only view of how OpenClaw v2026.8.1 builds a
model request and how that request progresses through the local llama.cpp
server. It is measurement infrastructure, not a prompt optimization. It does
not change the selected model, prompt policy, memory state, provider route, or
network boundary.

This instrumentation is project-owned, but the hooks and provider lifecycle it
observes are native OpenClaw v2026.8.1 interfaces. Goal 5I established the
metadata boundary; Goal 5J used it with llama.cpp lifecycle logs to separate
provider wall time from backend processing and queue/slot wait. Goal 5K then
measured batch behavior directly, and Goal 5L adopted the selected setting.
See the concise narrative and full measurements in
[Local model integration](local-model-integration.md#current-reference-architecture-and-findings).

## Instrumentation architecture

Inspection of the pinned source found this real embedded-agent path:

1. `src/agents/embedded-agent-runner/run/attempt.ts` prepares skills, direct
   and deferred tools, bootstrap files, and the system prompt.
2. `attempt-system-prompt-prepare.ts` adds runtime/provider context, Tool Search
   metadata, memory prompt contributions, watched-session/project memory, and
   calls `buildEmbeddedSystemPrompt`.
3. `src/agents/system-prompt.ts` renders OpenClaw's stable/dynamic system
   sections and the ordered `Project Context` file blocks.
4. `run/setup.ts` publishes `before_model_resolve` before the attempt builds
   tools/bootstrap/system context. `attempt-prompt-phase.ts` later runs
   `before_prompt_build`, applies runtime and
   hook additions, observes the assembled input, then submits the prompt.
5. `attempt-prompt-support.ts` publishes the supported `llm_input` hook with
   the final system prompt, history, current prompt, and tool schemas.
6. `attempt-stream.ts` publishes `model_call_started` and
   `model_call_ended`; `attempt-result.ts` publishes `llm_output` with
   provider-reported usage.
7. OpenClaw's `@openclaw/ai` OpenAI-completions transport renders the provider
   messages and sends the streaming request to the configured `argo-forge`
   base URL.

The project plugin at
`telemetry/openclaw-ams-prompt-telemetry/` uses only those supported hooks. A
small Compose override mounts it read-only into the normal OpenClaw extension
directory. The override is included only while the project telemetry marker
is enabled, so ordinary Compose behavior is unchanged when telemetry is off.
No upstream OpenClaw file is patched.

The hook's conversation access is powerful even though this plugin emits only
metadata. `prompt-telemetry.sh enable` therefore records and then explicitly
sets OpenClaw's required `hooks.allowConversationAccess` consent. The rollback
snapshot contains only the prior entry for this project plugin and the prior
plugin allow-list; it never copies the rest of `openclaw.json`.

## Terminal format and categories

Every Gateway line begins with `[PROMPT-TELEMETRY]`, contains an ISO-8601 UTC
timestamp with milliseconds, and carries the OpenClaw `runId` as `request`.
Provider lifecycle lines also carry the per-call `callId`. Representative
metadata-only output is:

```text
[PROMPT-TELEMETRY] [2026-09-03T12:41:02.114Z] REQUEST_CREATED request=...
[PROMPT-TELEMETRY] [2026-09-03T12:41:02.114Z] PROMPT_BUILD_START request=...
[PROMPT-TELEMETRY] [2026-09-03T12:41:02.119Z] ADD category=AGENTS.md chars=... bytes=... ESTIMATED_TOKENS=... method=utf8_bytes_div_4 order=...
[PROMPT-TELEMETRY] [2026-09-03T12:41:02.150Z] PROMPT_BUILD_COMPLETE chars=... bytes=... ASSEMBLY_ESTIMATED_TOKENS=... PROMPT_BUILD_MS=...
[PROMPT-TELEMETRY] [2026-09-03T12:41:02.160Z] PROVIDER_SEND request=... call=... provider=argo-forge model=/models/Qwen_Qwen3-14B-Q2_K.gguf
[PROMPT-TELEMETRY] [2026-09-03T13:28:16.701Z] PROVIDER_USAGE request=... PROVIDER_REPORTED_INPUT_TOKENS=... PROVIDER_REPORTED_OUTPUT_TOKENS=... accounting=provider-reported
```

The decomposition follows the rendered provider input rather than imposing a
different prompt design. It can report, when present:

- OpenClaw core/system sections;
- agent identity metadata and the individual `AGENTS.md`, `SOUL.md`,
  `IDENTITY.md`, `USER.md`, `MEMORY.md`, and `BOOTSTRAP.md` project-context
  blocks;
- daily-memory and other workspace/bootstrap blocks;
- memory guidance/supplements, memory-core and memory-wiki tool definitions,
  and source-identifiable retrieved blocks;
- conversation/session history and the current user message;
- automatic context wrapped around the current message when the original
  message remains an exact substring; otherwise the safe
  `current-turn-final-unattributed` category;
- direct tool definitions, Tool Search controls, and plugin/MCP definitions;
- skills metadata and environment/runtime metadata;
- other automatically injected system sections under the conservative
  `openclaw-core-system` category.

The lines are emitted in provider-input order and contain an `order` number.
Known absent categories are emitted as `CATEGORY absent`. The public hook does
not preserve source provenance for arbitrary text returned by a memory prompt
supplement, so memory-core or memory-wiki retrieval that cannot be proved from
a named project-context block is reported as `CATEGORY unknown ...
reason=hook_has_no_source_provenance`, never falsely as absent or attributed.
Likewise, OpenClaw can combine several hard-coded instructions into one
section; telemetry retains that real combined boundary. Project Context does
not carry machine-readable file delimiters, so the plugin recognizes only the
canonical fixed file headings and source-identifiable memory paths. A literal
canonical `## filename` heading inside file content is an unavoidable rendered
format ambiguity and is documented rather than treated as exact provenance.

`before_model_resolve` is the earliest supported request hook and supplies the
`REQUEST_CREATED` and `PROMPT_BUILD_START` time before tools/bootstrap/system preparation.
`before_prompt_build` marks the later final per-turn assembly boundary, but
v2026.8.1 has no supported plugin hook around every internal append operation. The `ADD`
timestamps are therefore observation times at the final input boundary, and
`order` represents real provider-input order—not fabricated historical append
times. `build_ms` covers the supported final-assembly interval.

## Token accounting

The plugin reports Unicode character count, UTF-8 byte count, and
`ESTIMATED_TOKENS = ceil(UTF-8 bytes / 4)` for each text or JSON hook
representation. The assembled estimate applies that method once to the sum of
the measured component bytes. It is deliberately named
`ASSEMBLY_ESTIMATED_TOKENS`; it excludes provider chat-template/control tokens
and is not presented as exact Qwen tokenization.

History and tool schemas are measured as their in-memory hook JSON
representation. The OpenAI transport can normalize messages after the hook,
so those rows are marked `representation=hook-json`. Exact per-component Qwen
tokenization is not available through a supported OpenClaw v2026.8.1 hook,
and calling the stopped inference server's `/tokenize` endpoint for every
private component would add transport and privacy risk. This diagnostic mode
therefore prefers an explicit estimate.

When the OpenAI-compatible response provides usage, telemetry reports it
separately as `PROVIDER_REPORTED_INPUT_TOKENS` and
`PROVIDER_REPORTED_OUTPUT_TOKENS`. llama.cpp remains authoritative for
`ACTUAL_PROMPT_EVAL_TOKENS`, prompt time/speed, generated-token time/speed, and
total request timing; those values come from its existing `slot print_timing`
and `slot release` lines rather than being recomputed by the plugin.

## Enable, view, and disable

Enabling changes only the project plugin entry/allow-list and creates ignored,
mode-0600 marker and rollback files under `runtime/state`. It does not start a
service:

```bash
./deployment/prompt-telemetry.sh test
./deployment/prompt-telemetry.sh enable
./deployment/prompt-telemetry.sh status
```

With the operator-owned Gateway token available, start through the normal
wrapper. Do not put the token in this repository or reveal it to Codex:

```bash
export OPENCLAW_GATEWAY_TOKEN='<operator-owned strong token>'
./deployment/openclaw-compose.sh up -d openclaw-gateway
unset OPENCLAW_GATEWAY_TOKEN
```

Gateway-only output is available through the standard Compose logs:

```bash
./deployment/openclaw-compose.sh logs -f openclaw-gateway \
  | grep --line-buffered -F '[PROMPT-TELEMETRY]'
```

Start the combined viewer before submitting a request. It follows only the
plugin prefix plus selected lifecycle/timing records from the live
`localcode-llama-server` Docker log. It normalizes slot selection, task launch,
defer, cancellation, prompt progress, final prompt/generation timing, and slot
release. Each normalized line has an Atlas5 ISO reception timestamp and, when
Docker supplies it, `source_wall_at` from Argo3. Unrecognized server text is
dropped rather than risking prompt-content output:

```bash
./deployment/prompt-telemetry.sh watch
```

The viewer uses the existing strict-host-key, batch-mode SSH connection to
`Argo3` and runs `docker logs --tail 0 --follow --timestamps
localcode-llama-server`. Argo Forge's `logs/localcode.log` is only manager
launch history and is not a llama-server stderr stream. The viewer does not
start OpenClaw, the tunnel, or llama.cpp and does not change any listener.

Disable telemetry and restore the exact prior plugin entry and allow-list:

```bash
./deployment/prompt-telemetry.sh disable
```

If a Gateway is running, recreate or restart it after disabling. Merely
stopping the viewer does not disable telemetry.

## Correlation and timing limitations

OpenClaw's `request`/`call` IDs correlate assembly, provider send, first stream
byte, provider completion, usage, and total Gateway wall time. The existing
OpenAI-compatible transport does not expose an identifier that this llama.cpp
build records in its slot log. Exact cross-process ID correlation is therefore
not claimed. Use the Gateway send timestamp, the combined viewer's timestamp,
and llama.cpp's slot/task number for manual correlation. With parallelism one,
the expected chronological boundary is `PROVIDER send` followed by
`launch_slot_` for the sole slot.

OpenClaw publishes `timeToFirstByteMs` only with the terminal
`model_call_ended` hook. Telemetry reconstructs its wall occurrence from the
provider-send wall time and emits it retrospectively as `FIRST_RESPONSE_BYTE`.
For this pinned llama-server streaming path the server sends HTTP 200 headers
as prompt processing starts, so the same measurement is an inferred
provider-to-slot boundary and includes small provider/tunnel overhead. It is
not a generated-token boundary; `first_generated_token=NOT_OBSERVABLE` remains
explicit. The native server log supplies exact slot and final timing evidence.

The helper tails new llama.cpp lines (`tail -n 0`); it intentionally does not
replay historical logs. If the viewer starts late, inspect the preserved Argo
Forge log directly with a narrow timing filter.

## Goal 5J: queue, cancellation, and slot timing

### What the 31-minute request actually contained

The observed successful OpenClaw provider call measured **1,907,368 ms**
(31 minutes 47.368 seconds), but llama.cpp measured only **657,026.92 ms**
(10 minutes 57.027 seconds) for its task. OpenClaw's first-response-byte value
was **1,250,327 ms** (20 minutes 50.327 seconds), within 14 ms of the difference
between those totals. With one slot, and with task 4 launching immediately
after cancelled task 0 released, this is strong timestamp evidence that the
first-response interval was queue/slot wait plus negligible transport—not
prompt evaluation or token generation. This attribution is
`INFERRED_FROM_TIMESTAMPS`, not an exact cross-process ID match.

The earlier task 0 cancellation was logged at process-relative 2:29.668 and
again at 3:05.619; release occurred at 23:41.458 with `n_tokens = 2048`.
Measured from the first cancellation, cleanup was **1,271,790 ms** (21 minutes
11.790 seconds); from the second it was **1,235,839 ms**. These are exact
differences between llama.cpp's monotonic process-relative log timestamps.

### Cancellation lifecycle and source evidence

The pinned runtime is llama.cpp build 10566, commit
`bb4caa7540188872173c44d161602d9271386413`. Its behavior is:

1. Pinned
   [`tools/server/server-queue.cpp`](https://github.com/ggml-org/llama.cpp/blob/bb4caa7540188872173c44d161602d9271386413/tools/server/server-queue.cpp),
   `server_response_reader::stop()`, logs
   `cancel task`, removes response waiters, constructs a
   `SERVER_TASK_TYPE_CANCEL`, and posts it at the front of `server_queue`.
   The log proves receipt/disconnect and cancellation enqueue, not release.
2. `server_queue::yield_to_queue()` lets a worker examine tasks while model
   compute stays synchronously on the main thread.
3. Pinned
   [`tools/server/server-context.cpp`](https://github.com/ggml-org/llama.cpp/blob/bb4caa7540188872173c44d161602d9271386413/tools/server/server-context.cpp),
   `server_context::process_single_task(..., is_yielding)`, declines every task
   during decode except `METRICS` and `SLOT_GET`. A queued `CANCEL` is therefore
   retried only after the active `decode()` call returns.
4. `server_context::decode()` wraps the synchronous
   `llama_decode(ctx_tgt, batch_view)` and synchronization in that yield.
5. The `SERVER_TASK_TYPE_CANCEL` case finally calls `server_slot::release()`,
   which logs `stop processing`, marks the slot idle, and preserves a normal
   non-child slot's prompt cache.

The best-supported conclusion is an expected cancellation-granularity
limitation in this build, not evidence of a lost child task or OpenAI streaming
bug. OpenClaw aborting the stream causes the HTTP reader to enqueue the cancel,
but it cannot interrupt an in-flight logical CPU decode. A source comparison
against [official master commit
`42f0225fea945b24e92a0ce716e59b7c13e9b819`](https://github.com/ggml-org/llama.cpp/blob/42f0225fea945b24e92a0ce716e59b7c13e9b819/tools/server/server-context.cpp)
still contains the same `is_yielding` restriction, so Goal 5J found no source
evidence that current upstream has made cancellation interrupt an in-flight
decode. No upgrade or upstream patch was made.

### Batch granularity and controlled Q2_K test

The production launch does not override the batch flags. The pinned defaults,
also confirmed by the built image's help output, are logical
`n_batch = 2048` and physical `n_ubatch = 512`. llama.cpp internally splits
physical work into microbatches, but the server checks the queued cancel only
after the whole logical `llama_decode` call returns. The historical release at
exactly 2048 tokens is consistent with one 2048-token logical prefill batch
finishing after cancellation.

A bounded, local-only test used the same `Qwen_Qwen3-14B-Q2_K.gguf` in a
temporary container bound only to Argo3 `127.0.0.1:18081`, with isolated
`ctx=512`, `batch=64`, `ubatch=32`, and one slot. It did not alter production
configuration. The client disconnected two seconds after task launch:

- llama cancellation log: 20.693650 s;
- slot release: 59.009195 s;
- measured cancel-to-release: **38,315.545 ms**;
- release-to-waiting-task launch: **5.858 ms**;
- second client wall time: **39,720.051 ms**;
- cancelled slot at release: **64 tokens**.

The second request therefore waited for the first logical batch to complete.
Because this isolated test began with an empty slot and released with exactly
the configured batch size, 64 tokens processed after cancellation is a
well-supported inference, not a direct counter. The temporary container was
then stopped and removed. Reducing `n_batch` would improve cancellation
responsiveness but may reduce prompt throughput; that tradeoff belongs in a
later controlled experiment, not the Goal 5J production baseline.

### Cache behavior

For successful task 4, provider usage reported 974 input tokens and 1,415 cache
read tokens. llama.cpp's effective prompt was therefore 2,389 tokens, while
only the 974-token suffix required new evaluation. This is llama.cpp slot/KV
cache behavior: `server_task` defaults `cache_prompt=true`, and
`server-context.cpp` obtains the common prefix with
`slot.prompt.tokens.get_common_prefix(input_tokens)`, assigns it to
`stats.n_prompt_cached`, and evaluates the remainder. OpenClaw supplies the
similar request and relays usage; it does not own the cache.

A normal non-child slot retains its prompt across release, including release
after cancellation once the active batch has actually completed. Cache remains
available while that llama-server process and compatible slot context survive.
It is reduced or invalidated by a divergent prefix, explicit
`cache_prompt=false`, context shift/truncation, incompatible model/adapter
state, or server restart. Cancellation does not cache unfinished computation,
but the batch that finishes before cancellation is serviced can remain cached.

The successful slot released at about 2,394 context tokens. The 2,389 prompt
tokens plus five stored generation steps explain that value: llama.cpp reports
six generated tokens while its generation-step accounting excludes the first
token obtained from final prompt logits. This is source-supported accounting,
not an extra five-token prompt contribution.

### New states and timing semantics

The combined stream can now emit:

- OpenClaw: `REQUEST_CREATED`, `PROMPT_BUILD_START`,
  `PROMPT_BUILD_COMPLETE`, `PROVIDER_SEND`, `QUEUE_WAIT_START`, retrospective
  `QUEUE_WAIT_COMPLETE`, inferred `LLAMA_SLOT_ACQUIRED`,
  `FIRST_RESPONSE_BYTE`, `PROVIDER_COMPLETE`, `PROVIDER_USAGE`,
  `REQUEST_COMPLETE`, and `REQUEST_SUMMARY`;
- llama.cpp: `SLOT_SELECTED`, exact `LLAMA_SLOT_ACQUIRED`, inferred
  `PROMPT_EVAL_START`, `PROMPT_EVAL_PROGRESS`, `PROMPT_EVAL_COMPLETE`, inferred
  `GENERATION_START`, `GENERATION_COMPLETE`, `CANCEL_ACKNOWLEDGED`,
  `CANCEL_WAITING_FOR_SLOT_RELEASE`, `SLOT_RELEASED`, and
  `LLAMA_TASK_SUMMARY`.

`PROMPT_BUILD_MS`, `PROVIDER_CALL_MS`, and `REQUEST_TOTAL_MS` use Node's
monotonic `process.hrtime.bigint()` clock. ISO timestamps remain wall-clock
values for human correlation; the two clock origins are never subtracted.
Goal 5I's incorrect 1–2 ms request total came from deleting run state at
`agent_end` before the later `llm_output` hook. State is now retained until
both observations arrive (or a six-hour metadata-only expiry), so usage and
the request summary retain the original monotonic start. Goal 5I's apparently
late first-byte line is also corrected with `occurred_at` and
`emitted=retrospective`.

Exact server queue admission is logged only at debug verbosity, so production
`QUEUE_OR_SLOT_WAIT_MS` remains an inferred OpenClaw provider-to-first-response
interval that includes tunnel/transport overhead. `PROMPT_EVAL_MS`,
`GENERATION_MS`, actual token rates, cancel-to-release, and slot release come
from llama.cpp and are exact when its corresponding native lines exist.
Cross-process request-ID propagation is still unavailable; correlate the
OpenClaw request/call IDs with Argo3 Docker wall timestamps and llama.cpp
slot/task IDs. `CANCEL_REQUESTED` is marked `NOT_OBSERVABLE` when no supported
OpenClaw hook proves the instant; llama.cpp's `cancel task` line is normalized
as `CANCEL_ACKNOWLEDGED` with source `llama_http_reader_enqueued_cancel`.

## Privacy, validation, and rollback

The plugin never logs prompt strings, message bodies, memory/wiki text, tool
descriptions or schemas, assistant text, sender/session keys, headers,
credentials, API keys, Gateway tokens, auth profiles, hashes of private
content, or SSH material. It logs fixed category labels and numeric metadata.
All counting occurs in memory; no new prompt-content log is written. The
combined viewer deliberately filters out ordinary Gateway and server lines.

The offline self-test embeds distinct synthetic secrets in the system prompt,
user message, history, memory, tool schema, and assistant output, then proves
none appears in telemetry. It also verifies disabled-mode silence, categories,
timestamps, lifecycle events, UTF-8 byte counting, and usage fields. Goal 5I
also validated enable/disable against an isolated config and confirmed a
byte-for-byte rollback, validated the Compose merge, and loaded the plugin in
the exact pinned OpenClaw image. These checks need no model or Gateway.

For normal rollback, run `disable` as above. If an interrupted enable left the
private rollback snapshot in place, rerunning `disable` is safe. The snapshot
is removed only after restoration. The telemetry source and Compose override
can then be removed from the project if desired; upstream OpenClaw needs no
rebuild or source restoration.
