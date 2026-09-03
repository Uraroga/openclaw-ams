"use strict";

const PLUGIN_ID = "openclaw-ams-prompt-telemetry";
const PREFIX = "[PROMPT-TELEMETRY]";
const CACHE_BOUNDARY = "\n<!-- OPENCLAW_CACHE_BOUNDARY -->\n";
const TOKEN_METHOD = "utf8_bytes_div_4";
const STATE_TTL_MS = 6 * 60 * 60 * 1000;

const runState = new Map();

function enabled() {
  return /^(1|true|yes|on)$/iu.test(process.env.OPENCLAW_AMS_PROMPT_TELEMETRY || "");
}

function isoNow() {
  return new Date().toISOString();
}

function monotonicNow() {
  return process.hrtime.bigint();
}

function elapsedMs(start) {
  if (typeof start !== "bigint") {
    return undefined;
  }
  return Math.max(0, Number(monotonicNow() - start) / 1e6);
}

function roundedMs(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : undefined;
}

function safeId(value, fallback = "unknown") {
  const cleaned = String(value || "").replace(/[^A-Za-z0-9._:/-]/gu, "_").slice(0, 96);
  return cleaned || fallback;
}

function metrics(text) {
  const value = typeof text === "string" ? text : "";
  const chars = [...value].length;
  const bytes = Buffer.byteLength(value, "utf8");
  return { chars, bytes, estimatedTokens: Math.ceil(bytes / 4) };
}

function serializeForMeasurement(value) {
  try {
    return JSON.stringify(value) || "";
  } catch {
    return "";
  }
}

function log(api, event, fields = {}) {
  const rendered = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${String(value).replace(/\s+/gu, "_")}`)
    .join(" ");
  api.logger.info(`${PREFIX} [${isoNow()}] ${event}${rendered ? ` ${rendered}` : ""}`);
}

function logMeasured(api, event, category, value, extra = {}) {
  const measured = metrics(value);
  log(api, event, {
    category,
    chars: measured.chars,
    bytes: measured.bytes,
    ESTIMATED_TOKENS: measured.estimatedTokens,
    method: TOKEN_METHOD,
    ...extra,
  });
  return measured;
}

function sectionCategory(heading) {
  const normalized = heading.trim().toLowerCase();
  if (normalized.includes("deferred tool") || normalized.includes("tool search")) {
    return "tool-search-metadata";
  }
  if (normalized.includes("tool")) {
    return "tool-guidance";
  }
  if (normalized.includes("skill")) {
    return "skills-metadata";
  }
  if (normalized.includes("memory")) {
    return "memory-guidance-or-supplement";
  }
  if (
    normalized.includes("runtime") ||
    normalized.includes("workspace") ||
    normalized.includes("date") ||
    normalized.includes("time") ||
    normalized.includes("sandbox") ||
    normalized.includes("environment")
  ) {
    return "environment-runtime-metadata";
  }
  if (normalized.includes("sender") || normalized.includes("identity")) {
    return "agent-identity-metadata";
  }
  if (normalized.includes("plugin") || normalized.includes("mcp")) {
    return "plugin-mcp-metadata";
  }
  return "openclaw-core-system";
}

function workspaceCategory(pathLabel) {
  const normalized = pathLabel.trim().replace(/\\/gu, "/").toLowerCase();
  const base = normalized.split("/").pop();
  const fixed = new Map([
    ["agents.md", "AGENTS.md"],
    ["soul.md", "SOUL.md"],
    ["identity.md", "IDENTITY.md"],
    ["user.md", "USER.md"],
    ["memory.md", "MEMORY.md"],
    ["bootstrap.md", "BOOTSTRAP.md"],
  ]);
  if (fixed.has(base)) {
    return fixed.get(base);
  }
  if (/(^|\/)memory\/\d{4}-\d{2}-\d{2}\.md$/u.test(normalized)) {
    return "daily-memory";
  }
  if (normalized.includes("memory-wiki") || normalized.includes("wiki")) {
    return "memory-wiki-retrieved-context";
  }
  if (normalized.includes("memory-core")) {
    return "memory-core-retrieved-context";
  }
  return null;
}

function splitHeadingSections(text) {
  if (!text) {
    return [];
  }
  const matches = [...text.matchAll(/^## ([^\n]+)$/gmu)];
  if (matches.length === 0) {
    return [{ category: "openclaw-core-system", text }];
  }
  const sections = [];
  if (matches[0].index > 0) {
    sections.push({ category: "openclaw-core-system", text: text.slice(0, matches[0].index) });
  }
  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].index;
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    sections.push({ category: sectionCategory(matches[index][1]), text: text.slice(start, end) });
  }
  return sections;
}

function splitProjectContext(text) {
  if (!text) {
    return [];
  }
  const matches = [...text.matchAll(/^## ([^\n]+)\n\n/gmu)]
    .map((match) => ({ match, category: workspaceCategory(match[1]) }))
    .filter((item) => item.category !== null);
  const sections = [];
  if (matches.length === 0) {
    return [{ category: "workspace-bootstrap-context", text }];
  }
  if (matches[0].match.index > 0) {
    sections.push({ category: "workspace-bootstrap-context", text: text.slice(0, matches[0].match.index) });
  }
  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].match.index;
    const end = index + 1 < matches.length ? matches[index + 1].match.index : text.length;
    sections.push({ category: matches[index].category, text: text.slice(start, end) });
  }
  return sections;
}

function systemComponents(systemPrompt) {
  const prompt = typeof systemPrompt === "string" ? systemPrompt : "";
  if (!prompt) {
    return [];
  }

  const projectMarker = "\n# Project Context\n";
  const projectStart = prompt.indexOf(projectMarker);
  const boundaryStart = prompt.indexOf(CACHE_BOUNDARY);
  if (projectStart < 0) {
    return splitHeadingSections(prompt);
  }

  const silentStart = prompt.indexOf("\n## Silent Replies\n", projectStart);
  const projectEnd = silentStart >= 0
    ? silentStart
    : boundaryStart >= 0
      ? boundaryStart
      : prompt.length;
  const components = splitHeadingSections(prompt.slice(0, projectStart));
  components.push(...splitProjectContext(prompt.slice(projectStart, projectEnd)));
  components.push(...splitHeadingSections(prompt.slice(projectEnd)));
  return components;
}

function toolName(tool) {
  if (!tool || typeof tool !== "object") {
    return "";
  }
  return String(tool.name || tool.function?.name || "").toLowerCase();
}

function toolCategory(tool) {
  const name = toolName(tool);
  if (["tool_search", "tool_describe", "tool_call"].includes(name)) {
    return "tool-search-metadata";
  }
  if (name.includes("wiki")) {
    return "memory-wiki-tool-definitions";
  }
  if (name.startsWith("memory_") || name.includes("memory")) {
    return "memory-core-tool-definitions";
  }
  const core = new Set([
    "read", "write", "edit", "apply_patch", "exec", "process", "browser", "canvas",
    "nodes", "cron", "message", "session_status", "sessions_list", "sessions_history",
    "sessions_send", "sessions_spawn", "subagents", "agents_list", "image", "tts", "pdf",
    "web_search", "web_fetch",
  ]);
  return core.has(name) ? "tool-definitions" : "plugin-mcp-tool-definitions";
}

function groupTools(tools) {
  const groups = new Map();
  for (const tool of Array.isArray(tools) ? tools : []) {
    const category = toolCategory(tool);
    const group = groups.get(category) || [];
    group.push(tool);
    groups.set(category, group);
  }
  return groups;
}

function stateFor(runId) {
  const key = safeId(runId);
  const existing = runState.get(key);
  if (existing) {
    return existing;
  }
  const state = {
    createdMono: monotonicNow(),
    createdWallMs: Date.now(),
    callIds: [],
    calls: new Map(),
  };
  state.expiry = setTimeout(() => runState.delete(key), STATE_TTL_MS);
  state.expiry.unref?.();
  runState.set(key, state);
  return state;
}

function deleteState(request) {
  const state = runState.get(request);
  if (state?.expiry) {
    clearTimeout(state.expiry);
  }
  runState.delete(request);
}

function ensureRequestStart(api, request, state, boundary) {
  if (typeof state.startedMono === "bigint") {
    return;
  }
  state.startedMono = monotonicNow();
  state.startedWallMs = Date.now();
  log(api, "REQUEST_CREATED", { request, boundary });
  log(api, "PROMPT_BUILD_START", { request, boundary });
}

function register(api) {
  if (!enabled()) {
    return;
  }

  log(api, "TELEMETRY enabled", { mode: "metadata-only", token_counting: "estimated" });

  api.on("before_model_resolve", (_event, ctx) => {
    const request = safeId(ctx.runId);
    const state = stateFor(request);
    ensureRequestStart(api, request, state, "before-model-resolve");
  });

  api.on("before_prompt_build", (event, ctx) => {
    const request = safeId(ctx.runId);
    const state = stateFor(request);
    ensureRequestStart(api, request, state, "before-prompt-build-fallback");
    state.originalPrompt = event.prompt;
    log(api, "PROMPT_BUILD_BOUNDARY", { request, boundary: "before-prompt-build" });
    logMeasured(api, "OBSERVE", "current-user-message-source", event.prompt, {
      request,
      additive: "no",
    });
  });

  api.on("llm_input", (event) => {
    const request = safeId(event.runId);
    const state = stateFor(request);
    ensureRequestStart(api, request, state, "llm-input-fallback");
    const buildMs = roundedMs(elapsedMs(state.startedMono));
    let order = 1;
    const componentMetrics = [];
    const seenCategories = new Set();

    for (const component of systemComponents(event.systemPrompt)) {
      const measured = logMeasured(api, "ADD", component.category, component.text, {
        request,
        order: order++,
      });
      componentMetrics.push(measured);
      seenCategories.add(component.category);
    }

    const historyCount = Array.isArray(event.historyMessages) ? event.historyMessages.length : 0;
    const historySerialized = historyCount > 0 ? serializeForMeasurement(event.historyMessages) : "";
    componentMetrics.push(logMeasured(api, "ADD", "conversation-session-history", historySerialized, {
      request,
      order: order++,
      messages: historyCount,
      representation: "hook-json",
    }));
    seenCategories.add("conversation-session-history");

    const originalPrompt = state.originalPrompt;
    const originalPosition = typeof originalPrompt === "string" && originalPrompt.length > 0
      ? event.prompt.indexOf(originalPrompt)
      : -1;
    if (typeof originalPrompt === "string" && event.prompt !== originalPrompt && originalPosition >= 0) {
      const prefix = event.prompt.slice(0, originalPosition);
      const suffix = event.prompt.slice(originalPosition + originalPrompt.length);
      if (prefix) {
        componentMetrics.push(logMeasured(api, "ADD", "current-turn-automatic-context", prefix, {
          request,
          order: order++,
          position: "before-user-message",
        }));
        seenCategories.add("current-turn-automatic-context");
      }
      componentMetrics.push(logMeasured(api, "ADD", "current-user-message", originalPrompt, {
        request,
        order: order++,
        transformed: "false",
      }));
      if (suffix) {
        componentMetrics.push(logMeasured(api, "ADD", "current-turn-automatic-context", suffix, {
          request,
          order: order++,
          position: "after-user-message",
        }));
        seenCategories.add("current-turn-automatic-context");
      }
    } else {
      const category = typeof originalPrompt === "string" && event.prompt !== originalPrompt
        ? "current-turn-final-unattributed"
        : "current-user-message";
      componentMetrics.push(logMeasured(api, "ADD", category, event.prompt, {
        request,
        order: order++,
        transformed: originalPrompt === undefined ? "unknown" : String(originalPrompt !== event.prompt),
      }));
      seenCategories.add(category);
    }
    seenCategories.add("current-user-message");
    state.originalPrompt = undefined;

    for (const [category, tools] of groupTools(event.tools)) {
      const serialized = serializeForMeasurement(tools);
      componentMetrics.push(logMeasured(api, "ADD", category, serialized, {
        request,
        order: order++,
        tools: tools.length,
        representation: "hook-json",
      }));
      seenCategories.add(category);
    }

    const totalChars = componentMetrics.reduce((sum, item) => sum + item.chars, 0);
    const totalBytes = componentMetrics.reduce((sum, item) => sum + item.bytes, 0);
    state.promptBuildMs = buildMs;
    log(api, "PROMPT_BUILD_COMPLETE", {
      request,
      chars: totalChars,
      bytes: totalBytes,
      ASSEMBLY_ESTIMATED_TOKENS: Math.ceil(totalBytes / 4),
      method: TOKEN_METHOD,
      PROMPT_BUILD_MS: buildMs,
      images: event.imagesCount || 0,
      note: "excludes_provider_chat_template",
    });
    const definitiveCategories = [
      "agent-identity-metadata", "AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "MEMORY.md",
      "daily-memory", "workspace-bootstrap-context", "tool-search-metadata", "plugin-mcp-metadata",
      "plugin-mcp-tool-definitions", "environment-runtime-metadata",
    ];
    for (const category of definitiveCategories) {
      if (!seenCategories.has(category)) {
        log(api, "CATEGORY absent", { request, category });
      }
    }
    for (const category of ["memory-core-retrieved-context", "memory-wiki-retrieved-context"]) {
      if (!seenCategories.has(category)) {
        log(api, "CATEGORY unknown", { request, category, reason: "hook_has_no_source_provenance" });
      }
    }
  });

  api.on("model_call_started", (event) => {
    const request = safeId(event.runId);
    const call = safeId(event.callId);
    const state = stateFor(request);
    ensureRequestStart(api, request, state, "model-call-started-fallback");
    state.callIds.push(call);
    const callState = {
      sentMono: monotonicNow(),
      sentWallMs: Date.now(),
    };
    state.calls.set(call, callState);
    state.lastCall = call;
    log(api, "PROVIDER_SEND", {
      request,
      call,
      provider: safeId(event.provider),
      model: safeId(event.model),
      api: safeId(event.api),
      transport: safeId(event.transport),
      context_budget: event.contextTokenBudget,
    });
    log(api, "QUEUE_WAIT_START", {
      request,
      call,
      observability: "INFERRED_FROM_TIMESTAMPS",
      note: "includes_provider_transport",
    });
  });

  api.on("model_call_ended", (event) => {
    const request = safeId(event.runId);
    const call = safeId(event.callId);
    const state = stateFor(request);
    const callState = state.calls.get(call) || {};
    callState.providerMs = roundedMs(elapsedMs(callState.sentMono));
    callState.providerReportedMs = event.durationMs;
    callState.outcome = event.outcome;
    callState.failureKind = event.failureKind;
    if (Number.isFinite(event.timeToFirstByteMs)) {
      callState.firstResponseByteMs = event.timeToFirstByteMs;
      const occurredAt = Number.isFinite(callState.sentWallMs)
        ? new Date(callState.sentWallMs + event.timeToFirstByteMs).toISOString()
        : undefined;
      log(api, "QUEUE_WAIT_COMPLETE", {
        request,
        call,
        occurred_at: occurredAt,
        emitted: "retrospective",
        QUEUE_OR_SLOT_WAIT_MS: event.timeToFirstByteMs,
        observability: "INFERRED_FROM_TIMESTAMPS",
        note: "includes_provider_transport",
      });
      log(api, "LLAMA_SLOT_ACQUIRED", {
        request,
        call,
        occurred_at: occurredAt,
        emitted: "retrospective",
        PROVIDER_TO_LLAMA_MS: event.timeToFirstByteMs,
        QUEUE_OR_SLOT_WAIT_MS: event.timeToFirstByteMs,
        observability: "INFERRED_FROM_TIMESTAMPS",
        note: "includes_provider_transport",
      });
      log(api, "FIRST_RESPONSE_BYTE", {
        request,
        call,
        occurred_at: occurredAt,
        emitted: "retrospective",
        elapsed_ms: event.timeToFirstByteMs,
        first_generated_token: "NOT_OBSERVABLE",
        pinned_llama_semantics: "stream_headers_at_prompt_start",
      });
    }
    const cancellation = /^(aborted|cancelled|canceled|terminated)$/iu.test(String(event.failureKind || event.outcome || ""));
    if (cancellation) {
      state.cancelObserved = true;
      log(api, "CANCEL_REQUESTED", {
        request,
        call,
        state: "NOT_OBSERVABLE",
        reason: "no_supported_openclaw_hook",
      });
      log(api, "CANCEL_ACKNOWLEDGED", {
        request,
        call,
        boundary: "provider-call-ended",
        failure_kind: safeId(event.failureKind || event.outcome),
      });
    }
    log(api, "PROVIDER_COMPLETE", {
      request,
      call,
      outcome: event.outcome,
      failure_kind: event.failureKind,
      PROVIDER_CALL_MS: callState.providerMs,
      provider_reported_duration_ms: event.durationMs,
      POST_FIRST_RESPONSE_BYTE_MS: Number.isFinite(callState.providerMs) && Number.isFinite(callState.firstResponseByteMs)
        ? roundedMs(callState.providerMs - callState.firstResponseByteMs)
        : undefined,
      request_bytes: event.requestPayloadBytes,
      response_stream_bytes: event.responseStreamBytes,
    });
    state.calls.set(call, callState);
  });

  api.on("llm_output", (event) => {
    const request = safeId(event.runId);
    const state = stateFor(request);
    const usage = event.usage || {};
    state.usage = usage;
    log(api, "PROVIDER_USAGE", {
      request,
      PROVIDER_REPORTED_INPUT_TOKENS: usage.input,
      PROVIDER_REPORTED_OUTPUT_TOKENS: usage.output,
      cache_read_tokens: usage.cacheRead,
      cache_write_tokens: usage.cacheWrite,
      accounting: "provider-reported",
    });
    const callState = state.calls.get(state.lastCall) || {};
    log(api, "REQUEST_SUMMARY", {
      request,
      PROMPT_BUILD_MS: state.promptBuildMs,
      PROVIDER_TO_LLAMA_MS: callState.firstResponseByteMs,
      QUEUE_OR_SLOT_WAIT_MS: callState.firstResponseByteMs,
      queue_observability: Number.isFinite(callState.firstResponseByteMs)
        ? "INFERRED_FROM_TIMESTAMPS"
        : "NOT_OBSERVABLE",
      PROMPT_EVAL_MS: "NOT_OBSERVABLE_IN_OPENCLAW",
      GENERATION_MS: "NOT_OBSERVABLE_IN_OPENCLAW",
      CANCEL_TO_SLOT_RELEASE_MS: "NOT_OBSERVABLE_IN_OPENCLAW",
      REQUEST_TOTAL_MS: roundedMs(elapsedMs(state.startedMono)),
      PROVIDER_REPORTED_INPUT_TOKENS: usage.input,
      PROVIDER_REPORTED_OUTPUT_TOKENS: usage.output,
      cache_read_tokens: usage.cacheRead,
      cancel_requested: state.cancelObserved ? "observed_at_provider_end" : "no",
      model: safeId(event.model),
    });
    state.outputSeen = true;
    if (state.agentEnded) {
      deleteState(request);
    }
  });

  api.on("agent_end", (event) => {
    const request = safeId(event.runId);
    const state = stateFor(request);
    ensureRequestStart(api, request, state, "agent-end-fallback");
    state.agentEnded = true;
    log(api, "REQUEST_COMPLETE", {
      request,
      REQUEST_TOTAL_MS: roundedMs(elapsedMs(state.startedMono)),
      upstream_agent_duration_ms: event.durationMs,
      success: event.success,
      error: event.error ? "present_not_logged" : "absent",
    });
    if (state.outputSeen) {
      deleteState(request);
    }
  });
}

module.exports = {
  id: PLUGIN_ID,
  name: "OpenClaw AMS prompt telemetry",
  description: "Metadata-only prompt assembly and provider timing telemetry.",
  register,
  __test: { metrics, systemComponents, toolCategory, elapsedMs },
};
