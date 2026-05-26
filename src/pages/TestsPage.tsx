import { Component, createSignal, onMount, For, Show } from "solid-js"
import { api, Model, TestRun, BankStats } from "../api"

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

const TestsPage: Component = () => {
  const [queue, setQueue] = createSignal<Model[]>([])
  const [running, setRunning] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [results, setResults] = createSignal<TestRun[]>([])
  const [numTests, setNumTests] = createSignal(100)
  const [profile, setProfile] = createSignal("programmer")
  const [activeRun, setActiveRun] = createSignal<TestRun | null>(null)
  const [bankStats, setBankStats] = createSignal<BankStats | null>(null)

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
    try {
      const run = await api.runTest(q.map(m => m.id), numTests(), profile())
      setActiveRun(run)
      setResults([run, ...results()])
      await load()
    } catch (e) {
      setError(String(e))
    } finally {
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
                ? "Running..."
                : `${numTests()} random questions × ${queue().length} model(s) — same questions for all models`}
            </div>
            <button
              class="bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white font-medium text-sm px-6 py-2 rounded-lg transition disabled:opacity-50"
              disabled={running() || !bankStats()?.loaded}
              onClick={handleRun}
            >
              {running() ? "Running tests..." : `Run Test`}
            </button>
          </div>
        </div>
      </Show>

      <Show when={error()}>
        <div class="text-[var(--color-danger)] text-sm mb-4">{error()}</div>
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
          <span class={pct() >= 50 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}>
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
                  <span class="text-[var(--color-fg-muted)]">
                    {r.avg_latency_ms.toFixed(0)}ms avg
                  </span>
                  <span class={r.passed === r.total ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}>
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
                            class={`text-xs px-2 py-0.5 rounded ${
                              stats.total > 0 && stats.passed / stats.total >= 0.5
                                ? "bg-green-900/30 text-green-400"
                                : "bg-red-900/30 text-red-400"
                            }`}
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
