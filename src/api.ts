export interface Provider {
  id: string
  name: string
  base_url: string
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
}

export interface CategoryStats {
  passed: number
  total: number
}

export interface ModelResult {
  model_id: string
  provider_name: string
  passed: number
  total: number
  avg_latency_ms: number
  details: PromptResult[]
  error: string | null
  categories?: Record<string, CategoryStats>
}

export interface TestRun {
  run_id: string
  timestamp: string
  results: ModelResult[]
  total_models: number
  total_passed: number
  total_questions: number
  seed?: number
  profile?: string
  num_tests?: number
  category_sampled?: Record<string, number>
}

export interface BankStats {
  total: number
  categories: Record<string, number>
  loaded: boolean
  profiles: Record<string, { desc: string; cats: string[] }>
}

const BASE = "http://localhost:8765"

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
    fetchJson<Model[]>(`/api/providers/${id}/models`),
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
    }),
  getResults: () => fetchJson<TestRun[]>("/api/test/results"),
}

async function fetchJson<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(text ? `${res.status} ${text}` : `${res.status} ${res.statusText}`)
  }
  const text = await res.text()
  return text ? (JSON.parse(text) as T) : (undefined as T)
}
