from __future__ import annotations

import asyncio
import csv
import json
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
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

DATA_PATH = Path(__file__).parent / "data.json"
QUESTION_BANK_PATH = Path(__file__).parent.parent.parent / "data" / "all_questions.csv"

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


def _api_url(base: str, path: str) -> str:
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


app = FastAPI(title="Model Auth Check Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


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
    global question_bank
    if DATA_PATH.exists():
        import json as _json
        with open(DATA_PATH, encoding="utf-8") as f:
            data = _json.load(f)
        providers.clear()
        providers.update(data.get("providers", {}))
        models.clear()
        models.update(data.get("models", {}))
    question_bank = _load_question_bank()


def _save() -> None:
    import json as _json
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        _json.dump({"providers": providers, "models": models}, f, indent=2)


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
        "base_url": data.base_url.rstrip("/"),
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
    base = p["base_url"]
    headers = {"Authorization": f"Bearer {p['api_key']}"}

    async with httpx.AsyncClient(timeout=30) as client:
        for path in ("/v1/models", "/v1/models/list", "/models"):
            url = _api_url(base, path)
            try:
                r = await client.get(url, headers=headers)
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
            except httpx.HTTPError:
                continue

    raise HTTPException(
        400,
        f"Could not fetch models from {base}. Tried: /v1/models, /v1/models/list, /models",
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
    return {"added": added, "queue_size": len(test_queue)}


@app.get("/api/test/queue")
async def get_queue():
    return test_queue


@app.delete("/api/test/queue/{fid}")
async def remove_from_queue(fid: str):
    global test_queue
    before = len(test_queue)
    test_queue = [x for x in test_queue if x["id"] != fid]
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

    # Start streaming test run
    return StreamingResponse(
        _run_test_stream(run_id, targets, sampled, cat_stats, req.num_tests, req.profile, seed),
        media_type="text/event-stream",
    )


async def _run_test_stream(run_id: str, targets: list[dict], sampled: list[dict],
                          cat_stats: dict[str, int], num_tests: int, profile: str, seed: int):
    global_semaphore = asyncio.Semaphore(100)
    progress_queue: asyncio.Queue = asyncio.Queue()
    results: dict[str, dict] = {}

    # Calculate per-model concurrency based on total models
    per_model_limit = min(5, max(1, 100 // len(targets)))

    async def test_single_question(client: httpx.AsyncClient, model_info: dict,
                                   provider: dict, question: dict) -> dict:
        model_id = model_info["model_id"]
        url = _api_url(provider["base_url"], "/v1/chat/completions")
        headers = {
            "Authorization": f"Bearer {provider['api_key']}",
            "Content-Type": "application/json",
        }

        prompt = SYSTEM_PROMPT + question["question"].strip()
        expected = question["answer"].strip()
        category = question.get("category", "common_science")

        async with global_semaphore:
            start = time.perf_counter()
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
                    timeout=30,
                )
                elapsed = (time.perf_counter() - start) * 1000

                if r.status_code != 200:
                    return {
                        "prompt": question["question"][:120],
                        "expected": expected,
                        "actual": None,
                        "correct": False,
                        "error": f"HTTP {r.status_code}",
                        "latency_ms": elapsed,
                        "category": category,
                    }

                content = (
                    r.json()
                    .get("choices", [{}])[0]
                    .get("message", {})
                    .get("content", "")
                )
                content_stripped = _extract_answer(content, expected)
                ok = _normalize(content_stripped) == _normalize(expected)
                return {
                    "prompt": question["question"][:120],
                    "expected": expected,
                    "actual": content_stripped,
                    "correct": ok,
                    "error": None,
                    "latency_ms": elapsed,
                    "category": category,
                }
            except httpx.HTTPError as e:
                elapsed = (time.perf_counter() - start) * 1000
                return {
                    "prompt": question["question"][:120],
                    "expected": expected,
                    "actual": None,
                    "correct": False,
                    "error": str(e),
                    "latency_ms": elapsed,
                    "category": category,
                }

    async def test_model_worker(model_info: dict, model_semaphore: asyncio.Semaphore):
        model_id = model_info["model_id"]
        provider_id = model_info.get("provider_id")
        provider = providers.get(provider_id)
        worker_start_time = time.perf_counter()

        if not provider:
            result = {
                "model_id": model_id,
                "provider_name": "unknown",
                "error": "Provider not found",
                "passed": 0,
                "total": len(sampled),
                "avg_latency_ms": 0,
                "elapsed_ms": 0,
                "details": [],
                "categories": {},
                "completed": 0,
            }
            results[model_id] = result
            await progress_queue.put({"type": "model_complete", "model_id": model_id, "result": result})
            return

        await progress_queue.put({"type": "model_start", "model_id": model_id})

        async with httpx.AsyncClient(timeout=60) as client:
            # Process questions in batches
            batch_size = 5
            all_details: list[dict] = []
            cat_passed: dict[str, int] = defaultdict(int)
            cat_total: dict[str, int] = defaultdict(int)
            passed = 0
            completed = 0

            for i in range(0, len(sampled), batch_size):
                batch = sampled[i:i + batch_size]
                tasks = []
                for q in batch:
                    # Respect per-model semaphore
                    async def wrapped_task(q_item=q):
                        async with model_semaphore:
                            return await test_single_question(client, model_info, provider, q_item)
                    tasks.append(wrapped_task())

                batch_results = await asyncio.gather(*tasks)
                for detail in batch_results:
                    all_details.append(detail)
                    cat = detail.get("category", "common_science")
                    cat_total[cat] += 1
                    if detail.get("correct"):
                        passed += 1
                        cat_passed[cat] += 1
                    completed += 1

                # Send progress update
                await progress_queue.put({
                    "type": "model_progress",
                    "model_id": model_id,
                    "completed": completed,
                    "total": len(sampled),
                    "passed": passed,
                })

            # Calculate final stats
            avg_latency = (
                sum(d["latency_ms"] for d in all_details) / len(all_details)
                if all_details else 0
            )
            worker_elapsed_ms = (time.perf_counter() - worker_start_time) * 1000

            result = {
                "model_id": model_id,
                "provider_name": model_info.get("provider_name", provider.get("name", "unknown")),
                "passed": passed,
                "total": len(sampled),
                "avg_latency_ms": avg_latency,
                "elapsed_ms": worker_elapsed_ms,
                "details": all_details,
                "categories": {
                    cat: {"passed": cat_passed.get(cat, 0), "total": cat_total.get(cat, 0)}
                    for cat in cat_total
                },
                "error": None,
                "completed": completed,
            }
            results[model_id] = result
            await progress_queue.put({"type": "model_complete", "model_id": model_id, "result": result})

    # Create per-model semaphores
    model_tasks = []
    for target in targets:
        model_sem = asyncio.Semaphore(per_model_limit)
        task = asyncio.create_task(test_model_worker(target, model_sem))
        model_tasks.append(task)

    # Stream progress updates
    await progress_queue.put({
        "type": "run_start",
        "run_id": run_id,
        "total_models": len(targets),
        "num_tests": num_tests,
        "profile": profile,
        "seed": seed,
        "category_sampled": cat_stats,
    })

    completed_models = 0
    while completed_models < len(targets):
        try:
            msg = await asyncio.wait_for(progress_queue.get(), timeout=0.1)
            yield f"data: {json.dumps(msg)}\n\n"

            if msg["type"] == "model_complete":
                completed_models += 1
        except asyncio.TimeoutError:
            # Send heartbeat to keep connection alive
            yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"

    # Wait for all tasks to complete
    await asyncio.gather(*model_tasks)

    # Build final result
    run_results = [results[t["model_id"]] for t in targets if t["model_id"] in results]

    final_result = {
        "run_id": run_id,
        "timestamp": datetime.now().isoformat(),
        "results": run_results,
        "total_models": len(targets),
        "total_passed": sum(r["passed"] for r in run_results),
        "total_questions": sum(r["total"] for r in run_results),
        "category_sampled": cat_stats,
        "num_tests": num_tests,
        "profile": profile,
        "seed": seed,
        "completed": True,
    }

    # Store in history
    test_results.insert(0, final_result)
    if len(test_results) > 10:
        test_results.pop()

    yield f"data: {json.dumps({'type': 'run_complete', 'result': final_result})}\n\n"


@app.get("/api/test/results")
async def get_results():
    return test_results


@app.get("/api/test/results/{run_id}")
async def get_run(run_id: str):
    for r in test_results:
        if r["run_id"] == run_id:
            return r
    raise HTTPException(404, "Run not found")


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
