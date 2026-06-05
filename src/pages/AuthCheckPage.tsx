import { Component, createSignal, createEffect, onMount, For, Show, Index } from "solid-js"
import { api, AuthCheckResult, AuthCheckProgress, AuthDimension, Provider, Model } from "../api"
import { uiState } from "../store"
import ConfirmModal from "../components/ConfirmModal"

const DIMENSION_ORDER = [
  "self_id",
  "knowledge",
  "capability",
  "consistency",
  "format",
  "hallucination",
  "injection",
  "jailbreak",
  "safety",
  "performance",
]

const DIMENSION_LABELS: Record<string, string> = {
  self_id: "Self Identification",
  knowledge: "Knowledge Alignment",
  capability: "Capability Level",
  consistency: "Response Consistency",
  format: "Format Compliance",
  hallucination: "Hallucination Resistance",
  injection: "Injection Resistance",
  jailbreak: "Jailbreak Resistance",
  safety: "Safety Guardrails",
  performance: "Performance Profile",
}

const DIMENSION_ICONS: Record<string, string> = {
  self_id: "ID",
  knowledge: "KN",
  capability: "CP",
  consistency: "CS",
  format: "FM",
  hallucination: "HL",
  injection: "IN",
  jailbreak: "JB",
  safety: "SF",
  performance: "PF",
}

const DIMENSION_DESCRIPTIONS: Record<string, string> = {
  self_id: "Tests whether the model correctly identifies itself as the claimed model, using multiple techniques including direct ID queries, system prompt extraction, and trick prompts.",
  knowledge: "Verifies the model's knowledge cutoff date matches what's expected for the claimed model. Tests awareness of major AI releases up to the claimed training date.",
  capability: "Evaluates reasoning, math, and coding ability. Compares actual capability level against what's expected from the claimed model family.",
  consistency: "Sends identical prompts multiple times to check if answers are stable. Genuine models produce deterministic outputs; proxies with model routing may show variance.",
  format: "Tests precise instruction-following: exact JSON output, word count constraints, character restrictions, and multilingual formatting.",
  hallucination: "Asks about fabricated papers, companies, people, and events. Genuine models should admit they don't know; weak models may fabricate plausible-sounding information.",
  injection: "Attempts to override the model's system instructions via role-reversal, debug-mode claims, base64-encoded hidden instructions, and DAN-lite attacks.",
  jailbreak: "Tests resistance to known jailbreak techniques including the Grandma exploit, developer-role impersonation, encoded attacks, and the DAN persona.",
  safety: "Checks core safety guardrails: medical advice, legal advice, personal privacy, weapons, crisis response, and impersonation of licensed professionals.",
  performance: "Measures response latency and token throughput. Used to correlate performance patterns with known characteristics of the claimed model's backend infrastructure.",
}

const GRADE_COLORS: Record<string, string> = {
  A: "text-[var(--color-success)]",
  B: "text-[var(--color-gold)]",
  C: "text-yellow-400",
  D: "text-orange-400",
  F: "text-[var(--color-danger)]",
}

const GRADE_BG: Record<string, string> = {
  A: "bg-emerald-500/20 border-emerald-500/40",
  B: "bg-amber-500/20 border-amber-500/40",
  C: "bg-yellow-500/20 border-yellow-500/40",
  D: "bg-orange-500/20 border-orange-500/40",
  F: "bg-red-500/20 border-red-500/40",
}

const AuthCheckPage: Component = () => {
  const [providers, setProviders] = createSignal<Provider[]>([])
  const [models, setModels] = createSignal<Model[]>([])
  const [selectedProviderId, setSelectedProviderId] = createSignal("")
  const [selectedModelId, setSelectedModelId] = createSignal("")

  const [running, setRunning] = createSignal(false)
  const [cancelling, setCancelling] = createSignal(false)
  const [progress, setProgress] = createSignal<AuthCheckProgress | null>(null)
  const [result, setResult] = createSignal<AuthCheckResult | null>(null)
  const [currentRunId, setCurrentRunId] = createSignal<string | null>(null)
  const [elapsed, setElapsed] = createSignal(0)
  const [runStartTime, setRunStartTime] = createSignal<number | null>(null)

  const [history, setHistory] = createSignal<AuthCheckResult[]>([])
  const [expandedResult, setExpandedResult] = createSignal<string | null>(null)
  const [expandedDim, setExpandedDim] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [deleteTarget, setDeleteTarget] = createSignal<string | null>(null)

  const loadHistory = async () => {
    try {
      const r = await api.getAuthResults()
      setHistory(r)
    } catch { /* ignore */ }
  }

  const loadProviders = async () => {
    try {
      const p = await api.listProviders()
      setProviders(p)
      if (p.length > 0 && !selectedProviderId()) {
        setSelectedProviderId(p[0].id)
      }
    } catch { /* ignore */ }
  }

  const loadModels = async (providerId: string) => {
    if (!providerId) {
      setModels([])
      return
    }
    try {
      const m = await api.listModels(providerId)
      setModels(m)
      if (m.length > 0) {
        setSelectedModelId(m[0].id)
      } else {
        setSelectedModelId("")
      }
    } catch {
      setModels([])
      setSelectedModelId("")
    }
  }

  onMount(async () => {
    await loadProviders()
    const pid = selectedProviderId()
    if (pid) await loadModels(pid)
    loadHistory()
  })

  createEffect(async () => {
    const tab = uiState.activeTab
    if (tab === "auth") {
      await loadProviders()
      const pid = selectedProviderId()
      if (pid) await loadModels(pid)
    }
  })

  const handleProviderChange = async (pid: string) => {
    setSelectedProviderId(pid)
    await loadModels(pid)
  }

  const selectedProvider = () => providers().find(p => p.id === selectedProviderId())
  const selectedModel = () => models().find(m => m.id === selectedModelId())

  const handleRun = async () => {
    const provider = selectedProvider()
    const model = selectedModel()
    if (!provider || !model) {
      setError("Please select a provider and a model")
      return
    }
    setError(null)
    setResult(null)
    setRunning(true)
    setCancelling(false)
    setRunStartTime(Date.now())
    setElapsed(0)

    const timer = setInterval(() => {
      if (runStartTime()) {
        setElapsed(Math.round((Date.now() - runStartTime()!) / 1000))
      }
    }, 1000)

    try {
      const { run_id } = await api.runAuthCheck({
        endpoint: provider.base_url,
        api_key: provider.api_key,
        model: model.model_id,
        api_type: "openai",
      })
      setCurrentRunId(run_id)

      await new Promise<void>((resolve) => {
        const doPoll = async () => {
          try {
            const p = await api.getAuthProgress(run_id)
            setProgress(p)

            if (p.completed && p.result) {
              setResult(p.result)
              setRunning(false)
              setCancelling(false)
              clearInterval(pollId)
              await loadHistory()
              resolve()
            } else if (!p.running && !p.completed) {
              setRunning(false)
              setCancelling(false)
              clearInterval(pollId)
              await loadHistory()
              resolve()
            }
          } catch { /* poll failed */ }
        }
        doPoll()
        const pollId = window.setInterval(doPoll, 1500)
      })
    } catch (e) {
      setError(String(e))
      setRunning(false)
    } finally {
      clearInterval(timer)
      setCurrentRunId(null)
    }
  }

  const handleStop = async () => {
    const id = currentRunId()
    if (id) {
      setCancelling(true)
      try { await api.cancelAuthCheck(id) } catch { /* */ }
    }
  }

  const handleDelete = async (runId: string) => {
    setDeleteTarget(runId)
  }

  const confirmDelete = async () => {
    const id = deleteTarget()
    if (!id) return
    setDeleteTarget(null)
    try {
      await api.deleteAuthResult(id)
      await loadHistory()
    } catch (e) {
      setError(String(e))
    }
  }

  const formatTime = (s: number) => {
    if (s < 60) return `${s}s`
    return `${Math.floor(s / 60)}m ${s % 60}s`
  }

  const percentColor = (pct: number) => {
    if (pct >= 90) return "bg-emerald-500"
    if (pct >= 75) return "bg-[var(--color-gold)]"
    if (pct >= 60) return "bg-yellow-500"
    if (pct >= 40) return "bg-orange-500"
    return "bg-red-500"
  }

  const percentTextColor = (pct: number) => {
    if (pct >= 90) return "text-emerald-400"
    if (pct >= 75) return "text-[var(--color-gold)]"
    if (pct >= 60) return "text-yellow-400"
    if (pct >= 40) return "text-orange-400"
    return "text-red-400"
  }

  const toggleDim = (dim: string) => {
    setExpandedDim(expandedDim() === dim ? null : dim)
  }

  const toggleResultDetail = (runId: string) => {
    setExpandedResult(expandedResult() === runId ? null : runId)
  }

  const ResultSummary: Component<{ r: AuthCheckResult; compact?: boolean }> = (props) => {
    const r = () => props.r
    return (
      <div>
        <div class="flex items-center gap-3 mb-4">
          <div class={`text-3xl font-bold ${GRADE_COLORS[r().grade] || "text-white"}`}>
            {r().grade}
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">
              {r().endpoint} / {r().model}
            </div>
            <div class="text-xs text-[var(--color-fg-muted)]">
              {formatTime(Math.round((new Date(r().timestamp).getTime() - new Date(r().timestamp).getTime()) / 1000) || 0)}
              {new Date(r().timestamp).toLocaleString()}
              {" - "}
              {r().verdict}
            </div>
          </div>
          <div class={`text-lg font-semibold ${percentTextColor(r().overall_percent)}`}>
            {r().overall_percent.toFixed(0)}%
          </div>
        </div>

        <div class="flex gap-2 mb-3">
          <Show when={r().is_suspect}>
            <span class="text-xs px-2 py-0.5 rounded-full bg-red-900/30 text-red-400 border border-red-900/50">
              Suspected Reverse
            </span>
          </Show>
          <Show when={!r().iq_ok}>
            <span class="text-xs px-2 py-0.5 rounded-full bg-orange-900/30 text-orange-400 border border-orange-900/50">
              Reasoning Degraded
            </span>
          </Show>
          <Show when={!r().is_suspect && r().iq_ok}>
            <span class="text-xs px-2 py-0.5 rounded-full bg-emerald-900/30 text-emerald-400 border border-emerald-900/50">
              Consistent
            </span>
          </Show>
          <span class="text-xs px-2 py-0.5 rounded-full bg-[var(--color-ink-3)] text-[var(--color-fg-muted)]">
            {r().perf.probe_count} probes
          </span>
          <span class="text-xs px-2 py-0.5 rounded-full bg-[var(--color-ink-3)] text-[var(--color-fg-muted)]">
            {r().perf.avg_latency_ms.toFixed(0)}ms avg
          </span>
        </div>

        <div class="flex flex-col gap-2">
          <For each={DIMENSION_ORDER}>
            {dim => {
              const d = () => r().dimensions[dim]
              return (
                <Show when={d()}>
                  <div>
                    <button
                      class="w-full flex items-center gap-2 text-left text-xs group"
                      onClick={() => toggleDim(dim)}
                    >
                      <span class="w-6 h-6 flex items-center justify-center rounded bg-[var(--color-ink-3)] text-[var(--color-fg-muted)] text-[10px] font-mono shrink-0">
                        {DIMENSION_ICONS[dim]}
                      </span>
                      <span class="w-32 text-[var(--color-fg-muted)] shrink-0">
                        {DIMENSION_LABELS[dim] || dim}
                      </span>
                      <div class="flex-1 h-2 bg-[var(--color-ink-3)] rounded-full overflow-hidden">
                        <div
                          class={`h-full transition-all duration-500 ${percentColor(d().percent)}`}
                          style={{ width: `${d().percent}%` }}
                        />
                      </div>
                      <span class={`w-12 text-right font-mono shrink-0 ${percentTextColor(d().percent)}`}>
                        {d().percent.toFixed(0)}%
                      </span>
                      <span class="text-[var(--color-ink-1)] group-hover:text-[var(--color-fg-muted)] transition shrink-0">
                        {expandedDim() === dim ? "v" : ">"}
                      </span>
                    </button>
                    <Show when={expandedDim() === dim && d().probes}>
                      <div class="ml-8 mt-1 mb-2 flex flex-col gap-1">
                        <Show when={DIMENSION_DESCRIPTIONS[dim]}>
                          <div class="text-[10px] text-[var(--color-fg-muted)] bg-[var(--color-bg)] rounded px-2 py-1.5 mb-1 border border-[var(--color-border)]/50">
                            {DIMENSION_DESCRIPTIONS[dim]}
                          </div>
                        </Show>
                        <For each={d().probes}>
                          {probe => (
                            <Show when={probe.analysis}>
                              <div class={`text-[11px] border-l-2 rounded pl-2 py-1.5 ${
                                probe.analysis.score >= probe.analysis.max
                                  ? "border-emerald-500/60 bg-emerald-900/10"
                                  : probe.analysis.score > 0
                                  ? "border-yellow-500/60 bg-yellow-900/10"
                                  : "border-red-500/60 bg-red-900/10"
                              }`}>
                                <div class="flex items-start gap-2 mb-1">
                                  <span class={`font-mono text-[10px] shrink-0 mt-0.5 ${
                                    probe.analysis.score >= probe.analysis.max
                                      ? "text-emerald-400"
                                      : probe.analysis.score > 0
                                      ? "text-yellow-400"
                                      : "text-red-400"
                                  }`}>
                                    {probe.analysis.score >= probe.analysis.max ? "PASS" : "FAIL"}
                                  </span>
                                  <span class="font-mono text-[var(--color-accent-muted)]">
                                    {probe.probe_id}
                                  </span>
                                  <span class={`font-mono ${probe.analysis.score >= probe.analysis.max ? "text-emerald-400" : probe.analysis.score > 0 ? "text-yellow-400" : "text-red-400"}`}>
                                    {probe.analysis.score}/{probe.analysis.max}
                                  </span>
                                  <Show when={probe.latency_ms > 0}>
                                    <span class="text-[var(--color-fg-muted)] ml-auto shrink-0">
                                      {probe.latency_ms.toFixed(0)}ms
                                    </span>
                                  </Show>
                                </div>
                                <Show when={probe.description}>
                                  <div class="text-[var(--color-fg-muted)] mb-0.5 text-[10px]">
                                    <span class="text-[var(--color-accent-muted)] font-semibold">What:</span>{" "}
                                    {probe.description}
                                  </div>
                                </Show>
                                <Show when={probe.why}>
                                  <div class="text-[var(--color-fg-muted)] mb-1 text-[10px]">
                                    <span class="text-[var(--color-accent-muted)] font-semibold">Why:</span>{" "}
                                    {probe.why}
                                  </div>
                                </Show>
                                <details class="mb-1">
                                  <summary class="text-[10px] text-[var(--color-ink-1)] cursor-pointer hover:text-[var(--color-accent)] transition">
                                    Show prompt
                                  </summary>
                                  <div class="text-[10px] text-[var(--color-ink-1)] bg-[var(--color-surface)] rounded px-2 py-1 mt-0.5 max-w-sm whitespace-pre-wrap font-mono">
                                    {probe.prompt}
                                  </div>
                                </details>
                                <For each={probe.analysis.signals}>
                                  {sig => (
                                    <div class={`pl-2 ${
                                      sig.toLowerCase().includes("correctly") || sig.toLowerCase().includes("pass")
                                        ? "text-emerald-400"
                                        : sig.toLowerCase().includes("halluc") || sig.toLowerCase().includes("accepted") || sig.toLowerCase().includes("compromised") || sig.toLowerCase().includes("complied")
                                        ? "text-red-400"
                                        : "text-[var(--color-fg-muted)]"
                                    }`}>
                                      {sig}
                                    </div>
                                  )}
                                </For>
                                <Show when={probe.response}>
                                  <details class="mt-1">
                                    <summary class="text-[10px] text-[var(--color-ink-1)] cursor-pointer hover:text-[var(--color-accent)] transition">
                                      Show response ({(probe.response ?? "").length} chars)
                                    </summary>
                                    <div class="text-[10px] text-[var(--color-ink-1)] bg-[var(--color-surface)] rounded px-2 py-1 mt-0.5 max-w-sm whitespace-pre-wrap border-l border-[var(--color-border)]">
                                      {probe.response}
                                    </div>
                                  </details>
                                </Show>
                              </div>
                            </Show>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                </Show>
              )
            }}
          </For>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1 class="text-2xl font-bold mb-2">Auth Check</h1>
      <p class="text-xs text-[var(--color-fg-muted)] mb-6">
        Black-box detection to verify if an API endpoint is serving the claimed model.
      </p>

      <form
        onSubmit={e => { e.preventDefault(); handleRun() }}
        class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 mb-6 flex flex-col gap-3"
      >
        <div class="text-sm font-semibold text-[var(--color-accent-muted)] mb-1">Select Model</div>

        <div class="flex gap-3">
          <select
            class="flex-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] transition cursor-pointer"
            value={selectedProviderId()}
            onChange={e => handleProviderChange(e.currentTarget.value)}
          >
            <Show when={providers().length === 0}>
              <option value="" disabled>No providers configured</option>
            </Show>
            <For each={providers()}>
              {p => (
                <option value={p.id}>{p.name}</option>
              )}
            </For>
          </select>

          <select
            class="flex-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] transition cursor-pointer"
            value={selectedModelId()}
            onChange={e => setSelectedModelId(e.currentTarget.value)}
          >
            <Show when={models().length === 0}>
              <option value="" disabled>No models available</option>
            </Show>
            <For each={models()}>
              {m => (
                <option value={m.id}>{m.model_id}</option>
              )}
            </For>
          </select>
        </div>

        <Show when={selectedProvider()}>
          {p => (
            <div class="text-xs text-[var(--color-fg-muted)] font-mono">
              {p().base_url}
            </div>
          )}
        </Show>

        <div class="flex justify-end mt-1">
          <button
            type="submit"
            disabled={running() || !selectedProvider() || !selectedModel()}
            class="bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white px-6 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50"
          >
            {running() ? `Detecting (${formatTime(elapsed())})...` : "Run Detection"}
          </button>
        </div>
      </form>

      <Show when={error()}>
        <div class="text-[var(--color-danger)] text-sm mb-4 px-4 py-2 bg-red-900/20 border border-red-900/40 rounded-lg">
          {error()}
        </div>
      </Show>

      <Show when={running() && progress()}>
        {p => (
          <div class="bg-[var(--color-surface)] border border-[var(--color-accent)]/40 rounded-xl p-5 mb-6">
            <div class="flex items-center justify-between mb-3">
              <div class="text-sm font-semibold text-[var(--color-accent)]">
                Detecting...
              </div>
              <div class="text-xs text-[var(--color-fg-muted)] tabular-nums">
                {p().completed_count}/{p().total_count} probes
              </div>
            </div>

            <div class="h-2 bg-[var(--color-bg)] rounded-full overflow-hidden mb-3">
              <div
                class="h-full bg-[var(--color-accent)] transition-all duration-300"
                style={{ width: `${p().total_count > 0 ? (p().completed_count / p().total_count) * 100 : 0}%` }}
              />
            </div>

            <Show when={p().current_probe}>
              <div class="text-xs text-[var(--color-fg-muted)] mb-2">
                Current: <span class="font-mono">{p().current_probe}</span>
              </div>
            </Show>

            <Show when={p().signals.length > 0}>
              <div class="flex flex-col gap-0.5 max-h-32 overflow-auto">
                <For each={p().signals.slice(-8)}>
                  {sig => (
                    <div class="text-[11px] text-[var(--color-fg-muted)] truncate">
                      {sig}
                    </div>
                  )}
                </For>
              </div>
            </Show>

            <div class="flex justify-end mt-3">
              <button
                class="bg-[var(--color-danger)] hover:bg-[var(--color-danger-hover)] text-white font-medium text-xs px-4 py-1.5 rounded-lg transition disabled:opacity-50"
                disabled={cancelling()}
                onClick={handleStop}
              >
                {cancelling() ? "Stopping..." : "Cancel"}
              </button>
            </div>
          </div>
        )}
      </Show>

      <Show when={result()}>
        {r => (
          <div class={`bg-[var(--color-surface)] border rounded-xl p-5 mb-6 ${
            r().is_suspect ? "border-red-900/60" : "border-[var(--color-border)]"
          }`}>
            <ResultSummary r={r()} />
          </div>
        )}
      </Show>

      <Show when={history().length > 0}>
        <h2 class="text-sm font-semibold text-[var(--color-fg-muted)] mb-3">History</h2>
        <div class="flex flex-col gap-3">
          <For each={history()}>
            {r => (
              <div class={`bg-[var(--color-surface)] border rounded-xl px-5 py-4 ${
                r.is_suspect ? "border-red-900/40" : "border-[var(--color-border)]"
              }`}>
                <div class="flex items-center gap-3">
                  <div class={`text-2xl font-bold ${GRADE_COLORS[r.grade] || "text-white"}`}>
                    {r.grade}
                  </div>
                  <div class="flex-1 min-w-0 cursor-pointer" onClick={() => toggleResultDetail(r.run_id)}>
                    <div class="text-sm font-medium truncate">
                      {r.model} @ {r.endpoint}
                    </div>
                    <div class="text-xs text-[var(--color-fg-muted)]">
                      {new Date(r.timestamp).toLocaleString()}
                    </div>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <span class={`text-sm font-semibold ${percentTextColor(r.overall_percent)}`}>
                      {r.overall_percent.toFixed(0)}%
                    </span>
                    <Show when={r.is_suspect}>
                      <span class="text-[10px] px-1.5 py-0.5 rounded bg-red-900/30 text-red-400">
                        R
                      </span>
                    </Show>
                    <button
                      class="text-[var(--color-ink-1)] hover:text-[var(--color-danger)] transition text-xs"
                      onClick={() => handleDelete(r.run_id)}
                    >
                      x
                    </button>
                  </div>
                </div>

                <Show when={expandedResult() === r.run_id}>
                  <div class="mt-3 pt-3 border-t border-[var(--color-border)]">
                    <ResultSummary r={r} compact />
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={!running() && !result() && !history().length && !error()}>
        <div class="text-center text-[var(--color-fg-muted)] py-12">
          {providers().length === 0
            ? "Add a provider in the Providers tab first to start detection."
            : "Select a provider and model to start detection."}
        </div>
      </Show>

      <Show when={deleteTarget()}>
        <ConfirmModal
          open={true}
          title="Delete Result"
          message="Delete this detection result? This cannot be undone."
          confirmText="Delete"
          cancelText="Cancel"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      </Show>
    </div>
  )
}

export default AuthCheckPage
