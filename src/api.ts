export interface Provider {
  id: string
  name: string
  base_url: string
  api_key: string
  created_at: string
}

export interface Model {
  id: string
  provider_id: string
  provider_name: string
  model_id: string
  owned_by: string
}

export interface PromptResult {
  prompt: string
  expected: string
  actual: string | null
  correct: boolean
  error: string | null
  latency_ms: number
  category?: string
  retries?: number
  timed_out?: boolean
  cancelled?: boolean
}

export interface CategoryStats {
  passed: number
  total: number
}

export interface ModelResult {
  id?: string
  model_id: string
  provider_name: string
  passed: number
  total: number
  avg_latency_ms: number
  elapsed_ms?: number
  details: PromptResult[]
  error: string | null
  error_count?: number
  categories?: Record<string, CategoryStats>
  completed?: number
}

export interface TestRun {
  run_id: string
  timestamp: string
  results: ModelResult[]
  total_models: number
  total_passed: number
  total_questions: number
  total_answered?: number
  seed?: number
  profile?: string
  num_tests?: number
  category_sampled?: Record<string, number>
  completed?: boolean
  cancelled?: boolean
}

export interface BankStats {
  total: number
  categories: Record<string, number>
  loaded: boolean
  profiles: Record<string, { desc: string; cats: string[] }>
}

export interface AuthProbeAnalysis {
  score: number
  max: number
  signals: string[]
  response_preview: string
}

export interface AuthProbeResult {
  probe_id: string
  dimension: string
  prompt: string
  response: string | null
  error: string | null
  latency_ms: number
  tokens: number
  analysis: AuthProbeAnalysis
  description?: string
  why?: string
}

export interface AuthDimension {
  name: string
  score: number
  max: number
  percent: number
  weight: number
  probes: AuthProbeResult[]
}

export interface AuthCheckResult {
  run_id: string
  timestamp: string
  endpoint: string
  model: string
  api_type: string
  claimed_family: string
  dimensions: Record<string, AuthDimension>
  overall_percent: number
  grade: string
  verdict: string
  is_suspect: boolean
  iq_ok: boolean
  probe_results: AuthProbeResult[]
  perf: {
    avg_latency_ms: number
    total_tokens: number
    probe_count: number
  }
}

export interface AuthCheckProgress {
  run_id: string
  running: boolean
  completed: boolean
  phase: string
  current_probe: string
  completed_count: number
  total_count: number
  signals: string[]
  result: AuthCheckResult | null
}

export interface LongContextTestDetail {
  test_type: string
  target_length: number
  needle_position: string
  question: string
  expected: string
  actual: string | null
  correct: boolean
  error: string | null
  latency_ms: number
  context_tokens: number
}

export interface LongContextLengthStats {
  passed: number
  total: number
  details: LongContextTestDetail[]
}

export interface LongContextModelResult {
  id: string
  model_id: string
  provider_name: string
  passed: number
  total: number
  by_length: Record<string, LongContextLengthStats>
  degradation_score: number
  error: string | null
}

export interface LongContextRunResult {
  run_id: string
  timestamp: string
  results: LongContextModelResult[]
  total_models: number
  total_passed: number
  total_questions: number
  test_types: string[]
  context_lengths: number[]
  num_tests_per_length: number
  needle_positions: string[]
  seed: number
  completed: boolean
  cancelled: boolean
}

export interface LongContextModelProgress {
  model_id: string
  provider_name: string
  completed: number
  total: number
  by_length: Record<string, { passed: number; total: number }>
  passed: number
  error: string | null
}

export interface QuickTestResult {
  model_id: string
  passed: number
  total: number
  score: number
  profile: string
  category_stats: Record<string, number>
  details: Array<{
    category?: string
    expected?: string
    actual?: string
    correct: boolean
    error?: string | null
    latency_ms: number
  }>
}

export interface LongContextProgress {
  run_id: string
  running: boolean
  completed: boolean
  total_tests: number
  completed_tests: number
  models: Record<string, LongContextModelProgress>
  elapsed_s: number
}

const BASE = "http://localhost:8765"
const MAX_CONCURRENT = 4
const inFlight: Map<string, Promise<any>> = new Map()
let openRequests = 0
const waitQueue: Array<{ fn: () => void; slot: () => number }> = []

function acquireSlot(): Promise<() => void> {
  return new Promise((resolveAcquire) => {
    const tryStart = () => {
      if (openRequests < MAX_CONCURRENT) {
        openRequests++
        resolveAcquire(() => {
          openRequests--
          if (waitQueue.length > 0) {
            waitQueue.shift()?.fn()
          }
        })
      } else {
        waitQueue.push({ fn: tryStart, slot: () => openRequests })
      }
    }
    tryStart()
  })
}

export const api = {
  health: () => fetchJson<{ status: string; bank_loaded: boolean; bank_size: number }>("/api/health"),

  listProviders: () => fetchJson<Provider[]>("/api/providers"),
  createProvider: (d: { name: string; base_url: string; api_key: string }) =>
    fetchJson<Provider>("/api/providers", { method: "POST", body: JSON.stringify(d) }),
  deleteProvider: (id: string) =>
    fetchJson<void>(`/api/providers/${id}`, { method: "DELETE" }),

  listModels: (providerId?: string) => {
    const q = providerId ? `?provider_id=${providerId}` : ""
    return fetchJson<Model[]>(`/api/models${q}`)
  },
  fetchProviderModels: (id: string) =>
    fetchJson<Model[]>(`/api/providers/${id}/models`, {}, 30000),
  deleteModel: (id: string) =>
    fetchJson<void>(`/api/models/${id}`, { method: "DELETE" }),

  getQueue: () => fetchJson<Model[]>("/api/test/queue"),
  addToQueue: (ids: string[]) =>
    fetchJson<{ added: string[]; queue_size: number }>("/api/test/queue", {
      method: "POST",
      body: JSON.stringify(ids),
    }),
  removeFromQueue: (id: string) =>
    fetchJson<void>(`/api/test/queue/${id}`, { method: "DELETE" }),

  getBankStats: () => fetchJson<BankStats>("/api/test/bank"),

  runTest: (ids: string[], numTests: number, profile: string, seed?: number) =>
    fetchJson<TestRun>("/api/test/run", {
      method: "POST",
      body: JSON.stringify({ model_ids: ids, num_tests: numTests, profile, seed }),
    }, 120000),
  cancelRun: (runId: string) =>
    fetchJson<{ ok: boolean; run_id: string; reason?: string }>(`/api/test/cancel/${runId}`, {
      method: "POST",
    }),
  getResults: () => fetchJson<TestRun[]>("/api/test/results"),
  getResultById: (runId: string) => fetchJson<TestRun>(`/api/test/results/${runId}`),
  deleteResult: (runId: string) =>
    fetchJson<void>(`/api/test/results/${runId}`, { method: "DELETE" }),

  runAuthCheck: (d: { endpoint: string; api_key: string; model: string; api_type: string }) =>
    fetchJson<{ run_id: string }>("/api/auth-check/run", {
      method: "POST",
      body: JSON.stringify(d),
    }, 120000),
  getAuthProgress: (runId: string) =>
    fetchJson<AuthCheckProgress>(`/api/auth-check/progress/${runId}`),
  cancelAuthCheck: (runId: string) =>
    fetchJson<{ ok: boolean }>(`/api/auth-check/cancel/${runId}`, { method: "POST" }),
  getAuthResults: () => fetchJson<AuthCheckResult[]>("/api/auth-check/results"),
  getAuthResultById: (runId: string) =>
    fetchJson<AuthCheckResult>(`/api/auth-check/results/${runId}`),
  deleteAuthResult: (runId: string) =>
    fetchJson<void>(`/api/auth-check/results/${runId}`, { method: "DELETE" }),

  runSecurityCheck: (d: { endpoint: string; api_key: string; model: string; api_type: string }) =>
    fetchJson<{ run_id: string }>("/api/security-check/run", {
      method: "POST",
      body: JSON.stringify(d),
    }, 120000),
  getSecurityProgress: (runId: string) =>
    fetchJson<AuthCheckProgress>(`/api/security-check/progress/${runId}`),
  cancelSecurityCheck: (runId: string) =>
    fetchJson<{ ok: boolean }>(`/api/security-check/cancel/${runId}`, { method: "POST" }),
  getSecurityResults: () => fetchJson<AuthCheckResult[]>("/api/security-check/results"),
  getSecurityResultById: (runId: string) =>
    fetchJson<AuthCheckResult>(`/api/security-check/results/${runId}`),
  deleteSecurityResult: (runId: string) =>
    fetchJson<void>(`/api/security-check/results/${runId}`, { method: "DELETE" }),

  runLongContext: (d: {
    model_ids: string[]
    test_types: string[]
    context_lengths: number[]
    num_tests_per_length: number
    needle_positions: string[]
  }) =>
    fetchJson<{ run_id: string }>("/api/long-context/run", {
      method: "POST",
      body: JSON.stringify(d),
    }, 120000),
  getLongContextProgress: (runId: string) =>
    fetchJson<LongContextProgress>(`/api/long-context/progress/${runId}`),
  cancelLongContext: (runId: string) =>
    fetchJson<{ ok: boolean }>(`/api/long-context/cancel/${runId}`, { method: "POST" }),
  getLongContextResults: () => fetchJson<LongContextRunResult[]>("/api/long-context/results"),
  getLongContextResultById: (runId: string) =>
    fetchJson<LongContextRunResult>(`/api/long-context/results/${runId}`),
  deleteLongContextResult: (runId: string) =>
    fetchJson<void>(`/api/long-context/results/${runId}`, { method: "DELETE" }),

  quickTest: (d: { base_url: string; api_key: string; model_id: string; num_questions?: number; profile?: string }) =>
    fetchJson<QuickTestResult>("/api/quick-test", {
      method: "POST",
      body: JSON.stringify(d),
    }, 120000),
}

async function fetchJson<T>(
  path: string,
  opts: RequestInit = {},
  timeoutMs: number = 10000,
): Promise<T> {
  const cacheKey = `${opts.method || "GET"}:${path}:${(opts.body as string) || ""}`

  // De-deduplicate identical in-flight requests (only for GET)
  if (!opts.method || opts.method === "GET") {
    const existing = inFlight.get(cacheKey)
    if (existing) return existing as Promise<T>
  }

  const release = await acquireSlot()

  const controller = new AbortController()
  const timerId = window.setTimeout(
    () => controller.abort(new DOMException(`Timeout after ${timeoutMs}ms`, "AbortError")),
    timeoutMs,
  )

  const promise = (async (): Promise<T> => {
    try {
      const res = await fetch(BASE + path, {
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        ...opts,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        throw new Error(text ? `${res.status} ${text}` : `${res.status} ${res.statusText}`)
      }
      const text = await res.text()
      return text ? (JSON.parse(text) as T) : (undefined as T)
    } catch (e: any) {
      // Convert AbortError into a friendlier timeout message
      if (e?.name === "AbortError") {
        throw new Error(`Request timeout (${Math.round(timeoutMs / 1000)}s): ${path}`)
      }
      throw e
    } finally {
      window.clearTimeout(timerId)
      release()
      inFlight.delete(cacheKey)
    }
  })()

  if (!opts.method || opts.method === "GET") {
    inFlight.set(cacheKey, promise)
  }
  return promise
}
