from __future__ import annotations

import re
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx
import yaml
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

DATA_PATH = Path(__file__).parent / "data.json"

PROMPTS = [
    ("What is 7 × 8? Answer with just the number.", "56"),
    ("Which planet is closest to the Sun? One word.", "Mercury"),
    ("What is 15 + 27? Answer with just the number.", "42"),
    ("How many sides does a hexagon have? Answer with just the number.", "6"),
    ("What is the square root of 144? Answer with just the number.", "12"),
    ("In which continent is Egypt? One word.", "Africa"),
    ("What is 9 × 11? Answer with just the number.", "99"),
    ("What language is primarily spoken in Brazil? One word.", "Portuguese"),
    ("What is the chemical symbol for water? Just the formula.", "H2O"),
    ("What is 144 / 12? Answer with just the number.", "12"),
]


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
    num_tests: int = 10


# ---------------------------------------------------------------------------
# In-memory state
# ---------------------------------------------------------------------------
providers: dict[str, dict] = {}
models: dict[str, dict] = {}


def _load() -> None:
    if DATA_PATH.exists():
        import json as _json

        with open(DATA_PATH, encoding="utf-8") as f:
            data = _json.load(f)
        providers.clear()
        providers.update(data.get("providers", {}))
        models.clear()
        models.update(data.get("models", {}))


def _save() -> None:
    import json as _json

    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        _json.dump({"providers": providers, "models": models}, f, indent=2)


@app.on_event("startup")
async def startup() -> None:
    _load()


# ---------------------------------------------------------------------------
# Provider CRUD
# ---------------------------------------------------------------------------

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
            url = base + path if not base.endswith(path) else base
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


# ---------------------------------------------------------------------------
# All models
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Test queue & runs
# ---------------------------------------------------------------------------

test_queue: list[dict] = []
test_results: list[dict] = []


def _normalize(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


@app.post("/api/test/queue")
async def add_to_queue(model_full_ids: list[str]):
    added = []
    for fid in model_full_ids:
        if fid not in models:
            continue
        if any(q["full_id"] == fid for q in test_queue):
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
    test_queue = [x for x in test_queue if x["full_id"] != fid]
    return {"removed": before - len(test_queue), "queue_size": len(test_queue)}


@app.post("/api/test/run")
async def run_test(req: TestRunRequest):
    targets = [models[fid] for fid in req.model_ids if fid in models]
    if not targets:
        raise HTTPException(400, "No valid models to test")

    run_id = str(uuid.uuid4())[:8]
    run_results: list[dict] = []

    prompts = PROMPTS[: req.num_tests]

    async with httpx.AsyncClient(timeout=60) as client:
        for m in targets:
            prov = providers.get(m["provider_id"])
            if not prov:
                run_results.append({
                    "model_id": m["model_id"],
                    "provider_name": "unknown",
                    "error": "Provider not found",
                    "passed": 0,
                    "total": 0,
                })
                continue

            url = prov["base_url"] + "/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {prov['api_key']}",
                "Content-Type": "application/json",
            }
            passed = 0
            total = len(prompts)
            details: list[dict] = []

            for prompt, expected in prompts:
                start = time.perf_counter()
                try:
                    r = await client.post(
                        url,
                        headers=headers,
                        json={
                            "model": m["model_id"],
                            "messages": [{"role": "user", "content": prompt}],
                            "temperature": 0,
                            "max_tokens": 32,
                        },
                        timeout=30,
                    )
                    elapsed = (time.perf_counter() - start) * 1000
                    if r.status_code != 200:
                        details.append({
                            "prompt": prompt,
                            "expected": expected,
                            "actual": None,
                            "correct": False,
                            "error": f"HTTP {r.status_code}",
                            "latency_ms": elapsed,
                        })
                        continue

                    content = (
                        r.json()
                        .get("choices", [{}])[0]
                        .get("message", {})
                        .get("content", "")
                        .strip()
                    )
                    ok = _normalize(content) == _normalize(expected)
                    if ok:
                        passed += 1
                    details.append({
                        "prompt": prompt,
                        "expected": expected,
                        "actual": content,
                        "correct": ok,
                        "error": None,
                        "latency_ms": elapsed,
                    })
                except httpx.HTTPError as e:
                    elapsed = (time.perf_counter() - start) * 1000
                    details.append({
                        "prompt": prompt,
                        "expected": expected,
                        "actual": None,
                        "correct": False,
                        "error": str(e),
                        "latency_ms": elapsed,
                    })

            run_results.append({
                "model_id": m["model_id"],
                "provider_name": m.get("provider_name", prov["name"]),
                "passed": passed,
                "total": total,
                "avg_latency_ms": (
                    sum(d["latency_ms"] for d in details) / total if total else 0
                ),
                "details": details,
                "error": None,
            })

    result = {
        "run_id": run_id,
        "timestamp": datetime.now().isoformat(),
        "results": run_results,
        "total_models": len(targets),
        "total_passed": sum(r["passed"] for r in run_results),
        "total_questions": sum(r["total"] for r in run_results),
    }
    test_results.insert(0, result)
    return result


@app.get("/api/test/results")
async def get_results():
    return test_results


@app.get("/api/test/results/{run_id}")
async def get_run(run_id: str):
    for r in test_results:
        if r["run_id"] == run_id:
            return r
    raise HTTPException(404, "Run not found")


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "providers": len(providers),
        "models": len(models),
        "queue": len(test_queue),
    }
