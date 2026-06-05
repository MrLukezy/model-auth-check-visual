from __future__ import annotations

import asyncio
import csv
import json
import logging
import random
import re
import time
import uuid
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from auth_check import register_auth_routes

# Set up logging - write ONLY to file. StreamHandler (stderr) is deliberately
# removed because this process runs as a Tauri subprocess, and excessive
# stderr output from httpx's own INFO-level HTTP logging (~4000 lines per run)
# fills the pipe buffer, blocking the event loop and killing the process.
LOG_PATH = Path(__file__).parent / "server.log"
_log_handler = logging.FileHandler(LOG_PATH, encoding="utf-8")
_log_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
log = logging.getLogger("server")
log.setLevel(logging.INFO)
log.addHandler(_log_handler)
DATA_PATH = Path(__file__).parent / "data.json"
RESULTS_PATH = Path(__file__).parent / "results.json"

# Locate the question bank. Two layouts are supported:
#   Portable (distribution): backend/server.py -> ../data/all_questions.csv
#   Dev (source tree):       visual-tool/backend/server.py -> ../../../data/all_questions.csv
_SERVER_DIR = Path(__file__).resolve().parent
_PORTABLE_DATA = _SERVER_DIR.parent / "data" / "all_questions.csv"
_DEV_DATA = _SERVER_DIR.parents[1] / "data" / "all_questions.csv"
QUESTION_BANK_PATH = _PORTABLE_DATA if _PORTABLE_DATA.exists() else _DEV_DATA

CATEGORIES_V2 = {
    "coding_cs":          {"chinese": "编程与计算机"},
    "math_reasoning":     {"chinese": "数学推理"},
    "logical_reasoning":  {"chinese": "逻辑推理"},
    "safety_guard":       {"chinese": "安全检测"},
    "common_science":     {"chinese": "常识与科学"},
    "game_dev":           {"chinese": "游戏开发"},
    "emotion_psychology": {"chinese": "情感与心理"},
    "language_logic":     {"chinese": "语言与推理"},
}

PROFILES = {
    "full": {
        "desc": "全部8类等比例",
        "cats": {c: 1 for c in CATEGORIES_V2},
    },
    "programmer": {
        "desc": "编程25%+数学20%+逻辑20%+游戏15%+安全10%+常识10%",
        "cats": {
            "coding_cs": 25, "math_reasoning": 20, "logical_reasoning": 20,
            "game_dev": 15, "safety_guard": 10, "common_science": 10,
        },
    },
    "math_logic": {
        "desc": "数学30%+逻辑30%+编程20%+常识20%",
        "cats": {
            "math_reasoning": 30, "logical_reasoning": 30,
            "coding_cs": 20, "common_science": 20,
        },
    },
    "safety": {
        "desc": "安全45%+语言25%+心理15%+常识15%",
        "cats": {
            "safety_guard": 45, "language_logic": 25,
            "emotion_psychology": 15, "common_science": 15,
        },
    },
    "quick": {
        "desc": "编程25%+数学25%+逻辑20%+常识20%+安全10%",
        "cats": {
            "coding_cs": 25, "math_reasoning": 25, "logical_reasoning": 20,
            "common_science": 20, "safety_guard": 10,
        },
    },
}

SYSTEM_PROMPT = (
    "【系统指令：你是一个精确的答题机器，必须只输出单个答案"
    "（如 A、B、C、D 或 Yes、No 或一个数字），"
    "禁止输出任何解释、分析、标点或换行。违反此规则的回答将被视为无效。】\n\n"
)



import re
from urllib.parse import urlparse, urlunparse


_NON_API_PATHS = {
    "console", "panel", "admin", "dashboard", "log",
    "token", "topup", "setting", "channel", "redemption",
    "user", "subscription", "docs", "about", "pricing",
    "playground", "midjourney", "task", "personal",
    "detail", "deployment", "profile",
}

_API_SUBPATH_SEGMENTS = {
    "images", "generations", "completions", "embeddings",
    "chat", "edits", "transcriptions", "translations",
    "audio", "fine-tuning", "fine_tuning", "files",
    "threads", "assistants", "runs", "batches",
    "realtime", "responses",
}


def _normalize_base_url(raw: str) -> str:
    raw = raw.strip().rstrip("/")
    parsed = urlparse(raw)
    if not parsed.scheme:
        raw = "https://" + raw
        parsed = urlparse(raw)
    segments = [s for s in parsed.path.split("/") if s]
    cleaned = []
    for seg in segments:
        low = seg.lower()
        if low in ("v1", "v2", "v3", "v4"):
            cleaned.append(seg)
            break
        if low in _NON_API_PATHS:
            break
        if low in _API_SUBPATH_SEGMENTS:
            break
        cleaned.append(seg)
    new_path = "/" + "/".join(cleaned) if cleaned else ""
    return urlunparse(parsed._replace(path=new_path))


def _api_url(base: str, path: str) -> str:
    base = _normalize_base_url(base)
    base = base.rstrip("/")
    if base.endswith("/v1"):
        base = base[:-3]
    return base + path


def _load_question_bank() -> dict[str, list[dict]]:
    by_cat: dict[str, list[dict]] = defaultdict(list)
    if not QUESTION_BANK_PATH.exists():
        return by_cat
    with open(QUESTION_BANK_PATH, "r", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            by_cat[row.get("category", "common_science")].append(row)
    return by_cat


def _sample_questions(
    by_cat: dict[str, list[dict]],
    total: int,
    profile: str,
    seed: int | None,
) -> tuple[list[dict], dict[str, int]]:
    rng = random.Random(seed)
    cat_ratios = PROFILES.get(profile, PROFILES["full"])["cats"]
    total_ratio = sum(cat_ratios.values())
    targets: dict[str, int] = {}
    for cat, ratio in cat_ratios.items():
        targets[cat] = max(0, int(total * ratio / total_ratio))
    diff = total - sum(targets.values())
    if diff != 0:
        max_cat = max(cat_ratios, key=cat_ratios.get)
        targets[max_cat] += diff

    sampled: list[dict] = []
    stats: dict[str, int] = {}
    for cat, target in targets.items():
        pool = by_cat.get(cat, [])
        if not pool:
            stats[cat] = 0
            continue
        pick = rng.sample(pool, min(target, len(pool)))
        sampled.extend(pick)
        stats[cat] = len(pick)

    if len(sampled) < total:
        all_items = [q for qs in by_cat.values() for q in qs]
        extra = rng.sample(all_items, min(total - len(sampled), len(all_items)))
        sampled.extend(extra)

    rng.shuffle(sampled)
    return sampled[:total], stats


app = FastAPI(title="Real-O-Meter API · 模型测试器")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

register_auth_routes(app)


class ProviderCreate(BaseModel):
    name: str
    base_url: str
    api_key: str


class TestRunRequest(BaseModel):
    model_ids: list[str]
    num_tests: int = 100
    profile: str = "programmer"
    seed: Optional[int] = None


providers: dict[str, dict] = {}
models: dict[str, dict] = {}
question_bank: dict[str, list[dict]] = {}


def _load() -> None:
    global question_bank, test_queue
    if DATA_PATH.exists():
        with open(DATA_PATH, encoding="utf-8") as f:
            data = json.load(f)
        providers.clear()
        providers.update(data.get("providers", {}))
        models.clear()
        models.update(data.get("models", {}))
        # Restore test queue: only keep ids whose models still exist
        persisted_queue_ids = data.get("queue_ids", [])
        test_queue = [
            models[fid] for fid in persisted_queue_ids if fid in models
        ]
    question_bank = _load_question_bank()
    _load_results()


def _save() -> None:
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    queue_ids = [item["id"] for item in test_queue]
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(
            {"providers": providers, "models": models, "queue_ids": queue_ids},
            f,
            indent=2,
        )


def _load_results() -> None:
    global test_results
    if RESULTS_PATH.exists():
        try:
            with open(RESULTS_PATH, encoding="utf-8") as f:
                test_results = json.load(f)
        except (json.JSONDecodeError, OSError):
            test_results = []
    else:
        test_results = []


def _save_results() -> None:
    try:
        RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(RESULTS_PATH, "w", encoding="utf-8") as f:
            json.dump(test_results, f, indent=2, ensure_ascii=False)
    except OSError as e:
        print(f"[warn] failed to save results: {e}")


@app.on_event("startup")
async def startup() -> None:
    _load()


@app.get("/api/providers")
async def list_providers():
    return list(providers.values())


@app.post("/api/providers", status_code=201)
async def create_provider(data: ProviderCreate):
    pid = str(uuid.uuid4())
    if any(p["name"] == data.name for p in providers.values()):
        raise HTTPException(400, f"Provider '{data.name}' already exists")
    providers[pid] = {
        "id": pid,
        "name": data.name,
        "base_url": _normalize_base_url(data.base_url),
        "api_key": data.api_key,
        "created_at": datetime.now().isoformat(),
    }
    _save()
    return providers[pid]


@app.delete("/api/providers/{pid}")
async def delete_provider(pid: str):
    if pid not in providers:
        raise HTTPException(404, "Provider not found")
    to_del = [m for m, d in models.items() if d.get("provider_id") == pid]
    for m in to_del:
        del models[m]
    del providers[pid]
    _save()
    return {"ok": True}


@app.get("/api/providers/{pid}/models")
async def fetch_provider_models(pid: str):
    if pid not in providers:
        raise HTTPException(404, "Provider not found")
    p = providers[pid]
    base = _normalize_base_url(p["base_url"])
    headers = {"Authorization": f"Bearer {p['api_key']}"}

    tried: list[str] = []
    last_status: int = 0
    last_body: str = ""

    model_paths = (
        "/v1/models",
        "/v1/models/list",
        "/api/models",
        "/models",
        "/api/v1/models",
    )

    for verify_ssl in (True, False):
        async with httpx.AsyncClient(
            timeout=30,
            verify=verify_ssl,
            follow_redirects=True,
        ) as client:
            for path in model_paths:
                url = _api_url(base, path)
                tried.append(url)
                try:
                    r = await client.get(url, headers=headers)
                    last_status = r.status_code
                    last_body = (r.text or "")[:300]

                    if r.status_code == 200:
                        body = r.json()
                        items = body if isinstance(body, list) else body.get("data", [])
                        result = []
                        for item in items:
                            mid = item.get("id") or item.get("name") or ""
                            if not mid:
                                continue
                            fpk = f"{pid}:{mid}"
                            models[fpk] = {
                                "id": fpk,
                                "provider_id": pid,
                                "provider_name": p["name"],
                                "model_id": mid,
                                "owned_by": item.get("owned_by", ""),
                            }
                            result.append(models[fpk])
                        _save()
                        return result
                    elif r.status_code == 401:
                        raise HTTPException(
                            401,
                            f"Authentication failed (401) for {url}. "
                            f"Check your API key. Response: {last_body[:150]}",
                        )
                    elif r.status_code == 403:
                        raise HTTPException(
                            403,
                            f"Access denied (403) for {url}. "
                            f"Your API key may lack permission to list models. Response: {last_body[:150]}",
                        )
                except httpx.ConnectError as e:
                    log.warning("[models] connect error for %s: %s", url, e)
                    continue
                except httpx.HTTPError as e:
                    log.warning("[models] HTTP error for %s: %s", url, e)
                    continue

    detail = f"Last status: {last_status}"
    if last_body:
        detail += f", body: {last_body[:150]}"
    raise HTTPException(
        400,
        f"Could not fetch models from {base}. "
        f"Tried {len(tried)} URLs. {detail}",
    )


@app.get("/api/models")
async def list_models(provider_id: Optional[str] = None):
    all_m = list(models.values())
    if provider_id:
        all_m = [m for m in all_m if m["provider_id"] == provider_id]
    return all_m


@app.delete("/api/models/{fid}")
async def delete_model(fid: str):
    if fid not in models:
        raise HTTPException(404, "Model not found")
    del models[fid]
    _save()
    return {"ok": True}


test_queue: list[dict] = []
test_results: list[dict] = []

# Active test runs that can be cancelled. Key is run_id, value is an asyncio.Event
# that fires when the run should stop. We use a dict instead of a set because
# asyncio.Event lets workers wait/cooperate efficiently, and we can pass the event
# down to each worker.
active_runs: dict[str, asyncio.Event] = {}

# Global diagnostic state - tracks in-flight requests per model so we can
# see where workers are stuck if the server appears to freeze.
run_diagnostics: dict[str, dict] = {
    "current_run": None,
    "model_state": {},  # full_id -> {completed, total, last_activity, in_flight}
    "event_loop_load": 0.0,
    "last_heartbeat": 0.0,
    "start_time": 0.0,
    "requests_total": 0,
    "requests_failed": 0,
}


@app.get("/api/debug")
async def debug_state():
    """Expose internal state for diagnosing freezes. Call manually when
    the UI shows 'Backend starting...' but no errors are visible."""
    now = time.time()
    loop_lag = now - run_diagnostics["last_heartbeat"]
    return {
        "server_time": datetime.now().isoformat(),
        "loop_lag_s": round(loop_lag, 2),
        "active_runs": list(active_runs.keys()),
        "run_diagnostics": run_diagnostics,
        "queue_size": len(test_queue),
        "results_count": len(test_results),
        "providers": len(providers),
        "log_path": str(LOG_PATH),
    }
# asyncio.Event lets workers wait/cooperate efficiently, and we can pass the event
# down to each worker.
active_runs: dict[str, asyncio.Event] = {}


def _normalize(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _strip_think(s: str) -> str:
    s = re.sub(r"", "", s, flags=re.IGNORECASE | re.DOTALL)
    s = re.sub(r"", "", s, flags=re.IGNORECASE | re.DOTALL)
    s = re.sub(r"", "", s, flags=re.IGNORECASE | re.DOTALL)
    return s.strip()


def _extract_answer(raw: str, expected: str) -> str:
    cleaned = _strip_think(raw)
    if not cleaned:
        return raw.strip()
    if _normalize(cleaned) == _normalize(expected):
        return cleaned
    lines = [l.strip() for l in cleaned.splitlines() if l.strip()]
    for line in lines:
        if _normalize(line) == _normalize(expected):
            return line
    if lines:
        candidate = lines[0].split()[0] if lines[0].split() else lines[0]
        if _normalize(candidate) == _normalize(expected):
            return candidate
    if _normalize(expected) in _normalize(cleaned):
        start = _normalize(cleaned).index(_normalize(expected))
        end = start + len(_normalize(expected))
        return cleaned[start:end] if start < len(cleaned) else cleaned
    return cleaned[:80] if len(cleaned) > 80 else cleaned


@app.post("/api/test/queue")
async def add_to_queue(model_full_ids: list[str]):
    added = []
    for fid in model_full_ids:
        if fid not in models:
            continue
        if any(q["id"] == fid for q in test_queue):
            continue
        test_queue.append(models[fid])
        added.append(fid)
    if added:
        _save()
    return {"added": added, "queue_size": len(test_queue)}


@app.get("/api/test/queue")
async def get_queue():
    return test_queue


@app.delete("/api/test/queue/{fid}")
async def remove_from_queue(fid: str):
    global test_queue
    before = len(test_queue)
    test_queue = [x for x in test_queue if x["id"] != fid]
    if len(test_queue) < before:
        _save()
    return {"removed": before - len(test_queue), "queue_size": len(test_queue)}


@app.get("/api/test/bank")
async def get_bank_stats():
    total = sum(len(v) for v in question_bank.values())
    cats = {
        cat: len(qs)
        for cat, qs in question_bank.items()
    }
    return {
        "total": total,
        "categories": cats,
        "loaded": total > 0,
        "profiles": {k: {"desc": v["desc"], "cats": list(v["cats"].keys())} for k, v in PROFILES.items()},
    }


@app.post("/api/test/run")
async def run_test(req: TestRunRequest):
    targets = [models[fid] for fid in req.model_ids if fid in models]
    if not targets:
        raise HTTPException(400, "No valid models to test")

    bank_total = sum(len(v) for v in question_bank.values())
    if bank_total == 0:
        raise HTTPException(
            500,
            "Question bank not loaded. Ensure data/all_questions.csv exists at "
            f"{QUESTION_BANK_PATH}",
        )

    seed = req.seed if req.seed is not None else int(time.time())
    sampled, cat_stats = _sample_questions(question_bank, req.num_tests, req.profile, seed)

    if not sampled:
        raise HTTPException(500, "No questions sampled from the bank")

    run_id = str(uuid.uuid4())[:8]

    # Start test as a background asyncio task — no more SSE streaming.
    # The frontend polls GET /api/test/progress/{run_id} for live updates.
    asyncio.create_task(
        _run_test_background(run_id, targets, sampled, cat_stats, req.num_tests, req.profile, seed)
    )
    return {"run_id": run_id, "num_tests": req.num_tests, "num_models": len(targets)}


@app.post("/api/test/cancel/{run_id}")
async def cancel_run(run_id: str):
    """Cancel a running test. The workers will stop before the next batch."""
    event = active_runs.get(run_id)
    if event is None:
        return {"ok": False, "run_id": run_id, "reason": "Run not found or already finished"}
    event.set()
    return {"ok": True, "run_id": run_id}


@app.get("/api/test/progress/{run_id}")
async def get_progress(run_id: str):
    """Polling endpoint for live test progress. Returns current state of all
    models and completion status without requiring a long-lived connection."""
    is_active = run_id in active_runs
    model_state = run_diagnostics.get("model_state", {})
    models = []
    total_completed = 0
    total_questions = 0
    for fid, st in model_state.items():
        comp = st.get("completed", 0)
        total = st.get("total", 0)
        models.append({
            "full_id": fid,
            "model_id": st.get("model_id", "?"),
            "provider_name": st.get("provider_name", "?"),
            "completed": comp,
            "passed": st.get("passed", 0),
            "total": total,
            "in_flight": st.get("in_flight", 0),
        })
        total_completed += comp
        total_questions += total

    run_results = [r for r in test_results if r.get("run_id") == run_id]

    return {
        "run_id": run_id,
        "running": is_active,
        "completed": len(run_results) > 0,
        "total_completed": total_completed,
        "total_questions": total_questions,
        "models": models,
        "elapsed_s": time.time() - run_diagnostics.get("start_time", time.time()),
    }


async def _run_test_background(run_id: str, targets: list[dict], sampled: list[dict],
                           cat_stats: dict[str, int], num_tests: int, profile: str, seed: int):
    global_semaphore = asyncio.Semaphore(150)
    results: dict[str, dict] = {}

    # Register this run as cancellable.
    cancel_event = asyncio.Event()
    active_runs[run_id] = cancel_event

    # Calculate per-model concurrency based on total models
    # Keep it moderate to avoid event loop saturation
    per_model_limit = min(20, max(3, 150 // len(targets)))

    async def test_single_question(client: httpx.AsyncClient, model_info: dict,
                                    provider: dict, question: dict,
                                   cancel_event: asyncio.Event,
                                   max_retries: int = 2,
                                   total_timeout_s: float = 30.0) -> dict:
        model_id = model_info["model_id"]
        url = _api_url(provider["base_url"], "/v1/chat/completions")
        headers = {
            "Authorization": f"Bearer {provider['api_key']}",
            "Content-Type": "application/json",
        }

        prompt = SYSTEM_PROMPT + question["question"].strip()
        expected = question["answer"].strip()
        category = question.get("category", "common_science")

        def _cancelled_result(attempt: int) -> dict:
            elapsed = (time.perf_counter() - start) * 1000
            return {
                "prompt": question["question"][:120],
                "expected": expected,
                "actual": None,
                "correct": False,
                "error": "Cancelled by user",
                "latency_ms": elapsed,
                "category": category,
                "retries": attempt,
                "timed_out": False,
                "cancelled": True,
            }

        def _timeout_result(attempt: int, error_msg: str) -> dict:
            elapsed = (time.perf_counter() - start) * 1000
            return {
                "prompt": question["question"][:120],
                "expected": expected,
                "actual": None,
                "correct": False,
                "error": error_msg,
                "latency_ms": elapsed,
                "category": category,
                "retries": attempt,
                "timed_out": True,
            }

        start = time.perf_counter()
        last_error = None

        for attempt in range(max_retries):
            # Check cancellation at start of each retry
            if cancel_event.is_set():
                return _cancelled_result(attempt)

            # Check total elapsed against total timeout
            elapsed_s = time.perf_counter() - start
            remaining_s = total_timeout_s - elapsed_s
            if remaining_s <= 1.0:
                return _timeout_result(attempt, f"Total timeout ({total_timeout_s:.0f}s)")

            per_attempt_timeout = min(30.0, remaining_s - 0.5)
            if per_attempt_timeout < 2.0:
                per_attempt_timeout = 2.0

            req_id = run_diagnostics["requests_total"]
            run_diagnostics["requests_total"] += 1
            full_id = model_info["id"]

            # Acquire semaphore only during the actual HTTP request,
            # NOT during retry sleep between attempts.
            sem_wait_start = time.perf_counter()
            async with global_semaphore:
                sem_wait_s = time.perf_counter() - sem_wait_start
                if sem_wait_s > 1.0:
                    sem_avail = getattr(global_semaphore, "_value", "?")
                    log.warning(
                        "[sem] %s waited %.2fs for global_semaphore (avail=%s, in_flight ~%d)",
                        model_id, sem_wait_s, sem_avail,
                        150 - sem_avail if isinstance(sem_avail, int) else -1,
                    )
                state = run_diagnostics["model_state"].get(full_id)
                if state is not None:
                    state["last_activity"] = time.time()
                    state["in_flight"] = state.get("in_flight", 0) + 1

                log.info(
                    "[req %d] %s attempt=%d timeout=%.1fs qid=%s",
                    req_id, model_id, attempt, per_attempt_timeout,
                    question.get("id", "?"),
                )
                r = None
                try:
                    r = await client.post(
                        url,
                        headers=headers,
                        json={
                            "model": model_id,
                            "messages": [{"role": "user", "content": prompt}],
                            "temperature": 0,
                            "max_tokens": 512,
                        },
                        timeout=per_attempt_timeout,
                    )
                except (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.TimeoutException) as e:
                    log.warning("[req %d] %s timeout exception: %s (%.2fs elapsed)",
                                req_id, model_id, e, time.perf_counter() - start)
                    run_diagnostics["requests_failed"] += 1
                    run_diagnostics["last_heartbeat"] = time.time()
                    if state is not None:
                        state["in_flight"] = max(0, state.get("in_flight", 1) - 1)
                except httpx.HTTPError as e:
                    log.warning("[req %d] %s HTTPError: %s", req_id, model_id, e)
                    run_diagnostics["requests_failed"] += 1
                    run_diagnostics["last_heartbeat"] = time.time()
                    if state is not None:
                        state["in_flight"] = max(0, state.get("in_flight", 1) - 1)
                else:
                    run_diagnostics["last_heartbeat"] = time.time()
                    if state is not None:
                        state["in_flight"] = max(0, state.get("in_flight", 1) - 1)
            # --- semaphore released at this point ---

            # After semaphore release: process any exception or response
            if r is None:
                # Exception occurred inside semaphore
                if cancel_event.is_set():
                    return _cancelled_result(attempt + 1)
                last_error = f"Timeout ({per_attempt_timeout:.0f}s)"
                total_elapsed = time.perf_counter() - start
                if total_elapsed >= total_timeout_s or attempt >= max_retries - 1:
                    return _timeout_result(
                        attempt,
                        f"Total timeout ({total_timeout_s:.0f}s)"
                        if total_elapsed >= total_timeout_s
                        else f"Timeout ({per_attempt_timeout:.0f}s)",
                    )
                # Interruptible sleep (semaphore NOT held)
                sleep_total = 0.5 * (attempt + 1)
                sleep_step = 0.1
                while sleep_total > 0 and not cancel_event.is_set():
                    await asyncio.sleep(min(sleep_step, sleep_total))
                    sleep_total -= sleep_step
                if cancel_event.is_set():
                    return _cancelled_result(attempt + 1)
                continue

            log.info("[req %d] %s status=%d (took %.2fs)",
                     req_id, model_id, r.status_code,
                     time.perf_counter() - start)

            if cancel_event.is_set():
                return _cancelled_result(attempt)

            # 如果状态码不是 200，记录错误并继续重试
            if r.status_code != 200:
                last_error = f"HTTP {r.status_code}"
                log.warning("[req %d] %s HTTP error %d body=%s",
                            req_id, model_id, r.status_code,
                            (r.text or "")[:500])
                run_diagnostics["requests_failed"] += 1
                if attempt < max_retries - 1:
                    # Sleep (semaphore NOT held)
                    sleep_total = 0.5 * (attempt + 1)
                    sleep_step = 0.1
                    while sleep_total > 0 and not cancel_event.is_set():
                        await asyncio.sleep(min(sleep_step, sleep_total))
                        sleep_total -= sleep_step
                    if cancel_event.is_set():
                        return _cancelled_result(attempt + 1)
                    continue
                else:
                    elapsed = (time.perf_counter() - start) * 1000
                    return {
                        "prompt": question["question"][:120],
                        "expected": expected,
                        "actual": None,
                        "correct": False,
                        "error": last_error,
                        "latency_ms": elapsed,
                        "category": category,
                        "retries": attempt,
                        "timed_out": False,
                    }

            # 成功获取响应，解析内容
            try:
                body_json = r.json()
            except Exception as json_err:
                log.warning(
                    "[req %d] %s r.json() failed: %s body=%s",
                    req_id, model_id, json_err,
                    (r.text or "")[:200],
                )
                run_diagnostics["requests_failed"] += 1
                last_error = f"JSON parse error: {json_err}"
                if attempt < max_retries - 1:
                    sleep_total = 0.5 * (attempt + 1)
                    sleep_step = 0.1
                    while sleep_total > 0 and not cancel_event.is_set():
                        await asyncio.sleep(min(sleep_step, sleep_total))
                        sleep_total -= sleep_step
                    if cancel_event.is_set():
                        return _cancelled_result(attempt + 1)
                    continue
                else:
                    elapsed = (time.perf_counter() - start) * 1000
                    return {
                        "prompt": question["question"][:120],
                        "expected": expected,
                        "actual": None,
                        "correct": False,
                        "error": last_error,
                        "latency_ms": elapsed,
                        "category": category,
                        "retries": attempt,
                        "timed_out": False,
                    }
            content = (
                body_json
                .get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
            )
            content_stripped = _extract_answer(content, expected)
            ok = _normalize(content_stripped) == _normalize(expected)
            elapsed = (time.perf_counter() - start) * 1000

            return {
                "prompt": question["question"][:120],
                "expected": expected,
                "actual": content_stripped,
                "correct": ok,
                "error": None,
                "latency_ms": elapsed,
                "category": category,
                "retries": attempt,
                "timed_out": False,
            }

        # Fallback (should not be reached)
        return _timeout_result(max_retries - 1, last_error or "Unknown error")

    async def test_model_worker(model_info: dict, model_semaphore: asyncio.Semaphore):
        # full_id is the unique key "provider_id:model_id" so that models with the
        # same name from different providers don't collide in the result dict or
        # the progress stream.
        full_id = model_info["id"]
        model_id = model_info["model_id"]
        provider_name = model_info.get("provider_name", "unknown")
        provider_id = model_info.get("provider_id")
        provider = providers.get(provider_id)
        worker_start_time = time.perf_counter()

        # Initialize diagnostic state for this worker
        run_diagnostics["model_state"][full_id] = {
            "model_id": model_id,
            "provider_name": provider_name,
            "completed": 0,
            "passed": 0,
            "total": len(sampled),
            "in_flight": 0,
            "last_activity": time.time(),
            "started_at": time.time(),
        }

        if not provider:
            result = {
                "id": full_id,
                "model_id": model_id,
                "provider_name": provider_name,
                "error": "Provider not found",
                "passed": 0,
                "total": len(sampled),
                "avg_latency_ms": 0,
                "elapsed_ms": 0,
                "details": [],
                "error_count": 0,
                "categories": {},
                "completed": 0,
            }
            results[full_id] = result
            return


        # Use a dedicated client per model with reasonable connection pool
        # limits. HTTP/2 allows multiplexing many requests over a single TCP
        # connection, which is the dominant factor in throughput.
        # Keep pool small per-client so the OS-level fd count stays low
        # and the event loop isn't saturated by selector work.
        client_limits = httpx.Limits(
            max_keepalive_connections=10,
            max_connections=30,
            keepalive_expiry=30,
        )
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(30, connect=10),
            limits=client_limits,
            follow_redirects=True,
            verify=False,
        ) as client:
            # Process questions in batches. Each batch is throttled by the
            # model_semaphore, and we yield between batches so the uvicorn
            # event loop can handle other requests (health checks, progress
            # polling, cancel signals).
            all_details: list[dict] = []
            cat_passed: dict[str, int] = defaultdict(int)
            cat_total: dict[str, int] = defaultdict(int)
            passed = 0
            completed = 0
            error_count = 0
            batch_size = 10
            request_count = 0
            client_reset_interval = 100  # Recreate client every 100 requests

            # Define process_question ONCE outside the loop to avoid closure issues
            async def process_question(q_item):
                """处理单个问题，完成后立即更新进度队列"""
                nonlocal completed, passed, error_count
                
                try:
                    if cancel_event.is_set():
                        detail = {
                            "question_id": q_item.get("id", "?"),
                            "category": q_item.get("category", "common_science"),
                            "prompt": q_item.get("question", "")[:100],
                            "expected": q_item.get("answer", ""),
                            "actual": None,
                            "correct": False,
                            "error": "Cancelled",
                            "latency_ms": 0,
                            "retries": 0,
                            "timed_out": False,
                        }
                    else:
                        msem_wait_start = time.perf_counter()
                        async with model_semaphore:
                            msem_wait_s = time.perf_counter() - msem_wait_start
                            if msem_wait_s > 1.0:
                                msem_avail = getattr(model_semaphore, "_value", "?")
                                log.warning(
                                    "[sem] %s waited %.2fs for model_semaphore (avail=%s, per_model_limit=%d)",
                                    model_id, msem_wait_s, msem_avail, per_model_limit,
                                )
                            if cancel_event.is_set():
                                detail = {
                                    "question_id": q_item.get("id", "?"),
                                    "category": q_item.get("category", "common_science"),
                                    "prompt": q_item.get("question", "")[:100],
                                    "expected": q_item.get("answer", ""),
                                    "actual": None,
                                    "correct": False,
                                    "error": "Cancelled",
                                    "latency_ms": 0,
                                    "retries": 0,
                                    "timed_out": False,
                                }
                            else:
                                detail = await test_single_question(
                                    client, model_info, provider, q_item, cancel_event
                                )
                except Exception as e:
                    log.error("[worker] %s task crashed: %s", model_id, e)
                    run_diagnostics["requests_failed"] += 1
                    detail = {
                        "question_id": q_item.get("id", "?"),
                        "category": q_item.get("category", "common_science"),
                        "prompt": q_item.get("question", "")[:100],
                        "expected": q_item.get("answer", ""),
                        "actual": None,
                        "correct": False,
                        "error": str(e)[:100],
                        "latency_ms": 0,
                        "retries": 0,
                        "timed_out": False,
                    }
                
                # 立即更新统计和进度，不等待批次
                all_details.append(detail)
                cat = detail.get("category", "common_science")
                cat_total[cat] += 1
                if detail.get("correct"):
                    passed += 1
                    cat_passed[cat] += 1
                if detail.get("error"):
                    error_count += 1
                completed += 1
                
                # 每完成一题就发送进度更新
                if full_id in run_diagnostics["model_state"]:
                    run_diagnostics["model_state"][full_id]["completed"] = completed
                    run_diagnostics["model_state"][full_id]["passed"] = passed
                    run_diagnostics["model_state"][full_id]["last_activity"] = time.time()
                
                return detail

            batch_idx = 0
            for i in range(0, len(sampled), batch_size):
                batch_start = time.perf_counter()
                batch_idx += 1
                # Abort this model's remaining questions if the run was cancelled
                if cancel_event.is_set():
                    # Fill remaining questions with cancelled placeholders
                    for q in sampled[i:]:
                        all_details.append({
                            "prompt": q["question"][:120],
                            "expected": q["answer"].strip(),
                            "actual": None,
                            "correct": False,
                            "error": "Cancelled by user",
                            "latency_ms": 0,
                            "category": q.get("category", "common_science"),
                            "retries": 0,
                            "timed_out": False,
                            "cancelled": True,
                        })
                        completed += 1
                        error_count += 1
                        cat = q.get("category", "common_science")
                        cat_total[cat] += 1
                    # Update model_state for progress polling
                    if full_id in run_diagnostics["model_state"]:
                        run_diagnostics["model_state"][full_id]["completed"] = completed
                        run_diagnostics["model_state"][full_id]["last_activity"] = time.time()
                    break

                batch = sampled[i:i + batch_size]
                
                # 启动所有任务，不等待
                tasks = [process_question(q) for q in batch]
                # 等待批次完成，但每个任务都独立运行
                await asyncio.gather(*tasks, return_exceptions=True)
                batch_s = time.perf_counter() - batch_start
                if batch_s > 5.0 or batch_idx % 10 == 1:
                    log.info(
                        "[worker] %s batch#%d completed in %.2fs (q%d-%d, cum=%d/%d, pass=%d, err=%d)",
                        model_id, batch_idx, batch_s,
                        i + 1, min(i + batch_size, len(sampled)),
                        completed, len(sampled), passed, error_count,
                    )

                # Explicitly yield to the event loop so other requests
                # (health checks, other models' progress, cancel signals)
                # get a chance to run. Without this the single-threaded
                # uvicorn loop can starve incoming HTTP traffic.
                await asyncio.sleep(0)

            # Calculate final stats
            avg_latency = (
                sum(d["latency_ms"] for d in all_details) / len(all_details)
                if all_details else 0
            )
            worker_elapsed_ms = (time.perf_counter() - worker_start_time) * 1000

            result = {
                "id": full_id,
                "model_id": model_id,
                "provider_name": model_info.get("provider_name", provider.get("name", "unknown")),
                "passed": passed,
                "total": len(sampled),
                "avg_latency_ms": avg_latency,
                "elapsed_ms": worker_elapsed_ms,
                "details": all_details,
                "error_count": error_count,
                "categories": {
                    cat: {"passed": cat_passed.get(cat, 0), "total": cat_total.get(cat, 0)}
                    for cat in cat_total
                },
                "error": None,
                "completed": completed,
            }
            results[full_id] = result
            log.info("[worker] %s finished: %d/%d passed, %d errors, %.1fs total",
                     model_id, passed, completed, error_count,
                     worker_elapsed_ms / 1000)
            # Mark worker as done in diagnostics
            if full_id in run_diagnostics["model_state"]:
                run_diagnostics["model_state"][full_id]["in_flight"] = 0
                run_diagnostics["model_state"][full_id]["finished_at"] = time.time()

    # Track run in diagnostics - reset MUST happen before workers start,
    # otherwise the clear below wipes the state workers already wrote.
    run_diagnostics["current_run"] = run_id
    run_diagnostics["start_time"] = time.time()
    run_diagnostics["last_heartbeat"] = time.time()
    run_diagnostics["requests_total"] = 0
    run_diagnostics["requests_failed"] = 0
    run_diagnostics["model_state"].clear()

    # Create per-model semaphores
    model_tasks = []
    for target in targets:
        model_sem = asyncio.Semaphore(per_model_limit)
        task = asyncio.create_task(test_model_worker(target, model_sem))
        model_tasks.append(task)
    log.info("[run] %s started: %d models × %d questions, profile=%s",
             run_id, len(targets), num_tests, profile)

    # Stream progress updates
    _results_saved = False
    try:
        # Start periodic heartbeat logger that runs alongside workers
        async def _log_heartbeat():
            prev_total = 0
            while True:
                await asyncio.sleep(1)
                if cancel_event.is_set():
                    break
                if all(t.done() for t in model_tasks):
                    break
                pending = sum(
                    m.get("total", 0) - m.get("completed", 0)
                    for m in run_diagnostics["model_state"].values()
                )
                total_completed = sum(
                    m.get("completed", 0)
                    for m in run_diagnostics["model_state"].values()
                )
                stalled_flag = total_completed == prev_total
                prev_total = total_completed
                run_elapsed = time.time() - run_diagnostics["start_time"]
                in_flight = sum(
                    m.get("in_flight", 0)
                    for m in run_diagnostics["model_state"].values()
                )
                log.info(
                    "[run] %s heartbeat: total_q_completed=%d, pending=%d, "
                    "in_flight=%d, elapsed=%.1fs, stalled=%d, "
                    "requests=%d, failed=%d",
                    run_id, total_completed, pending, in_flight, run_elapsed,
                    1 if stalled_flag else 0,
                    run_diagnostics["requests_total"],
                    run_diagnostics["requests_failed"],
                )
                if stalled_flag:
                    for fid, st in run_diagnostics["model_state"].items():
                        mid = st.get("model_id", "?")
                        comp = st.get("completed", 0)
                        tot = st.get("total", 0)
                        infl = st.get("in_flight", 0)
                        last_act = st.get("last_activity", 0)
                        ago = time.time() - last_act if last_act else -1
                        log.warning(
                            "[run] %s STALLED model=%s progress=%d/%d in_flight=%d last_activity=%.1fs_ago",
                            run_id, mid, comp, tot, infl, ago,
                        )

        hb_task = asyncio.create_task(_log_heartbeat())

        # Wait for all model workers to finish (or be cancelled)
        await asyncio.gather(*model_tasks, return_exceptions=True)
        hb_task.cancel()

        # Build final result from completed workers
        run_results = [results[t["id"]] for t in targets if t["id"] in results]
        all_done = len(run_results) == len(targets)

        # Unregister the run from active_runs
        active_runs.pop(run_id, None)

        # Count actually-completed questions
        answered = sum(r.get("completed", 0) for r in run_results)
        total_questions = sum(r["total"] for r in run_results)

        final_result = {
            "run_id": run_id,
            "timestamp": datetime.now().isoformat(),
            "results": run_results,
            "total_models": len(targets),
            "total_passed": sum(r["passed"] for r in run_results),
            "total_questions": total_questions,
            "total_answered": answered,
            "category_sampled": cat_stats,
            "num_tests": num_tests,
            "profile": profile,
            "seed": seed,
            "completed": all_done,
            "cancelled": False,
        }

        # Mark run complete in diagnostics
        run_diagnostics["current_run"] = None
        run_end = time.time()
        log.info(
            "[run] %s completed: %d/%d passed, %d answered in %.1fs (%d http requests)",
            run_id, final_result["total_passed"], final_result["total_questions"],
            final_result["total_answered"], run_end - run_diagnostics["start_time"],
            run_diagnostics["requests_total"],
        )

        # Store in history
        _results_saved = True
        test_results.insert(0, final_result)
        _save_results()

    finally:
        # If _results_saved is still False, the run was interrupted
        # (cancelled or exception). Save whatever has been completed so far.
        cancel_event.set()
        for t in model_tasks:
            if not t.done():
                t.cancel()
        active_runs.pop(run_id, None)
        run_diagnostics["current_run"] = None

        # If _results_saved is still False, the run was interrupted
        # (timeout, SSE client disconnect, or other exception).
        # Cancel workers and save whatever has been completed so far.
        if not _results_saved:
            completed_results = [
                r for r in results.values() if r.get("completed", 0) > 0
            ]
            if completed_results:
                answered = sum(r.get("completed", 0) for r in completed_results)
                total_questions = sum(r["total"] for r in completed_results)
                partial_result = {
                    "run_id": run_id,
                    "timestamp": datetime.now().isoformat(),
                    "results": completed_results,
                    "total_models": len(targets),
                    "total_passed": sum(r["passed"] for r in completed_results),
                    "total_questions": total_questions,
                    "total_answered": answered,
                    "category_sampled": cat_stats,
                    "num_tests": num_tests,
                    "profile": profile,
                    "seed": seed,
                    "completed": False,
                    "cancelled": False,
                    "interrupted": True,
                }
                test_results.insert(0, partial_result)
                _save_results()
                run_end = time.time()
                log.info(
                    "[run] %s interrupted: saved %d/%d partial results, "
                    "%d/%d passed, %d answered in %.1fs (%d http requests)",
                    run_id, len(completed_results), len(targets),
                    partial_result["total_passed"], partial_result["total_questions"],
                    partial_result["total_answered"],
                    run_end - run_diagnostics["start_time"],
                    run_diagnostics["requests_total"],
                )
@app.get("/api/test/results")
async def get_results():
    return test_results


@app.get("/api/test/results/{run_id}")
async def get_run(run_id: str):
    for r in test_results:
        if r["run_id"] == run_id:
            return r
    raise HTTPException(404, "Run not found")


@app.delete("/api/test/results/{run_id}")
async def delete_run(run_id: str):
    global test_results
    before = len(test_results)
    test_results = [r for r in test_results if r["run_id"] != run_id]
    if len(test_results) == before:
        raise HTTPException(404, "Run not found")
    _save_results()
    return {"ok": True, "run_id": run_id}


@app.get("/api/health")
async def health():
    bank_total = sum(len(v) for v in question_bank.values())
    return {
        "status": "ok",
        "providers": len(providers),
        "models": len(models),
        "queue": len(test_queue),
        "bank_loaded": bank_total > 0,
        "bank_size": bank_total,
    }
