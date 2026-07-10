import { Component, createSignal, onMount, For, Show, Index } from "solid-js"
import { api, Model, LongContextRunResult, LongContextProgress } from "../api"
import { usePolling } from "../hooks/usePolling"

const TEST_TYPES = [
  { value: "niah", label: "大海捞针 (NIAH)", desc: "在长文本中隐藏一个事实，测试模型能否找到并回答" },
  { value: "kv_retrieval", label: "键值检索 (KV)", desc: "在长文本中嵌入键值对，测试模型能否检索特定值" },
  { value: "counting", label: "计数 (Counting)", desc: "测试模型能否精确统计长文本中特定词的出现次数" },
  { value: "multi_hop", label: "多跳推理 (Multi-Hop)", desc: "链式事实分布在不同位置，测试模型多跳推理能力" },
]

const CONTEXT_LENGTHS = [
  { value: 2048, label: "2K" },
  { value: 4096, label: "4K" },
  { value: 8192, label: "8K" },
  { value: 16384, label: "16K" },
  { value: 32768, label: "32K" },
  { value: 65536, label: "64K" },
  { value: 131072, label: "128K" },
  { value: 262144, label: "256K" },
]

const NEEDLE_POSITIONS = [
  { value: "start", label: "开头" },
  { value: "middle", label: "中间" },
  { value: "end", label: "末尾" },
]

const BENCHMARKS = [
  { name: "NIAH (gkamradt)", stars: "2.3K", url: "github.com/gkamradt/needle-in-a-haystack", desc: "经典大海捞针测试，生成热力图" },
  { name: "LongBench v2", stars: "1.2K", url: "github.com/THUDM/LongBench", desc: "6大类503题，8K-2M词，人类专家仅53.7%" },
  { name: "RULER (NVIDIA)", stars: "1.6K", url: "github.com/NVIDIA/RULER", desc: "揭示模型真实上下文长度，4K-128K" },
  { name: "InfiniteBench", stars: "386", url: "github.com/OpenBMB/InfiniteBench", desc: "首个100K+基准，12类任务3882题" },
  { name: "L-Eval", stars: "405", url: "github.com/OpenLMLab/LEval", desc: "20类子任务，2000+标注，ACL杰出论文" },
  { name: "NoLiMa (Adobe)", stars: "198", url: "github.com/adobe-research/NoLiMa", desc: "NIAH变体，无词汇重叠，ICML 2025" },
  { name: "BABILong", stars: "249", url: "github.com/booydar/babilong", desc: "20类推理任务，0-10M tokens，NeurIPS" },
  { name: "Loong", stars: "154", url: "github.com/MozerWang/Loong", desc: "多文档QA，测试跨文档综合能力" },
]

const LongContextPage: Component = () => {
  const [queue, setQueue] = createSignal<Model[]>([])
  const [running, setRunning] = createSignal(false)
  const [cancelling, setCancelling] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [progress, setProgress] = createSignal<LongContextProgress | null>(null)
  const [latestRun, setLatestRun] = createSignal<LongContextRunResult | null>(null)
  const [history, setHistory] = createSignal<LongContextRunResult[]>([])
  const [currentRunId, setCurrentRunId] = createSignal<string | null>(null)
  const [elapsed, setElapsed] = createSignal(0)
  const [runStartTime, setRunStartTime] = createSignal<number | null>(null)
  const [expandedHistory, setExpandedHistory] = createSignal<string | null>(null)
  const [expandedDetail, setExpandedDetail] = createSignal<string | null>(null)

  const [selectedTypes, setSelectedTypes] = createSignal<string[]>(["niah", "kv_retrieval"])
  const [selectedLengths, setSelectedLengths] = createSignal<number[]>([2048, 4096, 8192, 16384, 32768])
  const [selectedPositions, setSelectedPositions] = createSignal<string[]>(["start", "middle", "end"])
  const [numTestsPerLength, setNumTestsPerLength] = createSignal(5)

  const load = async (silent = false) => {
    if (running()) return
    try {
      const [q, results] = await Promise.all([
        api.getQueue(),
        api.getLongContextResults(),
      ])
      setQueue(q)
      setHistory(results)
      if (results.length > 0 && !latestRun()) {
        setLatestRun(results[0])
      }
      if (silent) setError(null)
    } catch (e) {
      if (!silent) setError(String(e))
    }
  }

  onMount(() => load())
  usePolling(() => load(true), 5000)

  const pollRef = { id: null as ReturnType<typeof setInterval> | null }

  const toggleType = (val: string) => {
    setSelectedTypes(prev =>
      prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]
    )
  }

  const toggleLength = (val: number) => {
    setSelectedLengths(prev =>
      prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val].sort((a, b) => a - b)
    )
  }

  const togglePosition = (val: string) => {
    setSelectedPositions(prev =>
      prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]
    )
  }

  const handleRun = async () => {
    const q = queue()
    if (!q.length) return
    if (!selectedTypes().length || !selectedLengths().length) return

    setRunning(true)
    setError(null)
    setLatestRun(null)
    setProgress(null)
    setCurrentRunId(null)
    setRunStartTime(Date.now())
    setElapsed(0)

    const timer = setInterval(() => {
      if (runStartTime()) {
        setElapsed(Math.round((Date.now() - runStartTime()!) / 1000))
      }
    }, 1000)

    try {
      const { run_id } = await api.runLongContext({
        model_ids: q.map(m => m.id),
        test_types: selectedTypes(),
        context_lengths: selectedLengths(),
        num_tests_per_length: numTestsPerLength(),
        needle_positions: selectedPositions(),
      })
      setCurrentRunId(run_id)

      await new Promise<void>((resolve) => {
        const doPoll = async () => {
          try {
            const p = await api.getLongContextProgress(run_id)
            setProgress(p)
            if (p.completed || !p.running) {
              if (pollRef.id) clearInterval(pollRef.id)
              try {
                const result = await api.getLongContextResultById(run_id)
                setLatestRun(result)
              } catch { /* ignore */ }
              setRunning(false)
              resolve()
            }
          } catch { /* retry next poll */ }
        }
        doPoll()
        pollRef.id = setInterval(doPoll, 2000)
      })
    } catch (e: any) {
      setError(String(e))
    } finally {
      clearInterval(timer)
      setCurrentRunId(null)
      setCancelling(false)
      setRunning(false)
      load()
    }
  }

  const handleCancel = async () => {
    const id = currentRunId()
    setCancelling(true)
    if (id) {
      try { await api.cancelLongContext(id) } catch { /* ignore */ }
    }
  }

  const handleDelete = async (runId: string) => {
    try {
      await api.deleteLongContextResult(runId)
      setHistory(prev => prev.filter(r => r.run_id !== runId))
      if (latestRun()?.run_id === runId) setLatestRun(null)
    } catch { /* ignore */ }
  }

  const formatTime = (s: number) => {
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    const rem = s % 60
    return `${m}m ${rem}s`
  }

  const formatLength = (tokens: number) => {
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(0)}M`
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}K`
    return String(tokens)
  }

  const degradeColor = (score: number) => {
    if (score >= 0.9) return "text-emerald-400"
    if (score >= 0.7) return "text-yellow-400"
    if (score >= 0.5) return "text-orange-400"
    return "text-red-400"
  }

  const degradeBg = (score: number) => {
    if (score >= 0.9) return "bg-emerald-500/20 border-emerald-500/40"
    if (score >= 0.7) return "bg-yellow-500/20 border-yellow-500/40"
    if (score >= 0.5) return "bg-orange-500/20 border-orange-500/40"
    return "bg-red-500/20 border-red-500/40"
  }

  const accColor = (pct: number) => {
    if (pct >= 80) return "#34d399"
    if (pct >= 60) return "#fbbf24"
    if (pct >= 40) return "#fb923c"
    return "#f87171"
  }

  const totalEstimate = () => {
    return selectedTypes().length * selectedLengths().length * numTestsPerLength() * selectedPositions().length
  }

  const ChartBars = (props: { result: import("../api").LongContextModelResult }) => {
    const lengths = () => Object.keys(props.result.by_length).map(Number).sort((a, b) => a - b)
    const maxTotal = () => Math.max(...lengths().map(l => props.result.by_length[String(l)]?.total || 1))
    return (
      <div class="flex items-end gap-2 h-32 px-2">
        <For each={lengths()}>
          {len => {
            const stats = () => props.result.by_length[String(len)]
            const pct = () => stats() && stats().total > 0 ? Math.round((stats().passed / stats().total) * 100) : 0
            return (
              <div class="flex-1 flex flex-col items-center gap-1">
                <span class="text-[10px] font-bold tabular-nums" style={{ color: accColor(pct()) }}>
                  {pct()}%
                </span>
                <div class="w-full bg-[var(--color-bg)] rounded-sm overflow-hidden relative" style={{ height: "80px" }}>
                  <div
                    class="absolute bottom-0 left-0 right-0 rounded-sm transition-all"
                    style={{
                      height: `${pct()}%`,
                      background: accColor(pct()),
                      opacity: 0.85,
                    }}
                  />
                </div>
                <span class="text-[10px] text-[var(--color-fg-muted)] tabular-nums">
                  {formatLength(len)}
                </span>
                <span class="text-[9px] text-[var(--color-fg-muted)]">
                  {stats()?.passed}/{stats()?.total}
                </span>
              </div>
            )
          }}
        </For>
      </div>
    )
  }

  const ResultCard = (props: { run: LongContextRunResult; highlight?: boolean }) => (
    <div class={`bg-[var(--color-surface)] border rounded-xl p-5 ${
      props.highlight ? "border-[var(--color-accent)]/40" : "border-[var(--color-border)]"
    }`}>
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-3">
          <span class="text-xs font-mono text-[var(--color-fg-muted)]">{props.run.run_id}</span>
          <span class="text-xs text-[var(--color-fg-muted)]">
            {new Date(props.run.timestamp).toLocaleString()}
          </span>
          <Show when={props.run.cancelled}>
            <span class="text-xs text-orange-400 bg-orange-500/20 px-2 py-0.5 rounded">已取消</span>
          </Show>
          <span class="text-xs text-[var(--color-fg-muted)]">
            共 {props.run.total_passed}/{props.run.total_questions}
          </span>
        </div>
        <button
          class="text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-danger)] transition"
          onClick={() => handleDelete(props.run.run_id)}
        >
          删除
        </button>
      </div>

      <div class="flex flex-wrap gap-2 mb-4 text-[10px]">
        <For each={props.run.test_types}>
          {t => (
            <span class="bg-[var(--color-card)] border border-[var(--color-border)] px-2 py-0.5 rounded">
              {TEST_TYPES.find(tt => tt.value === t)?.label || t}
            </span>
          )}
        </For>
      </div>

      <div class="flex flex-col gap-4">
        <For each={props.run.results}>
          {(modelResult) => (
            <div class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
              <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-semibold">{modelResult.provider_name}: {modelResult.model_id}</span>
                </div>
                <div class="flex items-center gap-3">
                  <span class={`text-xs font-bold border rounded px-2 py-0.5 ${degradeBg(modelResult.degradation_score)}`}>
                    保持度: {(modelResult.degradation_score * 100).toFixed(0)}%
                  </span>
                  <span class={`text-sm font-bold ${degradeColor(modelResult.total > 0 ? modelResult.passed / modelResult.total : 0)}`}>
                    {modelResult.passed}/{modelResult.total}
                    {modelResult.total > 0 && ` (${Math.round(modelResult.passed / modelResult.total * 100)}%)`}
                  </span>
                </div>
              </div>
              <Show when={!modelResult.error}>
                <ChartBars result={modelResult} />
              </Show>
              <Show when={modelResult.error}>
                <div class="text-xs text-[var(--color-danger)]">{modelResult.error}</div>
              </Show>

              <button
                class="mt-3 text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-accent)] transition"
                onClick={() => setExpandedDetail(
                  expandedDetail() === `${props.run.run_id}_${modelResult.id}` ? null : `${props.run.run_id}_${modelResult.id}`
                )}
              >
                {expandedDetail() === `${props.run.run_id}_${modelResult.id}` ? "收起详情" : "展开详情"}
              </button>

              <Show when={expandedDetail() === `${props.run.run_id}_${modelResult.id}`}>
                <div class="mt-3 space-y-2">
                  <For each={Object.entries(modelResult.by_length).sort(([a], [b]) => Number(a) - Number(b))}>
                    {([len, stats]) => (
                      <details class="bg-[var(--color-bg)] rounded p-2">
                        <summary class="text-xs cursor-pointer hover:text-[var(--color-accent)]">
                          {formatLength(Number(len))}: {stats.passed}/{stats.total}
                          {stats.total > 0 && ` (${Math.round(stats.passed / stats.total * 100)}%)`}
                        </summary>
                        <div class="mt-2 space-y-1 max-h-60 overflow-auto">
                          <For each={stats.details}>
                            {d => (
                              <div class={`text-[10px] pl-2 border-l-2 ${d.correct ? "border-emerald-500" : "border-red-500"}`}>
                                <span class="text-[var(--color-fg-muted)]">[{d.test_type}/{d.needle_position}]</span>{" "}
                                <span>{d.question}</span>{" "}
                                <span class={d.correct ? "text-emerald-400" : "text-red-400"}>
                                  {d.correct ? "PASS" : `FAIL (期望: ${d.expected}, 实际: ${d.actual || d.error})`}
                                </span>
                              </div>
                            )}
                          </For>
                        </div>
                      </details>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  )

  return (
    <div>
      <h1 class="text-2xl font-bold mb-2">长上下文测试</h1>
      <p class="text-xs text-[var(--color-fg-muted)] mb-6">
        测试模型在不同上下文长度下的理解与检索能力。基于 NIAH、KV Retrieval、Counting、Multi-Hop 等主流方法。
      </p>

      <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 mb-6">
        <div class="text-sm font-semibold text-[var(--color-fg-muted)] mb-3">
          测试队列 ({queue().length})
        </div>
        <Show
          when={queue().length > 0}
          fallback={<div class="text-sm text-[var(--color-fg-muted)]">请在模型页面添加模型到队列</div>}
        >
          <div class="flex flex-wrap gap-2">
            <For each={queue()}>
              {m => (
                <span class="inline-flex items-center bg-[var(--color-card)] border border-[var(--color-border)] text-xs font-medium px-3 py-1.5 rounded-full">
                  {m.provider_name}: {m.model_id}
                </span>
              )}
            </For>
          </div>
        </Show>
      </div>

      <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 mb-6 flex flex-col gap-5">
        <div>
          <label class="text-sm font-medium text-[var(--color-fg-muted)] mb-2 block">测试类型</label>
          <div class="flex flex-wrap gap-2">
            <For each={TEST_TYPES}>
              {t => (
                <button
                  class={`text-xs px-3 py-2 rounded-lg border transition ${
                    selectedTypes().includes(t.value)
                      ? "bg-[var(--color-accent)]/20 border-[var(--color-accent)] text-[var(--color-accent)]"
                      : "bg-[var(--color-card)] border-[var(--color-border)] text-[var(--color-fg-muted)] hover:border-[var(--color-accent)]/50"
                  }`}
                  onClick={() => toggleType(t.value)}
                  title={t.desc}
                >
                  {t.label}
                </button>
              )}
            </For>
          </div>
        </div>

        <div>
          <label class="text-sm font-medium text-[var(--color-fg-muted)] mb-2 block">上下文长度</label>
          <div class="flex flex-wrap gap-2">
            <For each={CONTEXT_LENGTHS}>
              {l => (
                <button
                  class={`text-xs px-3 py-2 rounded-lg border transition font-mono ${
                    selectedLengths().includes(l.value)
                      ? "bg-[var(--color-accent)]/20 border-[var(--color-accent)] text-[var(--color-accent)]"
                      : "bg-[var(--color-card)] border-[var(--color-border)] text-[var(--color-fg-muted)] hover:border-[var(--color-accent)]/50"
                  }`}
                  onClick={() => toggleLength(l.value)}
                >
                  {l.label}
                </button>
              )}
            </For>
          </div>
        </div>

        <div>
          <label class="text-sm font-medium text-[var(--color-fg-muted)] mb-2 block">针位置 (NIAH/KV/Multi-Hop)</label>
          <div class="flex flex-wrap gap-2">
            <For each={NEEDLE_POSITIONS}>
              {p => (
                <button
                  class={`text-xs px-3 py-2 rounded-lg border transition ${
                    selectedPositions().includes(p.value)
                      ? "bg-[var(--color-accent)]/20 border-[var(--color-accent)] text-[var(--color-accent)]"
                      : "bg-[var(--color-card)] border-[var(--color-border)] text-[var(--color-fg-muted)] hover:border-[var(--color-accent)]/50"
                  }`}
                  onClick={() => togglePosition(p.value)}
                >
                  {p.label}
                </button>
              )}
            </For>
          </div>
        </div>

        <div class="flex items-center gap-4">
          <label class="text-sm text-[var(--color-fg-muted)]">每长度每类型题数：</label>
          <select
            class="bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-1.5 text-sm outline-none focus:border-[var(--color-accent)] transition"
            value={String(numTestsPerLength())}
            onChange={e => setNumTestsPerLength(parseInt(e.currentTarget.value) || 5)}
          >
            <option value="3">3</option>
            <option value="5">5</option>
            <option value="10">10</option>
            <option value="20">20</option>
          </select>
        </div>

        <div class="flex items-center justify-between gap-3">
          <div class="text-xs text-[var(--color-fg-muted)] flex-1">
            {running()
              ? `运行中... ${formatTime(elapsed())}${cancelling() ? " — 正在停止..." : ""}`
              : queue().length > 0
              ? `每模型 ${totalEstimate()} 题 × ${queue().length} 模型 = ${totalEstimate() * queue().length} 总请求`
              : "请在模型页面添加模型到队列"}
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <Show when={running()}>
              <button
                class="bg-[var(--color-danger)] hover:bg-[var(--color-danger-hover)] text-white font-medium text-sm px-4 py-2 rounded-lg transition disabled:opacity-50 flex items-center gap-1"
                disabled={cancelling()}
                onClick={handleCancel}
              >
                {cancelling() ? "停止中..." : "停止"}
              </button>
            </Show>
            <button
              class="bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white font-medium text-sm px-6 py-2 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={running() || queue().length === 0 || !selectedTypes().length || !selectedLengths().length}
              onClick={handleRun}
            >
              {running() ? `运行中 (${formatTime(elapsed())})...` : "开始测试"}
            </button>
          </div>
        </div>
      </div>

      <Show when={error()}>
        <div class="text-[var(--color-danger)] text-sm mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
          {error()}
        </div>
      </Show>

      <Show when={running() && progress()}>
        {p => (
          <div class="bg-[var(--color-surface)] border border-[var(--color-accent)]/40 rounded-xl p-5 mb-6">
            <div class="text-sm font-semibold text-[var(--color-accent)] mb-4">
              实时进度 ({p().completed_tests}/{p().total_tests})
            </div>
            <div class="flex flex-col gap-3">
              <For each={Object.values(p().models)}>
                {m => (
                  <div class="flex flex-col gap-1.5">
                    <div class="flex items-center justify-between text-xs">
                      <span class="font-medium">{m.provider_name}: {m.model_id}</span>
                      <span class="text-[var(--color-fg-muted)] tabular-nums">
                        {m.completed}/{m.total}
                        {m.total > 0 && ` (${Math.round(m.completed / m.total * 100)}%)`}
                        {m.passed > 0 && ` | ${m.passed} passed`}
                      </span>
                    </div>
                    <div class="h-1.5 bg-[var(--color-bg)] rounded-full overflow-hidden">
                      <div
                        class="h-full bg-[var(--color-accent)] transition-all duration-300"
                        style={{ width: m.total > 0 ? `${(m.completed / m.total) * 100}%` : "0%" }}
                      />
                    </div>
                    <Show when={Object.keys(m.by_length).length > 0}>
                      <div class="flex gap-3 text-[10px] text-[var(--color-fg-muted)]">
                        <For each={Object.entries(m.by_length).sort(([a], [b]) => Number(a) - Number(b))}>
                          {([len, stats]) => (
                            <span>
                              {formatLength(Number(len))}: {stats.passed}/{stats.total}
                            </span>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </div>
        )}
      </Show>

      <Show when={latestRun()}>
        {run => (
          <div class="mb-6">
            <h2 class="text-sm font-semibold text-[var(--color-fg-muted)] mb-3">最近一次运行</h2>
            <ResultCard run={run()} highlight />
          </div>
        )}
      </Show>

      <Show when={history().length > 1 || (history().length > 0 && !latestRun())}>
        <div class="mb-6">
          <h2 class="text-sm font-semibold text-[var(--color-fg-muted)] mb-3">历史记录</h2>
          <div class="flex flex-col gap-3">
            <For each={history().filter(r => r.run_id !== latestRun()?.run_id)}>
              {r => (
                <div>
                  <button
                    class="w-full text-left"
                    onClick={() => setExpandedHistory(
                      expandedHistory() === r.run_id ? null : r.run_id
                    )}
                  >
                    <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 hover:border-[var(--color-accent)]/30 transition">
                      <div class="flex items-center justify-between">
                        <div class="flex items-center gap-3">
                          <span class="text-xs font-mono text-[var(--color-fg-muted)]">{r.run_id}</span>
                          <span class="text-xs text-[var(--color-fg-muted)]">
                            {new Date(r.timestamp).toLocaleString()}
                          </span>
                        </div>
                        <div class="flex items-center gap-2">
                          <span class="text-xs">
                            {r.total_passed}/{r.total_questions}
                          </span>
                          <span class="text-[var(--color-fg-muted)]">
                            {expandedHistory() === r.run_id ? "收起" : "展开"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                  <Show when={expandedHistory() === r.run_id}>
                    <div class="mt-2">
                      <ResultCard run={r} />
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 mb-6">
        <div class="text-sm font-semibold text-[var(--color-accent)] mb-3">
          参考基准 & 开源测试框架
        </div>
        <p class="text-xs text-[var(--color-fg-muted)] mb-4">
          本页面内置了上述基准中常用的测试方法（NIAH / KV / Counting / Multi-Hop）。如需更完整的评估，可参考以下开源项目：
        </p>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <For each={BENCHMARKS}>
            {b => (
              <div class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-3">
                <div class="flex items-center justify-between mb-1">
                  <span class="text-xs font-semibold">{b.name}</span>
                  <span class="text-[10px] text-[var(--color-gold)]">{b.stars} stars</span>
                </div>
                <div class="text-[10px] text-[var(--color-fg-muted)] font-mono mb-1">{b.url}</div>
                <div class="text-[10px] text-[var(--color-ink-1)]">{b.desc}</div>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}

export default LongContextPage
