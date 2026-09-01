# Goal 5: real-model integration

## Outcome

OpenClaw is configured for exactly one real model, but end-to-end validation is
paused at the required credential boundary. The only remaining prerequisite
for the first genuine turn is a valid OpenAI Platform API key with billing and
access to the selected model. No credential was available through the process
environment, the project auth-profile secret mount, or the main agent's
OpenClaw auth store.

No provider request was attempted, no synthetic memory fact was written, and
no model-backed result is claimed in this document.

## Provider and model

The pinned release's official provider directory and bundled plugin registry
were reviewed rather than assuming a provider. v2026.8.1 supports hosted and
local model providers including OpenAI, Anthropic, Google, Amazon Bedrock,
OpenRouter, xAI, Groq, Mistral, DeepSeek, Cerebras, Cohere, Fireworks,
Together, NVIDIA, Ollama, LM Studio, llama.cpp, vLLM, SGLang, and the additional
provider plugins listed in `upstream/openclaw-v2026.8.1/docs/providers/index.md`.
The runtime's provider/model catalog remains the authority for models actually
available to a particular credential and account.

| Field | Selection |
| --- | --- |
| Provider | OpenAI (`openai`) |
| Exact agent model | `openai/gpt-5.6-sol` |
| Agent runtime | embedded OpenClaw (`agentRuntime.id: "openclaw"`) |
| Fallbacks/routes | none |
| Authentication | OpenAI Platform API-key auth profile |
| Non-secret config | `runtime/state/openclaw.json` |
| Secret location | ignored `runtime/state/agents/main/agent/openclaw-agent.sqlite`, managed by `openclaw models auth` |

The pinned OpenClaw v2026.8.1 catalog returned nine OpenAI model identifiers,
including the exact Sol, Terra, and Luna tiers. Its own fresh-setup default and
the official OpenAI model catalog both identify `gpt-5.6-sol`; the project did
not infer or invent the ID. The embedded runtime is explicit because Goal 5 is
validating OpenClaw's native workspace and memory tool loop, not the separate
Codex app-server harness.

The selected API-key mechanism also supports OpenAI embeddings. ChatGPT/Codex
OAuth would be sufficient for agent turns but, per the pinned OpenClaw docs,
does not authorize embeddings and therefore would leave the vector test
blocked by a second credential requirement.

## Safe credential installation

Run this from the project root. The key is read without terminal echo, sent on
standard input, stored by OpenClaw in its persistent agent auth store, and then
removed from the shell variable:

```bash
read -rsp 'OpenAI API key: ' OPENCLAW_AMS_OPENAI_KEY
printf '\n'
printf '%s\n' "$OPENCLAW_AMS_OPENAI_KEY" | \
  ./deployment/openclaw-compose.sh run --rm --no-deps -T \
  --entrypoint node openclaw-gateway \
  dist/index.js models auth paste-api-key --provider openai --agent main
unset OPENCLAW_AMS_OPENAI_KEY
```

Do not put the key in `deployment/openclaw.env`, `openclaw.json`, workspace
Markdown, command arguments, or project documentation. Verify only metadata:

```bash
./deployment/openclaw-compose.sh run --rm --no-deps \
  --entrypoint node openclaw-gateway \
  dist/index.js models auth list --provider openai --agent main --json
./deployment/openclaw-compose.sh run --rm --no-deps \
  --entrypoint node openclaw-gateway \
  dist/index.js models status --json
```

To change the primary later, first discover exact identifiers with
`models list --provider openai --json`, then run
`models set openai/<exact-model-id>` and set that exact model entry's
`agentRuntime.id` to `openclaw`. Preserve the model-scoped embedded runtime
setting when native memory-tool validation remains the goal.

## Startup and completed preflight

The existing deployment path was used with an ephemeral, explicitly non-secret
local validation Gateway token:

```bash
export OPENCLAW_GATEWAY_TOKEN='<operator-owned token>'
./deployment/openclaw-compose.sh up -d openclaw-gateway
curl -fsS http://127.0.0.1:18789/healthz
curl -fsS http://127.0.0.1:18789/startupz
curl -fsS http://127.0.0.1:18789/readyz
./deployment/openclaw-compose.sh ps
```

Observed on 2026-09-01:

- the official immutable v2026.8.1 image started healthy;
- all three native health probes passed;
- `config validate` passed;
- `models status --json` resolved only `openai/gpt-5.6-sol`, with no
  fallbacks, and reported OpenAI missing;
- `memory-core` remained bundled, enabled, and loaded with its native recall
  tools;
- `memory-wiki` remained bundled, enabled, and loaded;
- native memory reported three files, 12 chunks, FTS enabled, vectors
  disabled, and a valid index identity;
- credential-free native search found the existing memory-tier guidance;
- `wiki doctor` was healthy with no warnings, and wiki search found the
  supported `claim.openclaw-ams.memory-ownership` claim with its evidence;
- the managed dreaming job remained enabled at `0 3 * * *`.

These memory searches are baseline CLI checks. They did not involve a chat
model and must not be represented as model reasoning or model-backed recall.

## Blocked model-backed validation

After credential installation, use a minimal set of Gateway-backed turns with
explicit new session keys. Each command below makes a provider/API request:

```bash
# First real turn and workspace-context check.
./deployment/openclaw-compose.sh exec -T openclaw-gateway \
  node dist/index.js agent --agent main --session-key goal5-context \
  --message 'State which workspace memory tiers and native memory tools are available. Do not modify identity or memory.' --json

# Controlled synthetic write. Replace the placeholder once with a unique,
# harmless nonce and retain it only for this test.
./deployment/openclaw-compose.sh exec -T openclaw-gateway \
  node dist/index.js agent --agent main --session-key goal5-write \
  --message 'Remember this harmless temporary validation fact in the correct memory tier: Goal5 synthetic beacon = <unique nonce>. Do not edit USER.md or memory-wiki unless their tier rules genuinely require it.' --json

# Fresh-session recall; the prompt deliberately omits the nonce.
./deployment/openclaw-compose.sh exec -T openclaw-gateway \
  node dist/index.js agent --agent main --session-key goal5-recall-fresh \
  --message 'Use the official native memory tools to recover the Goal5 synthetic beacon. Report the source path and retrieval mechanism.' --json
```

Inspect the resulting workspace diff and memory index before deciding whether
the fact correctly landed in the dated daily note or another tier. A temporary
interaction fact normally belongs in daily episodic memory; it is not a stable
user directive and lacks the sourced structure needed for memory-wiki. Do not
move it to `USER.md`, `MEMORY.md`, or the wiki merely to satisfy the test.

Then recreate the disposable container and use another new session:

```bash
./deployment/openclaw-compose.sh down
./deployment/openclaw-compose.sh up -d openclaw-gateway
./deployment/openclaw-compose.sh exec -T openclaw-gateway \
  node dist/index.js agent --agent main --session-key goal5-recall-recreated \
  --message 'Use the official native memory tools to recover the Goal5 synthetic beacon. Report the source path and retrieval mechanism.' --json
```

Only after both recalls succeed should the temporary line be removed from its
actual canonical memory file, the native index rebuilt, and the test query
confirmed absent. Keep only aggregate provenance in this document; do not keep
the nonce or transcript content here.

## FTS, vector retrieval, and reasoning

The three mechanisms are distinct:

- FTS/text retrieval is currently operational with
  `memory.search.provider: "none"`. It makes no embedding request.
- Vector semantic retrieval is currently disabled. After installing the API
  key, set `memory.search.provider` to `openai`, set the exact embedding model
  to `text-embedding-3-small`, run `memory index --force --agent main`, and
  require `memory status --deep --agent main --json` to show an enabled,
  healthy vector index before claiming success. Index and semantic-query
  operations make OpenAI embedding API requests.
- Model reasoning over retrieved memory occurs only when a genuine agent turn
  consumes FTS, vector, or wiki results. No such turn has run yet.

The planned vector test must use a meaning-equivalent query without the unique
keywords from the stored sentence and compare the returned debug/status data.
An FTS hit alone is not evidence of semantic retrieval.

## Compaction and dreaming

The pinned runtime retains its native defaults:

- pre-compaction memory flush is enabled and uses the active session model;
- the flush happens only when OpenClaw is about to compact a sufficiently long
  session, so it was not invoked and no large context was generated to force
  it;
- dreaming is enabled through `memory-core`, with one managed daily sweep at
  `0 3 * * *`;
- light and REM do not write `MEMORY.md`; deep consolidation can do so only
  after its score, recall-count, and unique-query gates pass;
- Dream Diary narrative and deep consolidation require a working model and
  enough eligible material. The project did not fabricate volume to trigger
  either path.

The overdue managed sweep did run once during Gateway startup. This safely
validated the official deterministic phase plumbing without a model: light
staged existing factual daily-note candidates, REM wrote a grounded theme, and
deep ranked and promoted zero candidates. `DREAMS.md` explicitly recorded that
details were unavailable in the run, which is the expected credential blocker
rather than model-assisted narrative output. The generated `DREAMS.md` and
`memory/dreaming/{light,rem,deep}/2026-09-01.md` files are preserved as native
audit/provenance artifacts. `MEMORY.md` and `USER.md` were unchanged.

Once the credential exists, a manual compact command may minimally validate
the official summarizer on a naturally eligible session. The pre-compaction
flush itself should be claimed only if logs/transcript evidence show that it
actually ran. Dreaming should remain documented as condition-blocked unless a
normal eligible candidate set exists; do not add a cron job or lower safety
thresholds for the test.

## Provider requests and usage

Provider/API requests made during this blocked Goal 5 run: **zero**.
Consequently there is no provider token usage or cost to report. Future
Gateway-backed agent turns, auth probes run with `models status --probe`,
embedding reindex/query operations, compaction summarization, and model-backed
dreaming are provider requests and must be counted from their JSON usage or
session metadata.

## Remaining blocker

Supply one valid OpenAI Platform API key through the official
`models auth paste-api-key --provider openai --agent main` flow. It must have
billing and account access for `gpt-5.6-sol`; vector validation also requires
OpenAI embeddings access. After that, resume only the test matrix in this
document and stop when Goal 5 is complete.
