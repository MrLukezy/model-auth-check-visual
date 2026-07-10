from __future__ import annotations

import asyncio
import json
import logging
import random
import re
import string
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from urllib.parse import urlparse, urlunparse

log = logging.getLogger("server")

LONG_CONTEXT_RESULTS_PATH = Path(__file__).parent / "long_context_results.json"

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


class LongContextRunRequest(BaseModel):
    model_ids: list[str]
    test_types: list[str] = ["niah"]
    context_lengths: list[int] = [2048, 4096, 8192, 16384, 32768]
    num_tests_per_length: int = 5
    needle_positions: list[str] = ["start", "middle", "end"]


FILLER_PARAGRAPHS = [
    "The development of artificial intelligence has been one of the most transformative technological advances of the 21st century. From early rule-based systems to modern deep learning architectures, the field has evolved dramatically over the past several decades. Researchers continue to push the boundaries of what machines can accomplish, from understanding natural language to generating creative content and solving complex scientific problems.",
    "Marine ecosystems represent some of the most diverse and complex environments on Earth. The ocean covers more than seventy percent of our planet's surface and contains roughly ninety-seven percent of all water. Deep sea trenches, coral reefs, kelp forests, and open ocean pelagic zones each support unique communities of organisms that have adapted to their specific conditions over millions of years of evolution.",
    "The history of mathematics stretches back thousands of years, with early civilizations in Mesopotamia, Egypt, Greece, India, and China making fundamental contributions. The concept of zero, algebraic notation, calculus, and probability theory all emerged from different cultures at different times. These mathematical tools eventually became the universal language of science and engineering.",
    "Ancient Rome was one of the largest and most influential civilizations in world history. At its peak, the Roman Empire controlled territories spanning from Britain to Mesopotamia, governing tens of millions of people. Roman innovations in law, engineering, architecture, and military organization shaped the development of Western civilization for centuries after the empire's fall.",
    "The human brain contains approximately eighty-six billion neurons, each connected to thousands of others through synapses. This vast network of connections gives rise to consciousness, memory, emotion, and thought. Neuroscience has made remarkable progress in mapping brain regions and understanding neural circuits, yet many fundamental questions about how the brain works remain unanswered.",
    "Climate change represents one of the most pressing challenges facing humanity today. Rising global temperatures are driven primarily by the accumulation of greenhouse gases in the atmosphere, particularly carbon dioxide from the burning of fossil fuels. The consequences include sea level rise, more extreme weather events, shifts in agricultural productivity, and loss of biodiversity.",
    "The Renaissance was a period of profound cultural and intellectual transformation that began in Italy during the fourteenth century and spread throughout Europe. It marked a revival of interest in classical learning, humanistic philosophy, and artistic expression. Artists like Leonardo da Vinci, Michelangelo, and Raphael produced works that continue to define Western artistic ideals.",
    "Quantum mechanics describes the behavior of matter and energy at atomic and subatomic scales, where the classical laws of physics break down. Phenomena like superposition, entanglement, and wave-particle duality challenge our everyday intuitions. Despite its counterintuitive nature, quantum mechanics has proven extraordinarily accurate and underpins technologies from semiconductors to lasers and MRI machines.",
    "The Amazon rainforest is the largest tropical forest in the world, covering approximately five and a half million square kilometers across nine countries in South America. It contains an estimated ten percent of all species on Earth and plays a critical role in regulating the global climate by absorbing billions of tons of carbon dioxide each year.",
    "Philosophy has been practiced in various forms for over two and a half thousand years, beginning with pre-Socratic thinkers in ancient Greece who sought natural explanations for the world around them. Major branches include metaphysics, epistemology, ethics, logic, and aesthetics. Philosophical inquiry has profoundly influenced science, politics, religion, and art throughout human history.",
    "The Industrial Revolution transformed societies from agrarian economies into industrial powerhouses during the eighteenth and nineteenth centuries. Beginning in Britain with innovations in textile manufacturing and steam power, it spread to continental Europe, North America, and eventually the world. This period saw unprecedented urbanization, changes in labor practices, and rapid technological advancement.",
    "Music has been a fundamental part of human culture since prehistoric times. Archaeological evidence suggests that early humans created musical instruments from bone and wood tens of thousands of years ago. From the complex polyphony of medieval church music to the improvisation of jazz and the digital production of modern electronic genres, music continues to evolve across cultures.",
    "The Solar System formed approximately four and a half billion years ago from a collapsing cloud of gas and dust. The eight planets, along with dwarf planets, moons, asteroids, and comets, orbit the Sun in a vast gravitational dance. Space exploration has revealed stunning details about each world, from the volcanoes of Venus to the methane lakes of Titan.",
    "Genetics is the study of heredity and the variation of inherited characteristics. The discovery of DNA's double-helix structure by Watson and Crick in nineteen fifty-three revolutionized biology. Today, genomic technologies allow scientists to sequence entire genomes rapidly, understand genetic diseases, develop gene therapies, and even edit DNA directly using tools like CRISPR.",
    "Architecture reflects the values, technologies, and aesthetics of the societies that produce it. From the pyramids of Egypt and the temples of Greece to Gothic cathedrals and modern skyscrapers, buildings serve both practical and symbolic purposes. Contemporary architecture increasingly emphasizes sustainability, energy efficiency, and integration with natural environments.",
    "Oceanography is the scientific study of the sea, encompassing its physics, chemistry, biology, and geology. Ocean currents influence climate patterns worldwide, marine organisms produce roughly half of the oxygen we breathe, and the seafloor holds records of Earth's geological history spanning hundreds of millions of years. Exploration of the deep ocean continues to reveal previously unknown ecosystems.",
    "The history of writing dates to approximately thirty-two hundred years before the common era, when the Sumerians of Mesopotamia developed cuneiform script. Writing systems evolved independently in several regions including Egypt, China, and Mesoamerica. The invention of the printing press in the fifteenth century dramatically accelerated the spread of literacy and knowledge across the globe.",
    "Thermodynamics is the branch of physics that deals with heat, work, temperature, and energy. Its four fundamental laws govern everything from the efficiency of engines to the direction of chemical reactions and the behavior of black holes. The concept of entropy, introduced in the nineteenth century, connects macroscopic thermodynamics to microscopic statistical mechanics.",
    "Linguistics is the scientific study of language and its structure, including phonetics, phonology, morphology, syntax, semantics, and pragmatics. There are roughly seven thousand languages spoken in the world today, though many are endangered. The study of how languages evolve, relate to one another, and are acquired by children remains a vibrant field of research.",
    "The concept of democracy originated in ancient Athens around the fifth century before the common era. Athenian citizens participated directly in decision-making through public assemblies and voting. Modern representative democracies differ significantly from this model but draw inspiration from the Athenian ideal of governance by the people, evolving through centuries of political thought and revolution.",
    "Volcanoes are geological formations where molten rock, ash, and gases escape from beneath the Earth's surface. There are approximately fifteen hundred potentially active volcanoes worldwide, and about five hundred have erupted in recorded history. Volcanic activity plays a crucial role in shaping landscapes, creating new land, recycling tectonic plates, and enriching soils.",
    "Economics studies how societies allocate scarce resources to satisfy unlimited wants. Classical economists like Adam Smith laid foundations by analyzing markets, labor, and trade. Modern economics encompasses microeconomics, which examines individual and firm behavior, and macroeconomics, which studies national output, employment, inflation, and international economic relations.",
    "The immune system is a complex network of cells, tissues, and organs that protects the body from harmful pathogens including bacteria, viruses, fungi, and parasites. Innate immunity provides immediate but nonspecific defense, while adaptive immunity develops targeted responses and immunological memory. Vaccination exploits adaptive immunity to prevent infectious diseases.",
    "Cryptography has evolved from simple substitution ciphers used by ancient civilizations to sophisticated mathematical algorithms that secure modern digital communications. The development of public key cryptography in the nineteen seventies enabled secure communication between parties who had never met. Today cryptographic protocols protect everything from banking transactions to private messages.",
]

NIH_NEEDLES = [
    {"fact": "The secret passcode for vault seven is {CODE}.", "question": "What is the secret passcode for vault seven?", "gen": lambda r: {"CODE": "".join(r.choices(string.ascii_uppercase + string.digits, k=8))}},
    {"fact": "Dr. {NAME} works in room {ROOM} on floor {FLOOR} of the {BUILDING} building.", "question": "What floor is Dr. {NAME}'s office on?", "gen": lambda r: {"NAME": r.choice(["Hawkins", "Chen", "Kowalski", "Patel", "Rodriguez", "Nakamura", "Okafor"]), "ROOM": str(r.randint(100, 999)), "FLOOR": str(r.randint(2, 25)), "BUILDING": r.choice(["Meridian", "Cobalt", "Atlas", "Zenith", "Solaris"])}},
    {"fact": "The annual summit will take place in {CITY} on {DATE}.", "question": "In what city will the annual summit be held?", "gen": lambda r: {"CITY": r.choice(["Reykjavik", "Ljubljana", "Valparaiso", "Chiang Mai", "Tbilisi", "Windhoek", "Ulaanbaatar"]), "DATE": r.choice(["March 14th", "July 22nd", "November 8th", "September 3rd", "January 17th"])}},
    {"fact": "The rare {ANIMAL} was last spotted near {LOCATION} at approximately {TIME}.", "question": "Where was the rare {ANIMAL} last spotted?", "gen": lambda r: {"ANIMAL": r.choice(["azure kingfisher", "ghost orchid frog", "sapphire salamander", "crimson tree python", "ivory pangolin"]), "LOCATION": r.choice(["Lakemere Falls", "Thornwood Ridge", "Silvervein Caverns", "Mossglen Estuary", "Ashpine Valley"]), "TIME": r.choice(["dawn", "dusk", "midnight", "noon", "twilight"])}},
    {"fact": "Employee {ID} reported a critical security incident on {DATE} involving {SYSTEM}.", "question": "What system was involved in the security incident reported by employee {ID}?", "gen": lambda r: {"ID": str(r.randint(4000, 9999)), "DATE": r.choice(["April 5th", "August 19th", "February 11th", "October 30th"]), "SYSTEM": r.choice(["the payment gateway", "the authentication service", "the database cluster", "the email relay", "the API gateway"])}},
    {"fact": "The hidden artifact known as the {ARTIFACT} was discovered by {DISCOVERER} in {YEAR}.", "question": "Who discovered the {ARTIFACT}?", "gen": lambda r: {"ARTIFACT": r.choice(["Obsidian Compass", "Celestial Map of Veldara", "Iron Crown of Thessaly", "Jade Astrolabe", "Crystal Codex"]), "DISCOVERER": r.choice(["Professor Elara Voss", "Dr. Marcus Holt", "Captain Idris Kane", "Archaeologist Senna Liu", "Explorer Tariq Bello"]), "YEAR": str(r.randint(1850, 1975))}},
    {"fact": "The experimental compound ZX-{NUM} shows {PERCENT}% efficacy against {TARGET} in phase {PHASE} trials.", "question": "What is the efficacy percentage of compound ZX-{NUM}?", "gen": lambda r: {"NUM": str(r.randint(100, 999)), "PERCENT": str(r.choice([72, 84, 91, 67, 78, 95, 88])), "TARGET": r.choice(["resistant malaria", "chronic lymphoma", "pulmonary fibrosis", "autoimmune hepatitis"]), "PHASE": str(r.choice([2, 3]))}},
    {"fact": "Access to restricted zone {ZONE} requires clearance code {CODE} and biometric verification.", "question": "What clearance code is required for restricted zone {ZONE}?", "gen": lambda r: {"ZONE": r.choice(["Alpha-7", "Delta-3", "Omega-12", "Sigma-9", "Theta-4"]), "CODE": "".join(r.choices(string.digits, k=6))}},
]

KV_TEMPLATES = [
    {"question": "What is the value associated with key {KEY}?", "gen_keys": lambda r: [("item-" + "".join(r.choices(string.ascii_lowercase, k=4)), str(r.randint(1000, 9999))) for _ in range(50)]},
    {"question": "What is the phone number for {NAME}?", "gen_keys": lambda r: [(r.choice(["Alice", "Bob", "Charlie", "Diana", "Eve", "Frank", "Grace", "Henry", "Irene", "Jack"]), "+" + "".join(r.choices(string.digits, k=11))) for _ in range(30)]},
]

MULTIHOP_TEMPLATES = [
    {
        "gen": lambda r: _gen_multihop_chain(r),
        "question_tpl": "Who is the mentor of {PERSON}?",
    },
]

COUNTING_WORDS = [
    "meridian", "cobalt", "zenith", "atlas", "solstice", "catalyst", "prism", "vortex", "nexus", "cipher",
    "aurora", "cascade", "dynamo", "eclipse", "falcon", "granite", "harbor", "infinitum", "jasper", "krypton",
]


def _gen_multihop_chain(r: random.Random) -> dict:
    first_names = ["Aria", "Blake", "Cyrus", "Diana", "Ellis", "Farah", "Gael", "Hana", "Ivan", "Juno",
                   "Kai", "Liora", "Maren", "Niko", "Oren", "Petra", "Quinn", "Reva", "Soren", "Talia"]
    names = r.sample(first_names, 4)
    chain = []
    for i in range(len(names) - 1):
        chain.append({"mentor": names[i + 1], "student": names[i]})
    return {
        "chain": chain,
        "question_person": names[0],
        "answer": names[-1],
        "question": f"Who is the mentor of {names[0]}?",
    }


def _estimate_tokens(text: str) -> int:
    return len(text) // 4


def _generate_filler(target_tokens: int, rng: random.Random) -> str:
    paragraphs = list(FILLER_PARAGRAPHS)
    rng.shuffle(paragraphs)
    result_parts = []
    current_tokens = 0
    idx = 0
    while current_tokens < target_tokens:
        p = paragraphs[idx % len(paragraphs)]
        result_parts.append(p)
        current_tokens += _estimate_tokens(p)
        idx += 1
        if idx > len(paragraphs) * 50:
            break
    text = "\n\n".join(result_parts)
    while _estimate_tokens(text) > target_tokens:
        text = text[:-100]
    return text


def _generate_niah_test(target_tokens: int, position: str, rng: random.Random) -> dict:
    needle_template = rng.choice(NIH_NEEDLES)
    params = needle_template["gen"](rng)
    fact = needle_template["fact"].format(**params)
    base_question = needle_template["question"].format(**params)

    filler_tokens = target_tokens - _estimate_tokens(fact) - 100
    filler = _generate_filler(max(filler_tokens, 200), rng)

    fact_tokens = _estimate_tokens(fact)
    filler_tokens_actual = _estimate_tokens(filler)

    if position == "start":
        insert_point = 0
    elif position == "end":
        insert_point = len(filler)
    else:
        mid = len(filler) // 2
        insert_point = rng.randint(max(0, mid - len(filler) // 4), min(len(filler), mid + len(filler) // 4))

    haystack = filler[:insert_point] + "\n\n" + fact + "\n\n" + filler[insert_point:]

    prefix = ("I am going to give you a long passage of text. Hidden somewhere in this passage is an important fact. "
              "Read the entire passage carefully and then answer the question below.\n\n"
              "--- PASSAGE START ---\n\n")
    suffix = ("\n\n--- PASSAGE END ---\n\n"
              f"Question: {base_question}\n"
              "Answer with only the specific answer, nothing else:")

    full_prompt = prefix + haystack + suffix
    expected = _derive_expected_answer(fact, base_question, params)

    return {
        "test_type": "niah",
        "prompt": full_prompt,
        "expected": expected,
        "context_tokens": _estimate_tokens(haystack),
        "needle_position": position,
        "fact": fact,
        "question": base_question,
        "params": params,
    }


def _derive_expected_answer(fact: str, question: str, params: dict) -> str:
    q_lower = question.lower()
    if "passcode" in q_lower or "code" in q_lower or "clearance" in q_lower:
        return params.get("CODE", "")
    if "floor" in q_lower:
        return params.get("FLOOR", "")
    if "city" in q_lower or "where" in q_lower and "summit" in q_lower:
        return params.get("CITY", "")
    if "where" in q_lower or "spotted" in q_lower:
        return params.get("LOCATION", "")
    if "system" in q_lower:
        return params.get("SYSTEM", "")
    if "who" in q_lower and "discover" in q_lower:
        return params.get("DISCOVERER", "")
    if "efficacy" in q_lower or "percentage" in q_lower:
        return params.get("PERCENT", "") + "%"
    for k, v in params.items():
        if v in fact and v not in question:
            return v
    vals = list(params.values())
    return vals[-1] if vals else ""


def _generate_kv_test(target_tokens: int, position: str, rng: random.Random) -> dict:
    template = rng.choice(KV_TEMPLATES)
    pairs = template["gen_keys"](rng)
    rng.shuffle(pairs)

    target_pair_idx = rng.randint(0, len(pairs) - 1)
    target_key, target_value = pairs[target_pair_idx]

    kv_text_parts = []
    for k, v in pairs:
        kv_text_parts.append(f"{k}: {v}")
    kv_text = "\n".join(kv_text_parts)

    filler_tokens = target_tokens - _estimate_tokens(kv_text) - 100
    filler = _generate_filler(max(filler_tokens, 200), rng)

    if position == "start":
        haystack = kv_text + "\n\n" + filler
    elif position == "end":
        haystack = filler + "\n\n" + kv_text
    else:
        mid = len(filler) // 2
        haystack = filler[:mid] + "\n\n" + kv_text + "\n\n" + filler[mid:]

    question = template["question"].format(KEY=target_key, NAME=target_key)

    prefix = ("I am going to give you a long passage of text containing various data entries. "
              "Read the entire passage carefully and then answer the question below.\n\n"
              "--- PASSAGE START ---\n\n")
    suffix = ("\n\n--- PASSAGE END ---\n\n"
              f"Question: {question}\n"
              "Answer with only the specific value, nothing else:")

    full_prompt = prefix + haystack + suffix

    return {
        "test_type": "kv_retrieval",
        "prompt": full_prompt,
        "expected": target_value,
        "context_tokens": _estimate_tokens(haystack),
        "needle_position": position,
        "target_key": target_key,
        "question": question,
    }


def _generate_counting_test(target_tokens: int, rng: random.Random) -> dict:
    target_word = rng.choice(COUNTING_WORDS)
    actual_count = rng.randint(3, 12)

    filler_tokens = target_tokens - 200
    filler = _generate_filler(max(filler_tokens, 500), rng)

    words = filler.split()
    total_words = len(words)
    positions = sorted(rng.sample(range(total_words), min(actual_count, total_words)))
    for i, pos in enumerate(positions):
        words.insert(pos + i, target_word)

    haystack = " ".join(words)

    prefix = ("I am going to give you a long passage of text. Your task is to count exactly how many times "
              "a specific word appears in this passage. Read carefully and count precisely.\n\n"
              "--- PASSAGE START ---\n\n")
    suffix = (f"\n\n--- PASSAGE END ---\n\n"
              f"Question: How many times does the word '{target_word}' appear in the passage above? "
              f"Answer with only the number, nothing else:")

    full_prompt = prefix + haystack + suffix

    return {
        "test_type": "counting",
        "prompt": full_prompt,
        "expected": str(actual_count),
        "context_tokens": _estimate_tokens(haystack),
        "target_word": target_word,
        "actual_count": actual_count,
    }


def _generate_multihop_test(target_tokens: int, position: str, rng: random.Random) -> dict:
    chain_data = _gen_multihop_chain(rng)
    chain = chain_data["chain"]
    chain_text = "\n".join([f"{c['student']}'s mentor is {c['mentor']}." for c in chain])

    filler_tokens = target_tokens - _estimate_tokens(chain_text) - 100
    filler = _generate_filler(max(filler_tokens, 200), rng)

    if position == "start":
        haystack = chain_text + "\n\n" + filler
    elif position == "end":
        haystack = filler + "\n\n" + chain_text
    else:
        mid = len(filler) // 2
        haystack = filler[:mid] + "\n\n" + chain_text + "\n\n" + filler[mid:]

    question = chain_data["question"]

    prefix = ("I am going to give you a long passage of text containing information about mentor-student relationships. "
              "Read the entire passage carefully and then answer the question below.\n\n"
              "--- PASSAGE START ---\n\n")
    suffix = ("\n\n--- PASSAGE END ---\n\n"
              f"Question: {question}\n"
              "Answer with only the person's name, nothing else:")

    full_prompt = prefix + haystack + suffix

    return {
        "test_type": "multi_hop",
        "prompt": full_prompt,
        "expected": chain_data["answer"],
        "context_tokens": _estimate_tokens(haystack),
        "needle_position": position,
        "question": question,
        "chain": chain,
    }


def _generate_test(test_type: str, target_tokens: int, position: str, rng: random.Random) -> dict:
    if test_type == "niah":
        return _generate_niah_test(target_tokens, position, rng)
    elif test_type == "kv_retrieval":
        return _generate_kv_test(target_tokens, position, rng)
    elif test_type == "counting":
        return _generate_counting_test(target_tokens, rng)
    elif test_type == "multi_hop":
        return _generate_multihop_test(target_tokens, position, rng)
    else:
        raise ValueError(f"Unknown test type: {test_type}")


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
    exp_norm = _normalize(expected)
    cln_norm = _normalize(cleaned)
    if exp_norm and exp_norm in cln_norm:
        return expected
    return cleaned[:120] if len(cleaned) > 120 else cleaned


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

long_context_results: list[dict] = []
active_long_runs: dict[str, asyncio.Event] = {}
long_run_progress: dict[str, dict] = {}


def _load_results() -> None:
    global long_context_results
    if LONG_CONTEXT_RESULTS_PATH.exists():
        try:
            with open(LONG_CONTEXT_RESULTS_PATH, encoding="utf-8") as f:
                long_context_results = json.load(f)
        except (json.JSONDecodeError, OSError):
            long_context_results = []
    else:
        long_context_results = []


def _save_results() -> None:
    try:
        LONG_CONTEXT_RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(LONG_CONTEXT_RESULTS_PATH, "w", encoding="utf-8") as f:
            json.dump(long_context_results, f, indent=2, ensure_ascii=False)
    except OSError as e:
        log.warning("[long_context] failed to save results: %s", e)


async def _save_results_async() -> None:
    """Non-blocking save: offloads synchronous JSON serialization to a thread pool."""
    await asyncio.to_thread(_save_results)


_load_results()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

def register_long_context_routes(app: FastAPI) -> None:

    @app.post("/api/long-context/run")
    async def run_long_context(req: LongContextRunRequest, request=None):
        from server import models, providers

        targets = [models[fid] for fid in req.model_ids if fid in models]
        if not targets:
            raise HTTPException(400, "No valid models to test")

        if not req.test_types:
            raise HTTPException(400, "At least one test type is required")

        if not req.context_lengths:
            raise HTTPException(400, "At least one context length is required")

        run_id = str(uuid.uuid4())[:8]
        cancel_event = asyncio.Event()
        active_long_runs[run_id] = cancel_event

        total_tests = len(req.test_types) * len(req.context_lengths) * req.num_tests_per_length * len(req.needle_positions)

        long_run_progress[run_id] = {
            "run_id": run_id,
            "running": True,
            "completed": False,
            "total_tests": total_tests * len(targets),
            "completed_tests": 0,
            "models": {
                m["id"]: {
                    "model_id": m["model_id"],
                    "provider_name": m.get("provider_name", ""),
                    "completed": 0,
                    "total": total_tests,
                    "by_length": {},
                    "passed": 0,
                    "error": None,
                }
                for m in targets
            },
            "start_time": time.time(),
        }

        asyncio.create_task(_run_long_context_background(
            run_id, targets, req.test_types, req.context_lengths,
            req.num_tests_per_length, req.needle_positions, cancel_event,
        ))

        return {"run_id": run_id, "total_tests": total_tests * len(targets)}

    @app.get("/api/long-context/progress/{run_id}")
    async def get_long_progress(run_id: str):
        prog = long_run_progress.get(run_id)
        if not prog:
            raise HTTPException(404, "Run not found")
        prog["elapsed_s"] = time.time() - prog.get("start_time", time.time())
        return prog

    @app.post("/api/long-context/cancel/{run_id}")
    async def cancel_long_run(run_id: str):
        event = active_long_runs.get(run_id)
        if event is None:
            return {"ok": False, "reason": "Run not found or already finished"}
        event.set()
        return {"ok": True, "run_id": run_id}

    @app.get("/api/long-context/results")
    async def get_long_results():
        return long_context_results

    @app.get("/api/long-context/results/{run_id}")
    async def get_long_run(run_id: str):
        for r in long_context_results:
            if r["run_id"] == run_id:
                return r
        raise HTTPException(404, "Run not found")

    @app.delete("/api/long-context/results/{run_id}")
    async def delete_long_run(run_id: str):
        global long_context_results
        before = len(long_context_results)
        long_context_results = [r for r in long_context_results if r["run_id"] != run_id]
        if len(long_context_results) == before:
            raise HTTPException(404, "Run not found")
        await _save_results_async()
        return {"ok": True, "run_id": run_id}


async def _run_long_context_background(
    run_id: str,
    targets: list[dict],
    test_types: list[str],
    context_lengths: list[int],
    num_tests_per_length: int,
    needle_positions: list[str],
    cancel_event: asyncio.Event,
):
    from server import providers

    global_semaphore = asyncio.Semaphore(30)
    rng = random.Random(int(time.time()))
    seed = int(time.time())

    all_tests: list[dict] = []
    gen_count = 0
    for length in sorted(context_lengths):
        for ttype in test_types:
            for pos in needle_positions:
                for _ in range(num_tests_per_length):
                    try:
                        test = _generate_test(ttype, length, pos, rng)
                        test["target_length"] = length
                        all_tests.append(test)
                    except Exception as e:
                        log.warning("[long_context] failed to generate test: %s", e)
                    gen_count += 1
                    # Yield every 10 tests so the event loop can process health checks
                    if gen_count % 10 == 0:
                        await asyncio.sleep(0)

    log.info("[long_context] run %s: generated %d tests for %d models", run_id, len(all_tests), len(targets))

    async def call_model(client: httpx.AsyncClient, model_info: dict, provider: dict,
                         prompt: str, expected: str) -> dict:
        model_id = model_info["model_id"]
        url = _api_url(provider["base_url"], "/v1/chat/completions")
        headers = {
            "Authorization": f"Bearer {provider['api_key']}",
            "Content-Type": "application/json",
        }

        start = time.perf_counter()
        try:
            async with global_semaphore:
                r = await client.post(
                    url,
                    headers=headers,
                    json={
                        "model": model_id,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0,
                        "max_tokens": 512,
                    },
                    timeout=60.0,
                )
            elapsed = (time.perf_counter() - start) * 1000

            if r.status_code != 200:
                return {"actual": None, "correct": False, "error": f"HTTP {r.status_code}",
                        "latency_ms": elapsed, "raw": ""}

            body = r.json()
            content = body.get("choices", [{}])[0].get("message", {}).get("content", "")
            extracted = _extract_answer(content, expected)
            ok = _normalize(extracted) == _normalize(expected)
            if not ok and _normalize(expected) in _normalize(content):
                ok = True
                extracted = expected
            return {"actual": extracted, "correct": ok, "error": None,
                    "latency_ms": elapsed, "raw": content[:500]}

        except Exception as e:
            elapsed = (time.perf_counter() - start) * 1000
            return {"actual": None, "correct": False, "error": str(e)[:200],
                    "latency_ms": elapsed, "raw": ""}

    async def run_model_tests(model_info: dict):
        from server import providers as srv_providers
        full_id = model_info["id"]
        provider_id = model_info.get("provider_id")
        provider = srv_providers.get(provider_id)

        if not provider:
            prog = long_run_progress.get(run_id)
            if prog:
                prog["models"][full_id]["error"] = "Provider not found"
                prog["models"][full_id]["completed"] = len(all_tests)
            return

        client_limits = httpx.Limits(max_keepalive_connections=5, max_connections=15, keepalive_expiry=30)
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(60, connect=15),
            limits=client_limits,
            follow_redirects=True,
            verify=False,
        ) as client:
            model_passed = 0
            model_total = 0
            by_length: dict[str, dict] = {}
            details: list[dict] = []

            for test in all_tests:
                if cancel_event.is_set():
                    break

                result = await call_model(client, model_info, provider, test["prompt"], test["expected"])

                length_key = str(test["target_length"])
                if length_key not in by_length:
                    by_length[length_key] = {"passed": 0, "total": 0, "details": []}
                by_length[length_key]["total"] += 1
                if result["correct"]:
                    by_length[length_key]["passed"] += 1
                    model_passed += 1
                model_total += 1

                detail_entry = {
                    "test_type": test["test_type"],
                    "target_length": test["target_length"],
                    "needle_position": test.get("needle_position", "n/a"),
                    "question": test.get("question", ""),
                    "expected": test["expected"],
                    "actual": result["actual"],
                    "correct": result["correct"],
                    "error": result["error"],
                    "latency_ms": result["latency_ms"],
                    "context_tokens": test.get("context_tokens", 0),
                }
                by_length[length_key]["details"].append(detail_entry)
                details.append(detail_entry)

                prog = long_run_progress.get(run_id)
                if prog:
                    prog["models"][full_id]["completed"] = model_total
                    prog["models"][full_id]["passed"] = model_passed
                    prog["models"][full_id]["by_length"] = {
                        k: {"passed": v["passed"], "total": v["total"]}
                        for k, v in by_length.items()
                    }
                    prog["completed_tests"] = sum(
                        m["completed"] for m in prog["models"].values()
                    )

                await asyncio.sleep(0)

            degradation = _calc_degradation(by_length, context_lengths)

            final_result = {
                "id": full_id,
                "model_id": model_info["model_id"],
                "provider_name": model_info.get("provider_name", ""),
                "passed": model_passed,
                "total": model_total,
                "by_length": {k: {"passed": v["passed"], "total": v["total"], "details": v["details"]} for k, v in by_length.items()},
                "degradation_score": degradation,
                "error": None,
            }

            log.info("[long_context] %s finished: %d/%d passed, degradation=%.3f",
                     model_info["model_id"], model_passed, model_total, degradation)
            return final_result

    try:
        tasks = [run_model_tests(t) for t in targets]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        model_results = []
        for r in results:
            if isinstance(r, dict):
                model_results.append(r)
            elif isinstance(r, Exception):
                log.warning("[long_context] model task failed: %s", r)

        total_passed = sum(r.get("passed", 0) for r in model_results)
        total_questions = sum(r.get("total", 0) for r in model_results)

        final_run = {
            "run_id": run_id,
            "timestamp": datetime.now().isoformat(),
            "results": model_results,
            "total_models": len(targets),
            "total_passed": total_passed,
            "total_questions": total_questions,
            "test_types": test_types,
            "context_lengths": context_lengths,
            "num_tests_per_length": num_tests_per_length,
            "needle_positions": needle_positions,
            "seed": seed,
            "completed": not cancel_event.is_set(),
            "cancelled": cancel_event.is_set(),
        }

        long_context_results.insert(0, final_run)
        await _save_results_async()

        prog = long_run_progress.get(run_id)
        if prog:
            prog["running"] = False
            prog["completed"] = True

        log.info("[long_context] run %s completed: %d/%d passed", run_id, total_passed, total_questions)

    except Exception as e:
        log.error("[long_context] run %s crashed: %s", run_id, e)
        prog = long_run_progress.get(run_id)
        if prog:
            prog["running"] = False
            prog["error"] = str(e)

    finally:
        active_long_runs.pop(run_id, None)


def _calc_degradation(by_length: dict[str, dict], context_lengths: list[int]) -> float:
    if not by_length:
        return 0.0

    accuracies = []
    for length in sorted(context_lengths):
        key = str(length)
        if key in by_length and by_length[key]["total"] > 0:
            acc = by_length[key]["passed"] / by_length[key]["total"]
            accuracies.append(acc)

    if not accuracies or len(accuracies) < 2:
        return accuracies[0] if accuracies else 0.0

    first_acc = accuracies[0]
    if first_acc == 0:
        return 0.0

    total_drop = 0.0
    for acc in accuracies[1:]:
        drop = max(0, first_acc - acc)
        total_drop += drop
    avg_drop = total_drop / (len(accuracies) - 1)

    score = max(0.0, 1.0 - (avg_drop / max(first_acc, 0.01)))
    return round(score, 3)
