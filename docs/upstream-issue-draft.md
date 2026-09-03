# Draft upstream OpenClaw issue material

This draft is preparation only. It has not been posted to OpenClaw.

## Suggested type

**Feature request**, because the measured cancellation boundary belongs to the
llama.cpp backend, while the actionable OpenClaw opportunity is better
visibility and handling for unusually slow local providers and queued requests.
It should become a bug report only if maintainers identify an OpenClaw contract
that the observed lifecycle violates.

## Suggested title

Improve queue and cancellation visibility for very slow local llama.cpp providers

## Suggested body

We tested OpenClaw v2026.8.1 with a CPU-only llama.cpp backend on a two-core
Ivy Bridge host. One apparently 31-minute successful provider call contained
about 10 minutes 57 seconds of llama.cpp processing and about 20 minutes 50
seconds waiting behind a previously cancelled single-slot task.

OpenClaw-observable behavior:

- provider wall time included both queue/slot wait and backend inference;
- supported hooks could expose provider lifecycle and usage, but not an exact
  cross-process llama.cpp request ID or first-generated-token boundary;
- a user cancellation closed the provider stream and the backend logged the
  queued cancellation.

Backend behavior:

- in pinned llama.cpp build 10566 (`bb4caa754`), the server defers a cancellation
  while synchronous logical `llama_decode` work is active;
- cancellation therefore occurred at logical batch boundaries, not physical
  microbatch boundaries;
- a controlled sweep kept prompt throughput effectively flat while reducing
  cancel-to-release from 1,271.790 s at 2048/512 (historical observation) to
  159.462 s at 256/128, an 87.462% improvement.

This does not establish that OpenClaw causes llama.cpp cancellation semantics.
It suggests that users of slow local providers would benefit from clearer
queue/slot state, separate provider-wait versus active-inference timing, and
possibly configurable warnings or cancellation status when the backend cannot
release immediately.

Reproducible reference material:

- https://github.com/Uraroga/openclaw-ams
- https://github.com/Uraroga/argo-forge

The repositories contain metadata-only telemetry, exact historical/fresh
labels, a machine-readable batch sweep, pinned runtime information, and the
localhost-only transport design. No prompt contents, private memory, model
weights, credentials, or cloud-inference evidence are included.
