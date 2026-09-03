"use strict";

const assert = require("node:assert/strict");
const plugin = require("./index.cjs");

function harness(on) {
  const hooks = new Map();
  const lines = [];
  process.env.OPENCLAW_AMS_PROMPT_TELEMETRY = on ? "1" : "0";
  plugin.register({
    logger: { info: (line) => lines.push(line), warn() {}, error() {} },
    on: (name, handler) => hooks.set(name, handler),
  });
  return { hooks, lines };
}

const disabled = harness(false);
assert.equal(disabled.hooks.size, 0);
assert.equal(disabled.lines.length, 0);

const active = harness(true);
const runId = "offline-run-1";
const privateUser = "PRIVATE_USER_TEXT_DO_NOT_LOG";
const privateMemory = "PRIVATE_MEMORY_TEXT_DO_NOT_LOG";
const secret = "sk-OFFLINE-SECRET-DO-NOT-LOG";
const privateInjected = "PRIVATE_AUTOMATIC_CONTEXT_DO_NOT_LOG";

active.hooks.get("before_model_resolve")(
  { prompt: privateUser },
  { runId },
);
active.hooks.get("before_prompt_build")(
  { prompt: privateUser, messages: [] },
  { runId },
);
active.hooks.get("llm_input")({
  runId,
  sessionId: "offline-session",
  provider: "argo-forge",
  model: "/models/Qwen_Qwen3-14B-Q2_K.gguf",
  systemPrompt: [
    "OpenClaw core instructions",
    "## Tooling",
    "Tool guidance",
    "\n# Project Context\n",
    "Safe wrapper",
    "## MEMORY.md\n\n",
    privateMemory,
    "\n<!-- OPENCLAW_CACHE_BOUNDARY -->\n",
    "## Runtime",
    `credential=${secret}`,
  ].join("\n"),
  prompt: `${privateInjected}\n${privateUser}\n${privateInjected}`,
  historyMessages: [{ role: "user", content: "PRIVATE_HISTORY_DO_NOT_LOG" }],
  imagesCount: 0,
  tools: [
    { name: "read", description: "PRIVATE_TOOL_DESCRIPTION_DO_NOT_LOG" },
    { name: "tool_search", description: "PRIVATE_CATALOG_DO_NOT_LOG" },
    { name: "memory_search", description: "PRIVATE_MEMORY_TOOL_DO_NOT_LOG" },
    { name: "mcp_private", description: secret },
  ],
});
active.hooks.get("model_call_started")({
  runId,
  callId: "offline-call-1",
  provider: "argo-forge",
  model: "/models/Qwen_Qwen3-14B-Q2_K.gguf",
  api: "openai-completions",
  transport: "stream",
});
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
active.hooks.get("model_call_ended")({
  runId,
  callId: "offline-call-1",
  provider: "argo-forge",
  model: "/models/Qwen_Qwen3-14B-Q2_K.gguf",
  durationMs: 15,
  outcome: "completed",
  timeToFirstByteMs: 5,
});
// OpenClaw v2026.8.1 emits agent_end before llm_output on the observed path.
// This ordering exposed Goal 5I's premature-state-deletion timing bug.
active.hooks.get("agent_end")({
  runId,
  success: true,
});
active.hooks.get("llm_output")({
  runId,
  sessionId: "offline-session",
  provider: "argo-forge",
  model: "/models/Qwen_Qwen3-14B-Q2_K.gguf",
  assistantTexts: ["PRIVATE_ASSISTANT_TEXT_DO_NOT_LOG"],
  usage: { input: 123, output: 3 },
});

const cancelledRunId = "offline-cancelled-run";
active.hooks.get("before_model_resolve")({}, { runId: cancelledRunId });
active.hooks.get("model_call_started")({
  runId: cancelledRunId,
  callId: "offline-cancelled-call",
  provider: "argo-forge",
  model: "/models/Qwen_Qwen3-14B-Q2_K.gguf",
});
active.hooks.get("model_call_ended")({
  runId: cancelledRunId,
  callId: "offline-cancelled-call",
  provider: "argo-forge",
  model: "/models/Qwen_Qwen3-14B-Q2_K.gguf",
  durationMs: 1,
  outcome: "error",
  failureKind: "aborted",
});
active.hooks.get("agent_end")({ runId: cancelledRunId, success: false, error: secret });
active.hooks.get("llm_output")({
  runId: cancelledRunId,
  sessionId: "offline-session",
  provider: "argo-forge",
  model: "/models/Qwen_Qwen3-14B-Q2_K.gguf",
  assistantTexts: [],
  usage: {},
});

const output = active.lines.join("\n");
for (const forbidden of [
  privateUser,
  privateMemory,
  secret,
  privateInjected,
  "PRIVATE_HISTORY_DO_NOT_LOG",
  "PRIVATE_TOOL_DESCRIPTION_DO_NOT_LOG",
  "PRIVATE_ASSISTANT_TEXT_DO_NOT_LOG",
]) {
  assert.equal(output.includes(forbidden), false, `leaked forbidden text: ${forbidden}`);
}
for (const required of [
  "REQUEST_CREATED",
  "PROMPT_BUILD_START",
  "PROMPT_BUILD_COMPLETE",
  "category=MEMORY.md",
  "category=conversation-session-history",
  "category=current-turn-automatic-context",
  "category=tool-definitions",
  "category=tool-search-metadata",
  "category=memory-core-tool-definitions",
  "category=plugin-mcp-tool-definitions",
  "ASSEMBLY_ESTIMATED_TOKENS=",
  "PROVIDER_SEND",
  "QUEUE_WAIT_START",
  "QUEUE_WAIT_COMPLETE",
  "LLAMA_SLOT_ACQUIRED",
  "FIRST_RESPONSE_BYTE",
  "occurred_at=",
  "emitted=retrospective",
  "first_generated_token=NOT_OBSERVABLE",
  "REQUEST_COMPLETE",
  "REQUEST_SUMMARY",
  "REQUEST_TOTAL_MS=",
  "CANCEL_REQUESTED",
  "state=NOT_OBSERVABLE",
  "CANCEL_ACKNOWLEDGED",
  "PROVIDER_REPORTED_INPUT_TOKENS=123",
  "PROVIDER_REPORTED_OUTPUT_TOKENS=3",
]) {
  assert.equal(output.includes(required), true, `missing telemetry: ${required}`);
}
assert.match(output, /\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/u);
assert.equal((output.match(/REQUEST_COMPLETE/gu) || []).length, 2);
assert.equal(output.indexOf("REQUEST_COMPLETE") < output.indexOf("PROVIDER_USAGE"), true);
const completedTotal = Number(output.match(/REQUEST_COMPLETE[^\n]*REQUEST_TOTAL_MS=([0-9.]+)/u)?.[1]);
const summaryTotal = Number(output.match(/REQUEST_SUMMARY[^\n]*REQUEST_TOTAL_MS=([0-9.]+)/u)?.[1]);
assert.equal(completedTotal >= 10, true, `request total lost its start state: ${completedTotal}`);
assert.equal(summaryTotal >= completedTotal, true, `summary total regressed: ${summaryTotal}`);
assert.equal(plugin.__test.metrics("é").bytes, 2);

delete process.env.OPENCLAW_AMS_PROMPT_TELEMETRY;
process.stdout.write(`prompt telemetry self-test passed (${active.lines.length} metadata lines)\n`);
