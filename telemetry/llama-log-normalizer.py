#!/usr/bin/env python3
"""Normalize metadata-only llama-server lifecycle lines for Goal 5J."""

from __future__ import annotations

import re
import sys
from datetime import datetime


SOURCE_TIME = re.compile(r"(?:^|\s)(?P<min>\d+)\.(?P<sec>\d{2})\.(?P<ms>\d{3})\.(?P<us>\d{3})(?:\s|$)")
DOCKER_TIME = re.compile(r"^(?P<timestamp>\d{4}-\d{2}-\d{2}T\S+Z)\s")
SLOT_TASK = re.compile(r"id\s+(?P<slot>\d+)\s+\|\s+task\s+(?P<task>-?\d+)")
CANCEL = re.compile(r"cancel task, id_task\s*=\s*(?P<task>\d+)")
SELECT = re.compile(r"selected slot by (?P<method>LCP similarity|LRU|id)")
LAUNCH = re.compile(r"processing task, is_child\s*=\s*(?P<child>[01])")
DEFER = re.compile(r"no slot is available, defer task, id_task\s*=\s*(?P<task>\d+)")
PROGRESS = re.compile(
    r"prompt processing, n_tokens\s*=\s*(?P<tokens>\d+), progress\s*=\s*(?P<progress>[0-9.]+),"
    r"\s*t\s*=\s*(?P<seconds>[0-9.]+)\s*s\s*/\s*(?P<speed>[0-9.]+)\s*tokens per second"
)
PROMPT_DONE = re.compile(
    r"prompt eval time\s*=\s*(?P<ms>[0-9.]+)\s*ms\s*/\s*(?P<tokens>\d+)\s*tokens"
    r".*?\(.*?,\s*(?P<speed>[0-9.]+)\s*tokens per second\)"
)
GEN_DONE = re.compile(
    r"(?<!prompt )eval time\s*=\s*(?P<ms>[0-9.]+)\s*ms\s*/\s*(?P<tokens>\d+)\s*tokens"
    r".*?\(.*?,\s*(?P<speed>[0-9.]+)\s*tokens per second\)"
)
TOTAL = re.compile(r"total time\s*=\s*(?P<ms>[0-9.]+)\s*ms\s*/\s*(?P<tokens>\d+)\s*tokens")
RELEASE = re.compile(r"stop processing: n_tokens\s*=\s*(?P<tokens>\d+), truncated\s*=\s*(?P<truncated>[01])")


def source_ms(line: str) -> float | None:
    match = SOURCE_TIME.search(line)
    if not match:
        return None
    return (
        int(match["min"]) * 60_000
        + int(match["sec"]) * 1_000
        + int(match["ms"])
        + int(match["us"]) / 1_000
    )


def received_at() -> str:
    return datetime.now().astimezone().isoformat(timespec="milliseconds")


_current_source_wall: str | None = None


def value(number: float | int | None) -> str | None:
    if number is None:
        return None
    if isinstance(number, float):
        return f"{number:.3f}".rstrip("0").rstrip(".")
    return str(number)


def emit(event: str, **fields: object) -> None:
    if _current_source_wall is not None:
        fields = {"source_wall_at": _current_source_wall, **fields}
    rendered = " ".join(
        f"{key}={str(item).replace(' ', '_')}"
        for key, item in fields.items()
        if item is not None and item != ""
    )
    print(f"[{received_at()}] [LLAMA] {event}{' ' + rendered if rendered else ''}", flush=True)


class Normalizer:
    def __init__(self) -> None:
        self.tasks: dict[int, dict[str, object]] = {}
        self.selected: dict[int, str] = {}

    def task_state(self, task: int) -> dict[str, object]:
        return self.tasks.setdefault(task, {"cancel_times": []})

    def process(self, line: str) -> None:
        global _current_source_wall
        wall_match = DOCKER_TIME.search(line)
        _current_source_wall = wall_match["timestamp"] if wall_match else None
        elapsed = source_ms(line)
        slot_task = SLOT_TASK.search(line)
        slot = int(slot_task["slot"]) if slot_task else None
        task = int(slot_task["task"]) if slot_task else None

        match = DEFER.search(line)
        if match:
            deferred_task = int(match["task"])
            state = self.task_state(deferred_task)
            state.setdefault("queue_start_ms", elapsed)
            emit("QUEUE_WAIT_START", task=deferred_task, llama_elapsed_ms=value(elapsed), observability="MEASURED_LOG_EVENT")
            return

        match = SELECT.search(line)
        if match and slot is not None:
            method = match["method"].replace(" ", "_")
            self.selected[slot] = method
            emit(
                "SLOT_SELECTED",
                slot=slot,
                policy=method,
                slot_reused="yes" if method == "LCP_similarity" else "unknown",
                llama_elapsed_ms=value(elapsed),
            )
            return

        match = LAUNCH.search(line)
        if match and task is not None and slot is not None:
            state = self.task_state(task)
            state.update(slot=slot, launch_ms=elapsed, selection=self.selected.get(slot, "unknown"))
            queue_start = state.get("queue_start_ms")
            queue_ms = elapsed - queue_start if isinstance(queue_start, float) and elapsed is not None else None
            emit(
                "LLAMA_SLOT_ACQUIRED",
                slot=slot,
                task=task,
                is_child=match["child"],
                llama_elapsed_ms=value(elapsed),
                QUEUE_OR_SLOT_WAIT_MS=value(queue_ms) if queue_ms is not None else "NOT_OBSERVABLE",
            )
            emit(
                "PROMPT_EVAL_START",
                slot=slot,
                task=task,
                llama_elapsed_ms=value(elapsed),
                observability="INFERRED_FROM_SLOT_LAUNCH",
            )
            return

        match = CANCEL.search(line)
        if match:
            cancelled_task = int(match["task"])
            state = self.task_state(cancelled_task)
            cancel_times = state.setdefault("cancel_times", [])
            assert isinstance(cancel_times, list)
            cancel_times.append(elapsed)
            emit(
                "CANCEL_ACKNOWLEDGED",
                task=cancelled_task,
                llama_elapsed_ms=value(elapsed),
                source="llama_http_reader_enqueued_cancel",
                note="slot_release_may_wait_for_active_decode",
            )
            emit("CANCEL_WAITING_FOR_SLOT_RELEASE", task=cancelled_task)
            return

        match = PROGRESS.search(line)
        if match and task is not None:
            state = self.task_state(task)
            state["last_progress_tokens"] = int(match["tokens"])
            emit(
                "PROMPT_EVAL_PROGRESS",
                slot=slot,
                task=task,
                ACTUAL_PROMPT_EVAL_TOKENS=match["tokens"],
                progress=match["progress"],
                PROMPT_EVAL_MS=value(float(match["seconds"]) * 1000),
                prompt_eval_tok_s=match["speed"],
                llama_elapsed_ms=value(elapsed),
            )
            return

        match = PROMPT_DONE.search(line)
        if match and task is not None:
            state = self.task_state(task)
            state.update(prompt_ms=float(match["ms"]), prompt_tokens=int(match["tokens"]), prompt_speed=float(match["speed"]))
            emit(
                "PROMPT_EVAL_COMPLETE",
                slot=slot,
                task=task,
                ACTUAL_PROMPT_EVAL_TOKENS=match["tokens"],
                PROMPT_EVAL_MS=match["ms"],
                prompt_eval_tok_s=match["speed"],
                llama_elapsed_ms=value(elapsed),
            )
            emit("GENERATION_START", slot=slot, task=task, observability="INFERRED_FROM_TIMING_BOUNDARY")
            return

        match = GEN_DONE.search(line)
        if match and task is not None:
            state = self.task_state(task)
            state.update(gen_ms=float(match["ms"]), generated_tokens=int(match["tokens"]), gen_speed=float(match["speed"]))
            emit(
                "GENERATION_COMPLETE",
                slot=slot,
                task=task,
                ACTUAL_GENERATED_TOKENS=match["tokens"],
                GENERATION_MS=match["ms"],
                generation_tok_s=match["speed"],
                llama_elapsed_ms=value(elapsed),
            )
            return

        match = TOTAL.search(line)
        if match and task is not None:
            state = self.task_state(task)
            state["llama_total_ms"] = float(match["ms"])
            emit("LLAMA_PROCESSING_COMPLETE", slot=slot, task=task, LLAMA_TOTAL_MS=match["ms"], llama_elapsed_ms=value(elapsed))
            return

        match = RELEASE.search(line)
        if match and task is not None:
            state = self.task_state(task)
            cancel_times = [item for item in state.get("cancel_times", []) if isinstance(item, float)]
            first_cancel_ms = elapsed - cancel_times[0] if elapsed is not None and cancel_times else None
            last_cancel_ms = elapsed - cancel_times[-1] if elapsed is not None and cancel_times else None
            emit(
                "SLOT_RELEASED",
                slot=slot,
                task=task,
                final_context_tokens=match["tokens"],
                truncated=match["truncated"],
                llama_elapsed_ms=value(elapsed),
                CANCEL_TO_SLOT_RELEASE_MS=value(first_cancel_ms) if first_cancel_ms is not None else None,
                LAST_CANCEL_TO_SLOT_RELEASE_MS=value(last_cancel_ms) if last_cancel_ms is not None else None,
                TOKENS_PROCESSED_AFTER_CANCEL="NOT_OBSERVABLE" if cancel_times else None,
            )
            emit(
                "LLAMA_TASK_SUMMARY",
                slot=slot,
                task=task,
                QUEUE_OR_SLOT_WAIT_MS="NOT_OBSERVABLE" if "queue_start_ms" not in state else value(float(state["launch_ms"]) - float(state["queue_start_ms"])),
                PROMPT_EVAL_MS=value(state.get("prompt_ms")),
                GENERATION_MS=value(state.get("gen_ms")),
                CANCEL_TO_SLOT_RELEASE_MS=value(first_cancel_ms),
                LLAMA_TOTAL_MS=value(state.get("llama_total_ms")),
                prompt_eval_tokens=state.get("prompt_tokens"),
                prompt_eval_tok_s=value(state.get("prompt_speed")),
                generated_tokens=state.get("generated_tokens"),
                generation_tok_s=value(state.get("gen_speed")),
                cancel_requested="yes" if cancel_times else "no",
                slot_reused="yes" if state.get("selection") == "LCP_similarity" else "unknown",
            )
            self.tasks.pop(task, None)


def main() -> None:
    normalizer = Normalizer()
    for line in sys.stdin:
        normalizer.process(line.rstrip("\n"))


if __name__ == "__main__":
    main()
