import { Component, createSignal, onMount, onCleanup, For, Show, Index } from "solid-js"
import { api, Model, TestRun, BankStats } from "../api"
import { ResultCard, formatElapsed, scoreColor, scoreBgColor } from "../components/ResultCard"
import { usePolling } from "../hooks/usePolling"

const PROFILES_LIST = [
  { value: "programmer", label: "程序员", desc: "编程25%+数学20%+逻辑20%+游戏15%+安全10%+常识10%" },
  { value: "full", label: "完整（8个类别）", desc: "所有类别按比例" },
  { value: "math_logic", label: "数学与逻辑", desc: "数学30%+逻辑30%+编程20%+常识20%" },
  { value: "safety", label: "安全", desc: "安全45%+语言25%+心理15%+常识15%" },
  { value: "quick", label: "快速筛查", desc: "编程25%+数学25%+逻辑20%+常识20%+安全10%" },
]

const CAT_LABELS: Record<string, string> = {
  coding_cs: "编程",
  math_reasoning: "数学",
  logical_reasoning: "逻辑",
  safety_guard: "安全",
  common_science: "常识",
  game_dev: "游戏",
  emotion_psychology: "心理",
  language_logic: "语言",
}

interface ModelProgress {
  id: string
  model_id: string
  provider_name: string
  started: boolean
  done: boolean
  completed: number
  passed: number
  total: number
  elapsedMs?: number
}

const TestsPage: Component = () => {
  const [queue, setQueue] = createSignal<Model[]>([])
  const [running, setRunning] = createSignal(false)
  const [stopping, setStopping] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [latestRun, setLatestRun] = createSignal<TestRun | null>(null)
  const [numTests, setNumTests] = createSignal(100)
  const [profile, setProfile] = createSignal("programmer")
  const [bankStats, setBankStats] = createSignal<BankStats | null>(null)
  const [progress, setProgress] = createSignal<Record<string, ModelProgress>>({})
  const [runStartTime, setRunStartTime] = createSignal<number | null>(null)
  const [elapsed, setElapsed] = createSignal(0)
  const [currentRunId, setCurrentRunId] = createSignal<string | null>(null)

  const load = async (silent = false) => {
    // Skip polling during test runs — the SSE stream provides live data,
    // and additional HTTP requests waste browser connection slots
    // (browsers limit to 6 per host, competing with the SSE stream).
    if (running()) return

    try {
      const [q, r, b] = await Promise.all([api.getQueue(), api.getResults(), api.getBankStats()])

      const queueFingerprint = q.map(m => m.id).join('|')
      const currentQueueFingerprint = queue().map(m => m.id).join('|')
      if (queueFingerprint !== currentQueueFingerprint) {
        setQueue(q)
      }

      if (r.length > 0) {
        const latestRunData = r[0]
        const currentRun = latestRun()
        if (!currentRun ||
            currentRun.run_id !== latestRunData.run_id ||
            currentRun.total_passed !== latestRunData.total_passed) {
          setLatestRun(latestRunData)
        }
      } else if (latestRun() !== null) {
        setLatestRun(null)
      }

      setBankStats(b)
      if (silent) setError(null)
    } catch (e) {
      if (!silent) setError(String(e))
    }
  }
  onMount(() => load())
  usePolling(() => load(true), 5000)

  const handleRun = async () => {
    const q = queue()
    if (!q.length) return
    setRunning(true)
    setError(null)
    setLatestRun(null)
    setCurrentRunId(null)

    const initialProgress: Record<string, ModelProgress> = {}
    for (const m of q) {
      initialProgress[m.id] = {
        id: m.id,
        model_id: m.model_id,
        provider_name: m.provider_name,
        started: false,
        done: false,
        completed: 0,
        passed: 0,
        total: numTests(),
      }
    }
    setProgress(initialProgress)
    setRunStartTime(Date.now())
    setElapsed(0)

    const timer = setInterval(() => {
      if (runStartTime()) {
        setElapsed(Math.round((Date.now() - runStartTime()!) / 1000))
      }
    }, 1000)

    try {
      const body = JSON.stringify({
        model_ids: q.map(m => m.id),
        num_tests: numTests(),
        profile: profile(),
      })

      const res = await fetch("http://localhost:8765/api/test/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      })

      if (!res.ok) {
        const text = await res.text().catch(() => "")
        throw new Error(text || `${res.status} ${res.statusText}`)
      }

      const { run_id } = await res.json()
      setCurrentRunId(run_id)

      // Wrap polling in a promise so we can await completion
      await new Promise<void>((resolve) => {
        const doPoll = async () => {
          if (!run_id) { clearInterval(pollId); resolve(); return }
          try {
            const pRes = await fetch(`http://localhost:8765/api/test/progress/${run_id}`)
            if (!pRes.ok) return
            const data = await pRes.json()

            // Update model progress
            const newProgress: Record<string, ModelProgress> = {}
            for (const m of data.models || []) {
              const key = m.full_id || `${run_id}_${m.model_id}`
              newProgress[key] = {
                id: key,
                model_id: m.model_id,
                provider_name: m.provider_name || "",
                started: m.completed > 0 || m.in_flight > 0,
                done: m.completed >= m.total && m.total > 0,
                completed: m.completed,
                passed: m.passed || 0,
                total: m.total,
              }
            }
            setProgress(prev => {
              const merged = { ...prev }
              for (const [k, v] of Object.entries(newProgress)) {
                merged[k] = { ...merged[k], ...v, started: merged[k]?.started || v.started, done: merged[k]?.done || v.done }
              }
              return merged
            })

            if (data.completed || (!data.running && data.total_completed > 0)) {
              clearInterval(pollId)
              try {
                const results = await api.getResultById(run_id)
                setLatestRun(results)
              } catch { /* ignore */ }
              setRunning(false)
              resolve()
            }
          } catch {
            // Poll failed, retry next interval
          }
        }

        doPoll() // Immediate first poll
        const pollId = window.setInterval(doPoll, 2000)
      })

    } catch (e: any) {
      setError(String(e))
    } finally {
      clearInterval(timer)
      setCurrentRunId(null)
      setStopping(false)
      setRunning(false)
    }
  }

  const handleStop = async () => {
    const id = currentRunId()
    setStopping(true)
    if (id) {
      try { await api.cancelRun(id) } catch { /* backend may already be closing */ }
    }
  }

  const handleRemove = async (id: string) => {
    try {
      await api.removeFromQueue(id)
      await load()
    } catch (e) {
      setError(String(e))
    }
  }

  const formatTime = (s: number) => {
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    const rem = s % 60
    if (m < 60) return `${m}m ${rem}s`
    const h = Math.floor(m / 60)
    const remM = m % 60
    return `${h}h ${remM}m`
  }

  return (
    <div>
      <h1 class="text-2xl font-bold mb-6">评测</h1>

      {/* Queue */}
      <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 mb-6">
        <div class="text-sm font-semibold text-[var(--color-fg-muted)] mb-3">
          测试队列（{queue().length}）
        </div>
        <Show
          when={queue().length > 0}
          fallback={<div class="text-sm text-[var(--color-fg-muted)]">队列为空。请在模型页面添加模型。</div>}
        >
          <div class="flex flex-wrap gap-2">
            <For each={queue()}>
              {m => (
                <span class="inline-flex items-center gap-2 bg-[var(--color-card)] border border-[var(--color-border)] text-xs font-medium px-3 py-1.5 rounded-full">
                  {m.provider_name}: {m.model_id}
                  <button
                    class="text-[var(--color-danger)] hover:text-[var(--color-danger-hover)] transition"
                    onClick={() => handleRemove(m.id)}
                  >
                    ✕
                  </button>
                </span>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* Bank info */}
      <Show when={bankStats()}>
        {stats => (
          <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 mb-6">
            <div class="text-sm font-semibold text-[var(--color-accent)] mb-2">
              题库：{stats().loaded ? `已加载 ${stats().total.toLocaleString()} 个问题` : "未加载"}
            </div>
            <Show when={stats().loaded}>
              <div class="flex flex-wrap gap-2">
                <For each={Object.entries(stats().categories)}>
                  {([cat, count]) => (
                    <span class="text-xs bg-[var(--color-card)] border border-[var(--color-border)] px-2 py-1 rounded">
                      {CAT_LABELS[cat] || cat}: {count}
                    </span>
                  )}
                </For>
              </div>
            </Show>
          </div>
        )}
      </Show>

      {/* Config & Run */}
      <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 mb-6 flex flex-col gap-4">
        <div class="flex items-center gap-4 flex-wrap">
          <label class="text-sm text-[var(--color-fg-muted)]">测评方案：</label>
          <select
            class="bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-1.5 text-sm outline-none focus:border-[var(--color-accent)] transition"
            value={profile()}
            onChange={e => setProfile(e.currentTarget.value)}
          >
            <For each={PROFILES_LIST}>
              {p => <option value={p.value}>{p.label}</option>}
            </For>
          </select>

          <label class="text-sm text-[var(--color-fg-muted)]">题目数：</label>
          <select
            class="bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-1.5 text-sm outline-none focus:border-[var(--color-accent)] transition"
            value={String(numTests())}
            onChange={e => setNumTests(parseInt(e.currentTarget.value) || 100)}
          >
            <option value="10">10</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="200">200</option>
            <option value="500">500</option>
            <option value="1000">1000</option>
          </select>
        </div>

        <div class="flex items-center justify-between gap-3">
          <div class="text-xs text-[var(--color-fg-muted)] flex-1 min-w-0">
            {running()
              ? `运行中... ${formatTime(elapsed())}${stopping() ? " — 正在停止..." : ""}`
              : queue().length > 0
              ? `${numTests()} 道随机题 × ${queue().length} 个模型 — 所有模型使用相同题目（并行）`
              : "请在模型页面将模型添加到队列以开始测试"}
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <Show when={running()}>
              <button
                class="bg-[var(--color-danger)] hover:bg-[var(--color-danger-hover)] text-white font-medium text-sm px-4 py-2 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                disabled={stopping()}
                onClick={handleStop}
                title="停止当前测试运行"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                </svg>
                {stopping() ? "停止中..." : "停止"}
              </button>
            </Show>
            <button
              class="bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white font-medium text-sm px-6 py-2 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={running() || queue().length === 0 || !bankStats()?.loaded}
              onClick={handleRun}
            >
              {running() ? `运行中（${formatTime(elapsed())}）...` : `开始测试`}
            </button>
          </div>
        </div>
      </div>

      <Show when={error()}>
        <div class="text-[var(--color-danger)] text-sm mb-4">{error()}</div>
      </Show>

      {/* Live progress */}
      <Show when={running()}>
        <div class="bg-[var(--color-surface)] border border-[var(--color-accent)]/40 rounded-xl p-5 mb-6">
          <div class="text-sm font-semibold text-[var(--color-accent)] mb-4">实时进度</div>
          <div class="flex flex-col gap-3">
            <For each={Object.values(progress())}>
              {p => (
                <div class="flex flex-col gap-1.5">
                  <div class="flex items-center justify-between text-xs">
                    <div class="flex items-center gap-2">
                      <span class="font-medium">{p.provider_name}: {p.model_id}</span>
                      <Show when={!p.started}>
                        <span class="text-[var(--color-fg-muted)]">等待中...</span>
                      </Show>
                      <Show when={p.started && !p.done}>
                        <span class="text-[var(--color-accent)] animate-pulse">测试中...</span>
                      </Show>
                      <Show when={p.done}>
                        <span class={scoreColor(p.passed, p.total)}>
                          {p.passed}/{p.total}
                        </span>
                        <Show when={p.elapsedMs}>
                          <span class="text-[var(--color-fg-muted)] ml-2">
                            {formatElapsed(p.elapsedMs!)}
                          </span>
                        </Show>
                      </Show>
                    </div>
                    <Show when={p.started}>
                      <span class="text-[var(--color-fg-muted)] tabular-nums">
                        {p.completed}/{p.total}
                        {p.total > 0 && (
                          <span class="ml-2">({Math.round((p.completed / p.total) * 100)}%)</span>
                        )}
                      </span>
                    </Show>
                  </div>
                  <div class="h-1.5 bg-[var(--color-bg)] rounded-full overflow-hidden">
                    <div
                      class={`h-full transition-all duration-300 ${
                        p.done ? scoreBgColor(p.passed, p.total) : "bg-[var(--color-accent)]"
                      }`}
                      style={{ width: p.total > 0 ? `${(p.completed / p.total) * 100}%` : "0%" }}
                    />
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Latest result only */}
      <Show when={latestRun()}>
        {run => (
          <>
            <h2 class="text-sm font-semibold text-[var(--color-fg-muted)] mb-3">最近一次运行</h2>
            <ResultCard run={run()} highlight />
          </>
        )}
      </Show>

      <Show when={!queue().length && !latestRun() && !running()}>
        <div class="text-center text-[var(--color-fg-muted)] py-12">
          请在模型页面将模型添加到队列以开始测试。
        </div>
      </Show>
    </div>
  )
}

export default TestsPage
