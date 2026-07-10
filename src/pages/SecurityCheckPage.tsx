import { Component, createSignal, createEffect, onMount, For, Show } from "solid-js"
import { api, AuthCheckResult, AuthCheckProgress, Provider, Model } from "../api"
import { uiState, setSecurityRunning } from "../store"
import ConfirmModal from "../components/ConfirmModal"

const SECURITY_DIMS = [
  "self_id",
  "injection",
  "reverse_proxy",
]

const SEC_LABELS: Record<string, string> = {
  self_id: "身份一致性检测",
  injection: "内容注入检测",
  reverse_proxy: "反代特征检测",
}

const SEC_ICONS: Record<string, string> = {
  self_id: "ID",
  injection: "IN",
  reverse_proxy: "RP",
}

const SEC_DESCS: Record<string, string> = {
  self_id: "通过多角度身份探测检测模型是否如实声明自身身份。包含直接询问、语言切换对比、能力声明验证、开发者诱导识别和知识截止日期核查等8项探测。反代模型常因底层模型不同而暴露真实身份，用于判断是否为反代发API。",
  injection: "检测模型对提示注入攻击的抵抗力。包含系统指令覆盖、角色扮演注入、Base64编码混淆、DAN攻击、嵌套指令注入、伪造系统标签、载荷拆分、上下文操纵和多语言绕过等9种攻击向量。用于判断代理层是否注入了自定义规则或安全护栏是否被削弱。",
  reverse_proxy: "综合检测API是否存在反向代理特征。包含数值一致性重复验证、事实类与逻辑类固定答案检验、响应风格连贯性分析、系统级错误响应测试、格式转换语义一致性检查和极简指令对比等7种反代信号探测。",
}

const GRADE_COLORS: Record<string, string> = {
  A: "text-[var(--color-success)]",
  B: "text-[var(--color-gold)]",
  C: "text-yellow-400",
  D: "text-orange-400",
  F: "text-[var(--color-danger)]",
}

const SecurityCheckPage: Component = () => {
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
      const r = await api.getSecurityResults()
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
    if (tab === "security") {
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
      setError("请选择一个供应商和模型")
      return
    }
    setError(null)
    setResult(null)
    setRunning(true)
    setSecurityRunning(true)
    setCancelling(false)
    setRunStartTime(Date.now())
    setElapsed(0)

    const timer = setInterval(() => {
      if (runStartTime()) {
        setElapsed(Math.round((Date.now() - runStartTime()!) / 1000))
      }
    }, 1000)

    try {
      const { run_id } = await api.runSecurityCheck({
        endpoint: provider.base_url,
        api_key: provider.api_key,
        model: model.model_id,
        api_type: "openai",
      })
      setCurrentRunId(run_id)

      await new Promise<void>((resolve) => {
        let stalledPolls = 0
        const doPoll = async () => {
          try {
            const p = await api.getSecurityProgress(run_id)
            setProgress(p)

            if (p.completed && p.result) {
              setResult(p.result)
              setRunning(false)
              setCancelling(false)
              clearInterval(pollId)
              await loadHistory()
              resolve()
            } else if (!p.running && !p.completed) {
              stalledPolls++
              if (stalledPolls >= 5) {
                setRunning(false)
                setCancelling(false)
                clearInterval(pollId)
                await loadHistory()
                resolve()
              }
            } else {
              stalledPolls = 0
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
      setSecurityRunning(false)
      setCurrentRunId(null)
    }
  }

  const handleStop = async () => {
    const id = currentRunId()
    if (id) {
      setCancelling(true)
      try { await api.cancelSecurityCheck(id) } catch { /* */ }
    }
  }

  const handleDelete = async (runId: string) => {
    setDeleteTarget(runId)
  }

  const confirmDelete = async () => {
    const id = deleteTarget()
    if (!id) return
    setDeleteTarget(null)
    const scrollEl = document.querySelector("main[tabindex]") || document.querySelector(".flex-1.overflow-auto") as HTMLElement | null
    const savedTop = scrollEl?.scrollTop ?? 0
    try {
      await api.deleteSecurityResult(id)
      await loadHistory()
      requestAnimationFrame(() => {
        if (scrollEl) scrollEl.scrollTop = savedTop
      })
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

  const getSecurityScore = (r: AuthCheckResult) => {
    const relevantDims = SECURITY_DIMS.filter(d => r.dimensions[d])
    if (relevantDims.length === 0) return 0
    const total = relevantDims.reduce((sum, d) => sum + r.dimensions[d].percent, 0)
    return total / relevantDims.length
  }

  const isReverseSuspect = (r: AuthCheckResult) => {
    const sid = r.dimensions["self_id"]
    const rp = r.dimensions["reverse_proxy"]
    const score1 = sid ? sid.percent : 100
    const score2 = rp ? rp.percent : 100
    return score1 < 60 || score2 < 60
  }

  const isInjectionVuln = (r: AuthCheckResult) => {
    const inj = r.dimensions["injection"]
    return inj ? inj.percent < 60 : false
  }

  const ResultSummary: Component<{ r: AuthCheckResult; compact?: boolean }> = (props) => {
    const r = () => props.r
    return (
      <div>
        <div class="flex items-center gap-3 mb-4">
          <div class={`text-2xl font-bold ${GRADE_COLORS[r().grade] || "text-white"}`}>
            {r().grade}
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">
              {r().endpoint} / {r().model}
            </div>
            <div class="text-xs text-[var(--color-fg-muted)]">
              {new Date(r().timestamp).toLocaleString()}
            </div>
          </div>
          <div class={`text-lg font-semibold ${percentTextColor(getSecurityScore(r()))}`}>
            {getSecurityScore(r()).toFixed(0)}%
          </div>
        </div>

        <div class="flex flex-wrap gap-2 mb-3">
          <Show when={isReverseSuspect(r())}>
            <span class="text-xs px-2 py-0.5 rounded-full bg-red-900/30 text-red-400 border border-red-900/50">
              疑似反代发
            </span>
          </Show>
          <Show when={isInjectionVuln(r())}>
            <span class="text-xs px-2 py-0.5 rounded-full bg-yellow-900/30 text-yellow-400 border border-yellow-900/50">
              注入漏洞
            </span>
          </Show>
          <Show when={!isReverseSuspect(r()) && !isInjectionVuln(r())}>
            <span class="text-xs px-2 py-0.5 rounded-full bg-emerald-900/30 text-emerald-400 border border-emerald-900/50">
              无异常
            </span>
          </Show>
          <span class="text-xs px-2 py-0.5 rounded-full bg-[var(--color-ink-3)] text-[var(--color-fg-muted)]">
            {r().perf.probe_count} 个探测
          </span>
        </div>

        <div class="flex flex-col gap-2">
          <For each={SECURITY_DIMS}>
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
                        {SEC_ICONS[dim]}
                      </span>
                      <span class="w-40 text-[var(--color-fg-muted)] shrink-0">
                        {SEC_LABELS[dim] || dim}
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
                        <Show when={SEC_DESCS[dim]}>
                          <div class="text-[10px] text-[var(--color-fg-muted)] bg-[var(--color-bg)] rounded px-2 py-1.5 mb-1 border border-[var(--color-border)]/50">
                            {SEC_DESCS[dim]}
                          </div>
                        </Show>
                        <For each={d().probes}>
                          {probe => (
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
                                    {probe.analysis.score >= probe.analysis.max ? "通过" : "失败"}
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
                                  <span class="text-[var(--color-accent-muted)] font-semibold">检测项：</span>{" "}
                                  {probe.description}
                                </div>
                              </Show>
                              <Show when={probe.why}>
                                <div class="text-[var(--color-fg-muted)] mb-1 text-[10px]">
                                  <span class="text-[var(--color-accent-muted)] font-semibold">原理：</span>{" "}
                                  {probe.why}
                                </div>
                              </Show>
                              <details class="mb-1">
                                <summary class="text-[10px] text-[var(--color-ink-1)] cursor-pointer hover:text-[var(--color-accent)] transition">
                                  查看Prompt
                                </summary>
                                <div class="text-[10px] text-[var(--color-ink-1)] bg-[var(--color-surface)] rounded px-2 py-1 mt-0.5 max-w-sm whitespace-pre-wrap font-mono">
                                  {probe.prompt}
                                </div>
                              </details>
                              <For each={probe.analysis.signals}>
                                {sig => (
                                  <div class={`pl-2 ${
                                    sig.toLowerCase().includes("correctly") || sig.toLowerCase().includes("pass") || sig.toLowerCase().includes("resisted") || sig.toLowerCase().includes("refused")
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
                                    查看响应 ({(probe.response ?? "").length} 字符)
                                  </summary>
                                  <div class="text-[10px] text-[var(--color-ink-1)] bg-[var(--color-surface)] rounded px-2 py-1 mt-0.5 max-w-sm whitespace-pre-wrap border-l border-[var(--color-border)]">
                                    {probe.response}
                                  </div>
                                </details>
                              </Show>
                            </div>
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
      <h1 class="text-2xl font-bold mb-2">Agent安全检测</h1>
      <p class="text-xs text-[var(--color-fg-muted)] mb-6">
        针对AI代理场景的安全检测，通过身份验证、注入测试和反代特征分析三大维度，检测反代发、内容注入等代理安全风险。
      </p>

      <form
        onSubmit={e => { e.preventDefault(); handleRun() }}
        class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 mb-6 flex flex-col gap-3"
      >
        <div class="text-sm font-semibold text-[var(--color-accent-muted)] mb-1">选择检测目标</div>

        <div class="flex gap-3">
          <select
            class="flex-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] transition cursor-pointer"
            value={selectedProviderId()}
            onChange={e => handleProviderChange(e.currentTarget.value)}
          >
            <Show when={providers().length === 0}>
              <option value="" disabled>未配置供应商</option>
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
              <option value="" disabled>没有可用模型</option>
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

        <div class="text-xs text-[var(--color-fg-muted)] bg-[var(--color-bg)] rounded px-3 py-2 border border-[var(--color-border)]/50">
          本次检测针对以下3个维度：身份一致性（8项探测）、内容注入检测（9项探测）、反代特征检测（7项探测）
        </div>

        <div class="flex justify-end mt-1">
          <button
            type="submit"
            disabled={running() || !selectedProvider() || !selectedModel()}
            class="bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white px-6 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50"
          >
            {running() ? `检测中 (${formatTime(elapsed())})...` : "开始检测"}
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
                {p().completed_count >= p().total_count ? "正在评分..." : "检测进行中..."}
              </div>
              <div class="text-xs text-[var(--color-fg-muted)] tabular-nums">
                {p().completed_count}/{p().total_count} 个探测
              </div>
            </div>

            <div class="h-2 bg-[var(--color-bg)] rounded-full overflow-hidden mb-3">
              <div
                class="h-full bg-[var(--color-accent)] transition-all duration-300"
                style={{ width: `${p().total_count > 0 ? (p().completed_count / p().total_count) * 100 : 0}%` }}
              />
            </div>

            <Show when={p().current_probe && p().completed_count < p().total_count}>
              <div class="text-xs text-[var(--color-fg-muted)] mb-2">
                当前: <span class="font-mono">{p().current_probe}</span>
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
                {cancelling() ? "取消中..." : "取消检测"}
              </button>
            </div>
          </div>
        )}
      </Show>

      <Show when={result()}>
        {r => (
          <div class={`bg-[var(--color-surface)] border rounded-xl p-5 mb-6 ${
            isReverseSuspect(r()) || isInjectionVuln(r()) ? "border-red-900/60" : "border-[var(--color-border)]"
          }`}>
            <ResultSummary r={r()} />
          </div>
        )}
      </Show>

      <Show when={history().length > 0}>
        <h2 class="text-sm font-semibold text-[var(--color-fg-muted)] mb-3">历史记录</h2>
        <div class="flex flex-col gap-3">
          <For each={history()}>
            {r => (
              <div class={`bg-[var(--color-surface)] border rounded-xl px-5 py-4 ${
                isReverseSuspect(r) || isInjectionVuln(r) ? "border-red-900/40" : "border-[var(--color-border)]"
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
                    <span class={`text-sm font-semibold ${percentTextColor(getSecurityScore(r))}`}>
                      {getSecurityScore(r).toFixed(0)}%
                    </span>
                    <Show when={isReverseSuspect(r)}>
                      <span class="text-[10px] px-1.5 py-0.5 rounded bg-red-900/30 text-red-400">
                        反代
                      </span>
                    </Show>
                    <Show when={isInjectionVuln(r)}>
                      <span class="text-[10px] px-1.5 py-0.5 rounded bg-yellow-900/30 text-yellow-400">
                        注入
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
            ? "请先在供应商标签页中添加一个供应商，然后开始Agent安全检测。"
            : "选择一个供应商和模型开始Agent安全检测。"}
        </div>
      </Show>

      <Show when={deleteTarget()}>
        <ConfirmModal
          open={true}
          title="删除结果"
          message="确定要删除这条检测结果吗？此操作无法撤销。"
          confirmText="删除"
          cancelText="取消"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      </Show>
    </div>
  )
}

export default SecurityCheckPage
