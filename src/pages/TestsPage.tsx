import { Component, createSignal, onMount, For, Show, Index } from "solid-js"
import { api, Model, TestRun, BankStats } from "../api"
import "./score-colors.css"

const PROFILES_LIST = [
  { value: "programmer", label: "Programmer", desc: "CS25%+Math20%+Logic20%+Game15%+Safety10%+Common10%" },
  { value: "full", label: "Full (8 categories)", desc: "All categories proportionally" },
  { value: "math_logic", label: "Math & Logic", desc: "Math30%+Logic30%+CS20%+Common20%" },
  { value: "safety", label: "Safety", desc: "Safety45%+Language25%+Psych15%+Common15%" },
  { value: "quick", label: "Quick Screen", desc: "CS25%+Math25%+Logic20%+Common20%+Safety10%" },
]

const CAT_LABELS: Record<string, string> = {
  coding_cs: "CS",
  math_reasoning: "Math",
  logical_reasoning: "Logic",
  safety_guard: "Safety",
  common_science: "Common",
  game_dev: "Game",
  emotion_psychology: "Psych",
  language_logic: "Language",
}

function scoreColor(passed: number, total: number): string {
  if (total === 0) return "score-yellow"
  const pct = (passed / total) * 100
  if (pct >= 95) return "score-gold"
  if (pct >= 80) return "score-green"
  if (pct >= 60) return "score-yellow"
  return "score-red"
}

function scoreBgColor(passed: number, total: number): string {
  if (total === 0) return "score-bg-yellow"
  const pct = (passed / total) * 100
  if (pct >= 95) return "score-bg-gold"
  if (pct >= 80) return "score-bg-green"
  if (pct >= 60) return "score-bg-yellow"
  return "score-bg-red"
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

interface ModelProgress {
  model_id: string
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
  const [error, setError] = createSignal<string | null>(null)
  const [results, setResults] = createSignal<TestRun[]>([])
  const [numTests, setNumTests] = createSignal(100)
  const [profile, setProfile] = createSignal("programmer")
  const [activeRun, setActiveRun] = createSignal<TestRun | null>(null)
  const [bankStats, setBankStats] = createSignal<BankStats | null>(null)
  const [progress, setProgress] = createSignal<Record<string, ModelProgress>>({})
  const [runStartTime, setRunStartTime] = createSignal<number | null>(null)
  const [elapsed, setElapsed] = createSignal(0)

  const load = async () => {
    try {
      const [q, r, b] = await Promise.all([api.getQueue(), api.getResults(), api.getBankStats()])
      setQueue(q)
      setResults(r)
      setBankStats(b)
    } catch (e) {
      setError(String(e))
    }
  }
  onMount(load)

  const handleRun = async () => {
    const q = queue()
    if (!q.length) return
    setRunning(true)
    setError(null)
    setActiveRun(null)

    const initialProgress: Record<string, ModelProgress> = {}
    for (const m of q) {
      initialProgress[m.model_id] = {
        model_id: m.model_id,
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

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "")
        throw new Error(text || `${res.status} ${res.statusText}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          const payload = line.slice(6).trim()
          if (!payload) continue

          try {
            const msg = JSON.parse(payload)
            if (msg.type === "model_start") {
              setProgress(prev => ({
                ...prev,
                [msg.model_id]: {
                  ...prev[msg.model_id],
                  started: true,
                },
              }))
            } else if (msg.type === "model_progress") {
              setProgress(prev => ({
                ...prev,
                [msg.model_id]: {
                  ...prev[msg.model_id],
                  started: true,
                  completed: msg.completed,
                  passed: msg.passed,
                  total: msg.total,
                },
              }))
            } else if (msg.type === "model_complete") {
              setProgress(prev => ({
                ...prev,
                [msg.model_id]: {
                  ...prev[msg.model_id],
                  done: true,
                  completed: msg.result.total,
                  passed: msg.result.passed,
                  total: msg.result.total,
                  elapsedMs: msg.result.elapsed_ms,
                },
              }))
            } else if (msg.type === "run_complete") {
              setActiveRun(msg.result)
              setResults(prev => [msg.result, ...prev])
            }
          } catch {
            // skip unparseable
          }
        }
      }
    } catch (e) {
      setError(String(e))
    } finally {
      clearInterval(timer)
      setRunning(false)
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
    return `${Math.floor(s / 60)}m ${s % 60}s`
  }

  return (
    <div>
      <h1 class="text-2xl font-bold mb-6">Tests</h1>

      {/* Queue */}
      <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 mb-6">
        <div class="text-sm font-semibold text-[var(--color-fg-muted)] mb-3">
          Test Queue ({queue().length})
        </div>
        <Show when={queue().length > 0} fallback={<div class="text-sm text-[var(--color-fg-muted)]">Queue is empty. Add models from the Models page.</div>}>
          <div class="flex flex-wrap gap-2">
            <For each={queue()}>
              {m => (
                <span class="inline-flex items-center gap-2 bg-[var(--color-card)] border border-[var(--color-border)] text-xs font-medium px-3 py-1.5 rounded-full">
                  {m.provider_name}: {m.model_id}
                  <button class="text-[var(--color-danger)] hover:text-[var(--color-danger-hover)] transition" onClick={() => handleRemove(m.id)}>
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
              Question Bank: {stats().loaded ? `${stats().total.toLocaleString()} questions loaded` : "Not loaded"}
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
            <Show when={!stats().loaded}>
              <div class="text-xs text-[var(--color-fg-muted)]">
                Build the question bank first: python scripts/build_question_bank.py
              </div>
            </Show>
          </div>
        )}
      </Show>

      {/* Config & Run */}
      <Show when={queue().length > 0}>
        <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 mb-6 flex flex-col gap-4">
          <div class="flex items-center gap-4 flex-wrap">
            <label class="text-sm text-[var(--color-fg-muted)]">Profile:</label>
            <select
              class="bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-1.5 text-sm outline-none focus:border-[var(--color-accent)] transition"
              value={profile()}
              onChange={e => setProfile(e.currentTarget.value)}
            >
              <For each={PROFILES_LIST}>
                {p => <option value={p.value}>{p.label}</option>}
              </For>
            </select>

            <label class="text-sm text-[var(--color-fg-muted)]">Questions:</label>
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

          <div class="flex items-center justify-between">
            <div class="text-xs text-[var(--color-fg-muted)]">
              {running()
                ? `Running... ${formatTime(elapsed())}`
                : `${numTests()} random questions × ${queue().length} model(s) — same questions for all models (parallel)`}
            </div>
            <button
              class="bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white font-medium text-sm px-6 py-2 rounded-lg transition disabled:opacity-50"
              disabled={running() || !bankStats()?.loaded}
              onClick={handleRun}
            >
              {running() ? `Running (${formatTime(elapsed())})...` : `Run Test`}
            </button>
          </div>
        </div>
      </Show>

      <Show when={error()}>
        <div class="text-[var(--color-danger)] text-sm mb-4">{error()}</div>
      </Show>

      {/* Live progress during run */}
      <Show when={running()}>
        <div class="bg-[var(--color-surface)] border border-[var(--color-accent)]/40 rounded-xl p-5 mb-6">
          <div class="text-sm font-semibold text-[var(--color-accent)] mb-4">Live Progress</div>
          <div class="flex flex-col gap-3">
            <For each={Object.values(progress())}>
              {p => (
                <div class="flex flex-col gap-1.5">
                  <div class="flex items-center justify-between text-xs">
                    <div class="flex items-center gap-2">
                      <span class="font-medium">{p.model_id}</span>
                      <Show when={!p.started}>
                        <span class="text-[var(--color-fg-muted)]">waiting...</span>
                      </Show>
                      <Show when={p.started && !p.done}>
                        <span class="text-[var(--color-accent)] animate-pulse">testing...</span>
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
                          <span class="ml-2">
                            ({Math.round((p.completed / p.total) * 100)}%)
                          </span>
                        )}
                      </span>
                    </Show>
                  </div>
                  <div class="h-1.5 bg-[var(--color-bg)] rounded-full overflow-hidden">
                    <div
                      class={`h-full transition-all duration-300 ${
                        p.done
                          ? scoreBgColor(p.passed, p.total)
                          : "bg-[var(--color-accent)]"
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

      {/* Active run */}
      <Show when={activeRun()}>
        {run => <RunCard run={run()} highlight />}
      </Show>

      {/* History */}
      <Show when={results().length > 0 && !activeRun()}>
        <div class="mb-4 text-sm text-[var(--color-fg-muted)] font-semibold">Previous Runs</div>
        <div class="flex flex-col gap-4">
          <For each={results().slice(0, 5)}>{run => <RunCard run={run} />}</For>
        </div>
      </Show>

      <Show when={!queue().length && !results().length}>
        <div class="text-center text-[var(--color-fg-muted)] py-12">
          Add models to the queue from the Models page to start testing.
        </div>
      </Show>
    </div>
  )
}

const RunCard: Component<{ run: TestRun; highlight?: boolean }> = props => {
  const [expanded, setExpanded] = createSignal<string | null>(null)
  const pct = () =>
    props.run.total_questions > 0
      ? Math.round((props.run.total_passed / props.run.total_questions) * 100)
      : 0

  return (
    <div
      class={`border rounded-xl p-5 mb-4 ${
        props.highlight
          ? "border-[var(--color-accent)]/40 bg-[var(--color-surface)]"
          : "border-[var(--color-border)] bg-[var(--color-surface)]"
      }`}
    >
      <div class="flex items-center justify-between mb-3">
        <div class="text-sm flex items-center gap-2 flex-wrap">
          <span class="font-mono text-[var(--color-accent)]">#{props.run.run_id}</span>
          <span class="text-[var(--color-fg-muted)]">
            {new Date(props.run.timestamp).toLocaleString()}
          </span>
          <Show when={props.run.profile}>
            <span class="text-xs bg-[var(--color-card)] border border-[var(--color-border)] px-2 py-0.5 rounded">
              {props.run.profile}
            </span>
          </Show>
          <Show when={props.run.num_tests}>
            <span class="text-xs bg-[var(--color-card)] border border-[var(--color-border)] px-2 py-0.5 rounded">
              {props.run.num_tests}q
            </span>
          </Show>
          <Show when={props.run.seed}>
            <span class="text-xs text-[var(--color-fg-muted)]">seed:{props.run.seed}</span>
          </Show>
        </div>
        <div class="text-sm">
          <span class={scoreColor(props.run.total_passed, props.run.total_questions)}>
            {props.run.total_passed}/{props.run.total_questions}
          </span>
          <span class="text-[var(--color-fg-muted)] ml-1">({pct()}%)</span>
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <For each={props.run.results}>
          {r => (
            <div class="bg-[var(--color-card)] rounded-lg p-3 text-sm">
              <div class="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(expanded() === r.model_id ? null : r.model_id)}>
                <div>
                  <span class="font-medium">{r.model_id}</span>
                  <span class="text-[var(--color-fg-muted)] text-xs ml-2">{r.provider_name}</span>
                </div>
                <div class="flex items-center gap-4 text-xs">
                  <Show when={r.elapsed_ms}>
                    <span class="text-[var(--color-fg-muted)]">
                      {formatElapsed(r.elapsed_ms!)}
                    </span>
                  </Show>
                  <span class="text-[var(--color-fg-muted)]">
                    {r.avg_latency_ms.toFixed(0)}ms avg
                  </span>
                  <span class={scoreColor(r.passed, r.total)}>
                    {r.passed}/{r.total}
                  </span>
                  <span class="text-[var(--color-fg-muted)]">{expanded() === r.model_id ? "▲" : "▼"}</span>
                </div>
              </div>

              <Show when={expanded() === r.model_id}>
                <div class="mt-3 border-t border-[var(--color-border)] pt-3">
                  {/* Category breakdown */}
                  <Show when={r.categories && Object.keys(r.categories).length > 0}>
                    <div class="flex flex-wrap gap-1 mb-3">
                      <For each={Object.entries(r.categories || {})}>
                        {([cat, stats]) => (
                          <span
                            class={`text-xs px-2 py-0.5 rounded ${stats.total > 0 ? scoreColor(stats.passed, stats.total) : "text-[var(--color-fg-muted)]"}`}
                          >
                            {CAT_LABELS[cat] || cat}: {stats.passed}/{stats.total}
                          </span>
                        )}
                      </For>
                    </div>
                  </Show>

                  <div class="flex flex-col gap-1">
                    <For each={r.details}>
                      {d => (
                        <div class="flex items-start gap-2 text-xs">
                          <span class={d.correct ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}>
                            {d.correct ? "✓" : "✗"}
                          </span>
                          <span class="flex-1 text-[var(--color-fg-muted)] truncate" title={d.prompt}>{d.prompt}</span>
                          <span class="text-[var(--color-fg-muted)]">{d.expected}</span>
                          <span>→</span>
                          <span class={d.correct ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}>{d.actual || d.error}</span>
                          <span class="text-[var(--color-fg-muted)] w-14 text-right">{d.latency_ms.toFixed(0)}ms</span>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>

              <Show when={r.error}>
                <div class="text-[var(--color-danger)] text-xs mt-2">{r.error}</div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

export default TestsPage
