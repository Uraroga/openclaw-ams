# Native persistent memory configuration

## Scope and authority

This project uses the memory architecture shipped with official OpenClaw
`v2026.8.1` at commit
`ea806575e6450e4d1efdfc72c19f04be982a1b9b`. It does not add a parallel
memory engine.

The distinction is:

| Native OpenClaw capability | openclaw-ams choice |
| --- | --- |
| Workspace `USER.md`, `MEMORY.md`, daily memory, and `DREAMS.md` surfaces | Three-tier episodic / curated / structured terminology and placement policy |
| Bundled `memory-core`, SQLite builtin backend, FTS/vector-capable retrieval, pre-compaction flush, and dreaming | FTS-only operation with `memory.search.provider: "none"` |
| Bundled optional `memory-wiki` | Enabled bridge mode, agent-scoped vault, supported public-artifact ingestion, and provenance rules |
| Optional compiled wiki prompt contribution | Explicitly disabled with `includeCompiledDigestPrompt: false` |
| Native container/workspace configuration | Project-owned persistent mounts, private runtime separation, and reproducible checks |

References to “tiers,” promotion rules, and placement below describe project
policy applied to those native facilities; they do not claim new storage,
indexing, retrieval, compaction, or dreaming implementations.

Official stable-release documentation reviewed in full:

- `docs/concepts/memory.md`
- `docs/concepts/memory-architecture.md`
- `docs/concepts/memory-builtin.md`
- `docs/concepts/memory-search.md`
- `docs/concepts/agent-workspace.md`
- `docs/concepts/compaction.md`
- `docs/concepts/dreaming.md`
- `docs/reference/memory-config.md`
- `docs/plugins/reference/memory-core.md`
- `docs/plugins/memory-wiki.md`
- `docs/cli/memory.md`
- `docs/cli/wiki.md`

All paths above are under `upstream/openclaw-v2026.8.1/`. The upstream
checkout remains unmodified.

## Three tiers

| Tier | Canonical surface | Purpose | Never use it for |
| --- | --- | --- | --- |
| Episodic | `runtime/workspace/memory/YYYY-MM-DD.md` | Detailed recent work, observations, unresolved loops, temporary context, and session summaries | Stable preferences or a compact durable rulebook |
| Curated | `runtime/workspace/MEMORY.md` | Compact durable non-profile facts, decisions, lessons, proven strategies, and significant long-running context | Raw logs, deployment provenance already in `docs/`, stable user profile data, or structured claim graphs |
| Structured | `runtime/state/wiki/main/` | Source-backed projects, entities, concepts, syntheses, claims, evidence, provenance, relationships, and health reports | Secrets, unsupported assertions, raw personality invention, or automatic authority |

`runtime/workspace/USER.md` is a separate curated user-model surface, not a
fourth general-memory tier. It contains only stable preferences, communication
style, relationships, and active-project context as imperative directives with
dated `active` or `superseded` metadata. Contradictory directives are
superseded in place. No personal directives have been added yet.

`DREAMS.md`, when created by OpenClaw, is a review surface for dreaming and
grounded backfill. It is not a promotion source or a general note file.

## Write and promotion rules

1. Append detailed facts and unfinished context to the current daily file.
2. Put stable user preferences and profile facts only in `USER.md`.
3. Keep `MEMORY.md` compact and limited to durable non-profile material that
   should be available in main private-session context.
4. Put structured, source-backed knowledge in memory-wiki. Prefer official
   `wiki ingest` for sources and `wiki apply` for syntheses or metadata instead
   of editing plugin-managed blocks.
5. Preserve provenance and distinguish evidence from conclusions. Unsupported,
   stale, contradicted, or private claims remain visibly classified.
6. Memory is context, not authorization. Time-based work belongs to native
   scheduling and event-conditioned work belongs to standing intents in a
   future authorized goal.

Historical deployment information remains in project documentation and the
existing dated daily history. Goal 4 removed it from `MEMORY.md`, where it did
not belong as cognitive long-term memory. Historical daily entries were not
rewritten.

## Ownership

| Capability | Owner in this deployment |
| --- | --- |
| Canonical Markdown memory | OpenClaw workspace files |
| `memory_search`, `memory_get`, and `intent` tools | Bundled `memory-core` plugin |
| FTS5 keyword indexing and future vector/hybrid indexing | Builtin engine owned by `memory-core`, stored in the main agent SQLite database |
| Recall ranking, recency, importance, MMR, and trusted trigger recall | Builtin `memory-core` engine |
| Episodic-to-curated promotion, consolidation, and dreaming | `memory-core` |
| Pre-compaction silent memory flush | OpenClaw compaction runtime; enabled by default |
| Wiki vault, compile publication, wiki search/get/apply/lint, claims, dashboards, and provenance graph | Bundled `memory-wiki` plugin |

Goal 4 explicitly sets `memory.search.provider` to `none`. This is OpenClaw's
documented credential-free FTS-only mode: native recall is operational, while
vector semantic indexing is intentionally inactive because this goal may not
add a provider credential or local embedding model. A later authorized goal
can select an embedding provider and run `openclaw memory index --force`.

## Goal 5 model boundary

Goal 5 explicitly selected `openai/gpt-5.6-sol` as the one primary agent model
and pinned its `agentRuntime.id` to `openclaw`. That runtime choice keeps the
native OpenClaw workspace bootstrap and the `memory-core` / `memory-wiki` tool
surfaces in the validation path. It does not replace or add a memory engine.

No approved provider credential was available on 2026-09-01, so no real agent
turn or provider request was made. The existing credential-free checks still
showed:

- `memory-core` bundled, enabled, and loaded with `memory_search`,
  `memory_get`, and `intent`;
- `memory-wiki` bundled, enabled, and loaded with its five wiki tools;
- three native files and 12 indexed chunks, FTS available, vectors disabled,
  and a valid index identity;
- a healthy agent-scoped wiki bridge with three public memory artifacts and no
  warnings;
- native FTS retrieval of the tier-placement guidance and wiki retrieval of
  the provenance-backed memory-ownership claim.

These results are architecture preflight, not model-backed retrieval evidence.
The controlled remember/fresh-session/container-recreation test remains
blocked until a valid OpenAI Platform API key is installed in the main-agent
auth profile.

With that key, OpenAI semantic retrieval is officially available by changing
the search provider from `none` to `openai`, explicitly selecting
`text-embedding-3-small`, and forcing a reindex. Until that is done and the
resulting status reports an enabled vector index, this deployment supports
only FTS/text retrieval. Chat-model reasoning over FTS or wiki results is a
third, separate capability and has not yet been exercised.

Pre-compaction memory flush remains enabled and uses the active session model
unless a separate flush model is configured. It runs only before a real
compaction; the project did not create enough context to force that condition.
Dreaming remains the native managed `memory-core` light/REM/deep sweep at
`0 3 * * *`. The overdue managed sweep ran once during the Goal 5 Gateway
preflight and wrote native reports under `memory/dreaming/` plus `DREAMS.md`.
Light staged the existing factual daily-note material, REM produced a grounded
theme, and deep ranked and promoted zero candidates. The diary recorded that
details were unavailable because no model credential existed. These managed
artifacts are retained as useful audit evidence, not as promoted memory.
Model-assisted diary and deep consolidation still require a working model plus
sufficient eligible material; deep promotion additionally requires the default
score, recall-count, and unique-query gates. No synthetic content was
manufactured to cross those thresholds.

## memory-wiki configuration

The plugin is bundled with OpenClaw and enabled through the native plugin CLI.
The effective project choice is:

```json5
{
  memory: {
    search: { provider: "none" },
  },
  plugins: {
    entries: {
      "memory-wiki": {
        enabled: true,
        config: {
          vaultMode: "bridge",
          vault: {
            scope: "agent",
            renderMode: "native",
          },
          bridge: {
            enabled: true,
            readMemoryArtifacts: true,
            indexDreamReports: true,
            indexDailyNotes: true,
            indexMemoryRoot: true,
            followMemoryEvents: false,
          },
          ingest: { autoCompile: true },
          search: { backend: "shared", corpus: "wiki" },
          context: { includeCompiledDigestPrompt: false },
          render: {
            preserveHumanBlocks: true,
            createBacklinks: true,
            createDashboards: true,
          },
        },
      },
    },
  },
}
```

Safety decisions:

- `bridge`, not `unsafe-local`: bridge reads only public artifacts exposed by
  the active memory plugin through supported plugin SDK seams.
- agent-scoped vault: the main agent resolves to
  `/home/node/.openclaw/wiki/main`; future agents do not automatically share
  the same vault.
- native rendering: no Obsidian dependency or external application.
- compiled prompt digest remains off: enabling the wiki does not silently
  change every prompt.
- memory-event bridging remains off: recall-query audit logs stay in native
  memory-core state instead of becoming structured wiki sources.
- shared search remains scoped to the `wiki` corpus for wiki commands.
- automatic compilation is retained so supported imports publish atomically
  into OpenClaw plugin state.

The bridge choice was diagnostic, not assumed. With the Gateway running,
`openclaw wiki doctor --agent main --json` reported a healthy bridge, zero
warnings, and public `memory-core` artifacts. The configured bridge imports the
root/daily Markdown artifacts but excludes the memory-event journal. This
confirms that the active plugin supports the public bridge contract without
using private memory-core filesystem access.

## Privacy and trust boundary

The entire workspace and wiki vault are private local agent data. They must
not be published to a public repository. `runtime/state/` remains ignored
because it contains SQLite databases and may later contain credentials or
sensitive state.

Within memory-wiki:

- use `privacyTier: public` only for facts already safe for public disclosure;
- use a non-public tier such as `local-private`, `sensitive`, or
  `confirm-before-use` for private claims or entities;
- review `reports/privacy-review.md` before relying on non-public material;
- source-backed claims retain evidence identifiers and provenance;
- wiki content supplies context but never grants permission for an external
  action.

The initial vault contains only factual local project/setup knowledge. It has
no personal profile, identity, external account, credential, or fictional
Felix knowledge.

The permanent validation seed is
`synthesis.openclaw-ams-memory-foundation`. It cites
`source.openclaw-ams-memory-architecture` and carries the supported claim
`claim.openclaw-ams.memory-ownership` with `local-private` evidence pointing
to the project-owned ownership table. It is useful foundation knowledge, not a
disposable or fictional test fixture.

## Native defaults retained

- Pre-compaction memory flush remains enabled by default. No model override was
  configured; it will use the active session model once credentials exist.
- Dreaming remains enabled by default in `memory-core`.
- `memory-core` owns its single managed dreaming cron at `0 3 * * *`.
- No custom memory cron, heartbeat scratch, or monitor was added.
- Default promotion thresholds and consolidation safety limits were not
  changed.
- The default personal-install cross-conversation setting currently resolves
  session sources for the main agent, but no eligible session transcripts are
  present and no external conversation was imported.

## Operational commands

Run CLI commands through the stable Docker wrapper:

```bash
# Inspect and rebuild episodic/curated recall
./deployment/openclaw-compose.sh run --rm --no-deps \
  --entrypoint node openclaw-gateway \
  dist/index.js memory status --agent main --json

./deployment/openclaw-compose.sh run --rm --no-deps \
  --entrypoint node openclaw-gateway \
  dist/index.js memory index --force --agent main

./deployment/openclaw-compose.sh run --rm --no-deps \
  --entrypoint node openclaw-gateway \
  dist/index.js memory search '<query>' --agent main --json

# Inspect and maintain structured memory
./deployment/openclaw-compose.sh run --rm --no-deps \
  --entrypoint node openclaw-gateway \
  dist/index.js wiki status --agent main --json

./deployment/openclaw-compose.sh run --rm --no-deps \
  --entrypoint node openclaw-gateway \
  dist/index.js wiki doctor --agent main --json

./deployment/openclaw-compose.sh run --rm --no-deps \
  --entrypoint node openclaw-gateway \
  dist/index.js wiki compile --agent main --json

./deployment/openclaw-compose.sh run --rm --no-deps \
  --entrypoint node openclaw-gateway \
  dist/index.js wiki lint --agent main --json

./deployment/openclaw-compose.sh run --rm --no-deps \
  --entrypoint node openclaw-gateway \
  dist/index.js wiki search '<query>' --agent main --json
```

Bridge artifact reads require the running Gateway so the CLI sees the same
active plugin context. Start and stop it with the commands in `README.md`.

## Validation record

Goal 4 validates:

- FTS indexing and native retrieval of a temporary unique daily-memory fact;
- removal of that test fact followed by a clean reindex;
- bridge import after removing deployment provenance from `MEMORY.md`;
- official wiki ingest/apply, compile, lint, search, and get operations against
  a factual project source and synthesis;
- vault and SQLite persistence across Gateway container recreation;
- healthy post-recreation `memory status` and `wiki doctor` results.

Observed results:

- `memory index --force` indexed three canonical files into 12 FTS chunks with
  provider `none`, a valid index identity, and no vector index.
- The unique daily test query returned `memory/2026-08-31.md` with score
  `0.9795`; after removing the line and reindexing, it returned no results.
- Native memory-core retained its normal recall audit event. Event-journal
  bridging was then disabled, and the official bridge reconciler removed that
  test event's wiki source while preserving the native audit trail.
- Wiki compilation reports three sources, one synthesis, one supported claim,
  no front-matter errors, and zero lint issues.
- Raw-claim search returned `claim.openclaw-ams.memory-ownership` with its
  confidence, evidence kind, and evidence source id.
- After full container removal and recreation, the existing daily-memory query,
  wiki search, wiki get, vault file hash, and both persistent SQLite databases
  remained available; the Gateway and `wiki doctor` were healthy.
