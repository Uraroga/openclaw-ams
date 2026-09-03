#!/usr/bin/env python3
"""Run one isolated Goal 5K llama.cpp batch measurement on Argo3.

The script is intentionally stdlib-only and stores no benchmark prompt text in
its JSON output. Run it on Argo3, where Docker publishes the temporary server
only on 127.0.0.1:18081.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone


CONTAINER = "goal5k-llama-server"
IMAGE = "local/argo-forge-llama-server-ivybridge:dev"
MODEL_HOST = os.path.expanduser("~/llama-cpp-models/Qwen_Qwen3-14B-Q2_K.gguf")
MODEL_CONTAINER = "/models/Qwen_Qwen3-14B-Q2_K.gguf"
URL = "http://127.0.0.1:18081"
PHRASE = "Vector amber circuit seven measures calm inference throughput under a fixed local benchmark. "
PROMPT = (PHRASE * 150).strip()
SOURCE_TIME = re.compile(r"(?:^|\s)(?P<min>\d+)\.(?P<sec>\d{2})\.(?P<ms>\d{3})\.(?P<us>\d{3})(?:\s|$)")
CANCEL = re.compile(r"cancel task, id_task\s*=\s*(?P<task>\d+)")
LAUNCH = re.compile(r"id\s+(?P<slot>\d+)\s+\|\s+task\s+(?P<task>-?\d+).*processing task, is_child")
RELEASE = re.compile(r"id\s+(?P<slot>\d+)\s+\|\s+task\s+(?P<task>-?\d+).*stop processing: n_tokens\s*=\s*(?P<tokens>\d+)")


def run(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, check=check, text=True, capture_output=True)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def post(path: str, payload: dict, timeout: float) -> dict:
    req = urllib.request.Request(
        URL + path,
        data=json.dumps(payload, separators=(",", ":")).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.load(response)


def package_temp() -> float | None:
    proc = run("sensors", check=False)
    match = re.search(r"Package id 0:\s*\+([0-9.]+)°C", proc.stdout)
    return float(match.group(1)) if match else None


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


def parse_size(value: str) -> int | None:
    match = re.match(r"\s*([0-9.]+)\s*([KMGT]?i?B)", value)
    if not match:
        return None
    factors = {"B": 1, "KB": 1000, "MB": 1000**2, "GB": 1000**3,
               "KiB": 1024, "MiB": 1024**2, "GiB": 1024**3, "TiB": 1024**4}
    return int(float(match.group(1)) * factors[match.group(2)])


class Sampler:
    def __init__(self) -> None:
        self.stop_event = threading.Event()
        self.samples: list[dict] = []
        self.thread = threading.Thread(target=self._loop, daemon=True)

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        self.thread.join(timeout=15)

    def _loop(self) -> None:
        while not self.stop_event.is_set():
            sample = {"at": utc_now(), "package_c": package_temp()}
            inspect = run("docker", "inspect", "-f", "{{.State.Pid}}", CONTAINER, check=False)
            if inspect.returncode == 0 and inspect.stdout.strip().isdigit():
                try:
                    with open(f"/proc/{inspect.stdout.strip()}/status", encoding="utf-8") as handle:
                        status = handle.read()
                    rss = re.search(r"^VmRSS:\s*(\d+)\s+kB", status, re.MULTILINE)
                    sample["rss_kib"] = int(rss.group(1)) if rss else None
                except OSError:
                    sample["rss_kib"] = None
            stats = run("docker", "stats", "--no-stream", "--format", "{{json .}}", CONTAINER, check=False)
            if stats.returncode == 0 and stats.stdout.strip():
                try:
                    data = json.loads(stats.stdout)
                    sample["container_memory_bytes"] = parse_size(data["MemUsage"].split("/")[0])
                    sample["cpu_percent"] = float(data["CPUPerc"].rstrip("%"))
                except (KeyError, ValueError, json.JSONDecodeError):
                    pass
            self.samples.append(sample)
            self.stop_event.wait(4)

    def summary(self) -> dict:
        def values(key: str) -> list[float]:
            return [float(s[key]) for s in self.samples if s.get(key) is not None]
        temps = values("package_c")
        rss = values("rss_kib")
        memory = values("container_memory_bytes")
        cpu = values("cpu_percent")
        return {
            "sample_count": len(self.samples),
            "peak_package_c": max(temps) if temps else None,
            "peak_rss_kib": int(max(rss)) if rss else None,
            "peak_container_memory_bytes": int(max(memory)) if memory else None,
            "avg_cpu_percent": sum(cpu) / len(cpu) if cpu else None,
            "peak_cpu_percent": max(cpu) if cpu else None,
        }


def remove_server() -> None:
    run("docker", "rm", "-f", CONTAINER, check=False)


def start_server(batch: int, ubatch: int) -> None:
    remove_server()
    run(
        "docker", "run", "-d", "--name", CONTAINER,
        "--label", "goal5k.temporary=true",
        "-p", "127.0.0.1:18081:8080",
        "-v", f"{MODEL_HOST}:{MODEL_CONTAINER}:ro",
        IMAGE,
        "--model", MODEL_CONTAINER,
        "--host", "0.0.0.0", "--port", "8080",
        "--ctx-size", "16384", "--threads", "2", "--threads-batch", "2",
        "--n-gpu-layers", "0", "--load-mode", "mmap", "--reasoning", "off",
        "--parallel", "1", "--batch-size", str(batch), "--ubatch-size", str(ubatch),
    )
    for _ in range(240):
        try:
            with urllib.request.urlopen(URL + "/health", timeout=2) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, TimeoutError):
            pass
        time.sleep(1)
    raise RuntimeError("temporary llama-server did not become healthy")


def tokenize_count() -> int:
    data = post("/tokenize", {"content": PROMPT, "add_special": True}, 30)
    return len(data["tokens"])


def completion_payload(prompt: str = PROMPT, n_predict: int = 8) -> dict:
    return {
        "prompt": prompt,
        "n_predict": n_predict,
        "temperature": 0,
        "seed": 1,
        "stream": False,
        "cache_prompt": False,
    }


def server_metadata(batch: int, ubatch: int) -> dict:
    return {
        "measurement_source": "GOAL_5K_MEASUREMENT",
        "measured_at": utc_now(),
        "host": "Argo3",
        "model_file": "Qwen_Qwen3-14B-Q2_K.gguf",
        "model_sha256": "4496a2dc7805120ae48c381e41bc81abee89eb7a82c5f33f72868f5d973e2cb2",
        "llama_cpp_build": 10566,
        "llama_cpp_commit": "bb4caa7540188872173c44d161602d9271386413",
        "context": 16384,
        "threads": 2,
        "threads_batch": 2,
        "gpu_layers": 0,
        "parallel": 1,
        "reasoning": "off",
        "mmap": True,
        "n_batch": batch,
        "n_ubatch": ubatch,
        "output_allowance": 8,
    }


def throughput(batch: int, ubatch: int) -> dict:
    result = server_metadata(batch, ubatch)
    start_server(batch, ubatch)
    result["synthetic_prompt_tokens_from_tokenize"] = tokenize_count()
    result["idle_package_c"] = package_temp()
    sampler = Sampler()
    sampler.start()
    wall_start = time.monotonic_ns()
    response = post("/completion", completion_payload(), 7200)
    wall_end = time.monotonic_ns()
    sampler.stop()
    result["total_request_wall_ms"] = (wall_end - wall_start) / 1_000_000
    result["resource_sampling"] = sampler.summary()
    timings = response.get("timings")
    if not isinstance(timings, dict):
        raise RuntimeError("completion response had no timings object")
    result["prompt_tokens"] = timings.get("prompt_n")
    result["prompt_eval_ms"] = timings.get("prompt_ms")
    result["prompt_tok_s"] = timings.get("prompt_per_second")
    result["generated_tokens"] = timings.get("predicted_n")
    result["generation_ms"] = timings.get("predicted_ms")
    result["generation_tok_s"] = timings.get("predicted_per_second")
    result["response_stop_type"] = response.get("stop_type")
    result["response_truncated"] = response.get("truncated")
    result["response_content_character_count"] = len(response.get("content", ""))
    time.sleep(30)
    result["post_test_package_c"] = package_temp()
    logs = run("docker", "logs", CONTAINER, check=False)
    result["llama_error_line_count"] = sum(
        1 for line in (logs.stdout + logs.stderr).splitlines()
        if re.search(r"\b(error|failed|exception|fatal)\b", line, re.IGNORECASE)
    )
    result["container_running_after_test"] = (
        run("docker", "inspect", "-f", "{{.State.Running}}", CONTAINER, check=False).stdout.strip() == "true"
    )
    remove_server()
    return result


def cancellation_events(logs: str) -> dict:
    launches: list[dict] = []
    cancels: list[dict] = []
    releases: list[dict] = []
    for line in logs.splitlines():
        elapsed = source_ms(line)
        if elapsed is None:
            continue
        if match := LAUNCH.search(line):
            launches.append({"task": int(match["task"]), "slot": int(match["slot"]), "elapsed_ms": elapsed})
        if match := CANCEL.search(line):
            cancels.append({"task": int(match["task"]), "elapsed_ms": elapsed})
        if match := RELEASE.search(line):
            releases.append({"task": int(match["task"]), "slot": int(match["slot"]),
                             "tokens": int(match["tokens"]), "elapsed_ms": elapsed})
    if len(launches) < 2 or not cancels or not releases:
        raise RuntimeError(f"incomplete cancellation lifecycle: launches={launches}, cancels={cancels}, releases={releases}")
    first_task = launches[0]["task"]
    cancel = next(item for item in cancels if item["task"] == first_task)
    release = next(item for item in releases if item["task"] == first_task)
    second = next(item for item in launches[1:] if item["task"] != first_task)
    return {
        "first_request_task": first_task,
        "first_request_launch_elapsed_ms": launches[0]["elapsed_ms"],
        "cancellation_logged_elapsed_ms": cancel["elapsed_ms"],
        "slot_release_elapsed_ms": release["elapsed_ms"],
        "cancel_to_release_ms": release["elapsed_ms"] - cancel["elapsed_ms"],
        "tokens_processed_at_release": release["tokens"],
        "waiting_request_task": second["task"],
        "waiting_request_launch_elapsed_ms": second["elapsed_ms"],
        "release_to_waiting_launch_ms": second["elapsed_ms"] - release["elapsed_ms"],
    }


def cancellation(batch: int, ubatch: int) -> dict:
    result = server_metadata(batch, ubatch)
    result["test_type"] = "controlled_cancellation"
    start_server(batch, ubatch)
    result["synthetic_prompt_tokens_from_tokenize"] = tokenize_count()
    sampler = Sampler()
    sampler.start()
    payload = json.dumps(completion_payload(), separators=(",", ":")).encode()
    request_started = utc_now()
    curl = subprocess.Popen(
        ["curl", "-sS", "--max-time", "2", "-H", "Content-Type: application/json",
         "--data-binary", "@-", URL + "/completion"],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    curl.communicate(payload)
    cancellation_requested = utc_now()
    waiting_started = utc_now()
    waiting_wall_start = time.monotonic_ns()
    waiting = post("/completion", completion_payload("Reply with the single token OK.", 1), 3600)
    waiting_wall_end = time.monotonic_ns()
    sampler.stop()
    result["request_start_wall_at"] = request_started
    result["cancellation_requested_wall_at"] = cancellation_requested
    result["waiting_request_start_wall_at"] = waiting_started
    result["waiting_request_wall_ms"] = (waiting_wall_end - waiting_wall_start) / 1_000_000
    result["waiting_response_generated_tokens"] = waiting.get("timings", {}).get("predicted_n")
    result["resource_sampling"] = sampler.summary()
    logs_proc = run("docker", "logs", CONTAINER, check=False)
    logs = logs_proc.stdout + logs_proc.stderr
    result.update(cancellation_events(logs))
    result["container_running_after_test"] = (
        run("docker", "inspect", "-f", "{{.State.Running}}", CONTAINER, check=False).stdout.strip() == "true"
    )
    remove_server()
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("throughput", "cancel"))
    parser.add_argument("--batch", type=int, required=True)
    parser.add_argument("--ubatch", type=int, required=True)
    args = parser.parse_args()
    if args.batch <= 0 or args.ubatch <= 0 or args.ubatch > args.batch:
        parser.error("require n_batch > 0 and 0 < n_ubatch <= n_batch")
    try:
        measured = throughput(args.batch, args.ubatch) if args.mode == "throughput" else cancellation(args.batch, args.ubatch)
        print("GOAL5K_RESULT=" + json.dumps(measured, sort_keys=True), flush=True)
    finally:
        remove_server()


if __name__ == "__main__":
    main()
