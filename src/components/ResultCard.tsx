import { Component, createSignal, For, Show } from "solid-js"
import { TestRun, ModelResult } from "../api"
import { uiState, setUiState } from "../store"
import "./score-colors.css"

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

export function scoreColor(passed: number, total: number): string {
  if (total === 0) return "text-[var(--color-fg-muted)]"
  const pct = (passed / total) * 100
  if (pct >= 95) return "score-diamond"
  if (pct >= 80) return "score-green"
  if (pct >= 60) return "score-yellow"
  return "score-red"
}

export function scoreBgColor(passed: number, total: number): string {
  if (total === 0) return "bg-[var(--color-fg-muted)]"
  const pct = (passed / total) * 100
  if (pct >= 95) return "score-bg-diamond progress-diamond"
  if (pct >= 80) return "score-bg-green"
  if (pct >= 60) return "score-bg-yellow"
  return "score-bg-red"
}

export function formatElapsed(ms: number): string {
  if (!ms || ms < 0) return "-"
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

export function sortResults(
  results: ModelResult[] | undefined,
  sortBy: "accuracy" | "elapsed",
): ModelResult[] {
  if (!results) return []
  const arr = [...results]
  if (sortBy === "accuracy") {
    arr.sort((a, b) => {
      const pa = a.total > 0 ? a.passed / a.total : 0
      const pb = b.total > 0 ? b.passed / b.total : 0
      return pb - pa
    })
  } else {
    arr.sort((a, b) => (a.elapsed_ms || 0) - (b.elapsed_ms || 0))
  }
  return arr
}

export { CAT_LABELS }

export const ResultCard: Component<{ run: TestRun; highlight?: boolean }> = props => {
  const isExpanded = () => uiState.expandedRuns[props.run.run_id] || false
  const sortBy = () => uiState.sortRuns[props.run.run_id] || "accuracy"

  const pct = () =>
    props.run.total_questions > 0
      ? Math.round((props.run.total_passed / props.run.total_questions) * 100)
      : 0

  const sorted = () => sortResults(props.run.results, sortBy())

  const toggleExpanded = (e: Event) => {
    setUiState('expandedRuns', props.run.run_id, v => !v)
  }

  const setSort = (e: Event) => {
    setUiState('sortRuns', props.run.run_id, (e.target as HTMLSelectElement).value as any)
  }

  const openDetail = (e: Event) => {
    e.stopPropagation()
    const baseUrl = window.location.origin + window.location.pathname
    window.open(`${baseUrl}#/detail/${props.run.run_id}`, "_blank")
  }

  return (
    <div
      class={`border rounded-xl mb-4 overflow-hidden ${
        props.highlight
          ? "border-[var(--color-accent)]/40 bg-[var(--color-surface)]"
          : "border-[var(--color-border)] bg-[var(--color-surface)]"
      }`}
    >
      <div
        class="flex items-center justify-between p-5 cursor-pointer hover:bg-[var(--color-card)]/30 transition"
        onClick={toggleExpanded}
      >
        <div class="flex items-center gap-2 flex-wrap min-w-0 flex-1">
          <span class="w-2 h-2 rounded-full bg-[var(--color-accent)] shrink-0" />
          <span class="font-mono text-[var(--color-accent)]">#{props.run.run_id}</span>
          <span class="text-[var(--color-fg-muted)] text-xs">
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

        <div class="flex items-center gap-4 shrink-0">
          <span class={scoreColor(props.run.total_passed, props.run.total_questions)}>
            {props.run.total_passed}/{props.run.total_questions} ({pct()}%)
          </span>
          <span class="text-[var(--color-fg-muted)]">{isExpanded() ? "▼" : "▶"}</span>
        </div>
      </div>

      <Show when={isExpanded()}>
        <div class="border-t border-[var(--color-border)] p-5">
          <div class="flex items-center justify-between mb-4">
            <label class="flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
              Sort by:
              <select
                class="bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1 text-xs outline-none focus:border-[var(--color-accent)]"
                value={sortBy()}
                onChange={setSort}
                onClick={(e) => e.stopPropagation()}
              >
                <option value="accuracy">Accuracy</option>
                <option value="elapsed">Elapsed Time</option>
              </select>
            </label>
            <button
              class="bg-[var(--color-card)] border border-[var(--color-accent)]/50 text-[var(--color-accent)] text-xs font-medium px-4 py-1.5 rounded-lg hover:bg-[var(--color-accent)] hover:text-white transition"
              onClick={openDetail}
            >
              Detailed Comparison →
            </button>
          </div>

          <div class="flex flex-col gap-2">
            <For each={sorted()}>
              {r => <ModelRow result={r} />}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}

const ModelRow: Component<{ result: ModelResult }> = props => {
  const [expanded, setExpanded] = createSignal(false)

  const totalRetries = () =>
    props.result.details.reduce((sum, d) => sum + (d.retries || 0), 0)

  return (
    <div class="bg-[var(--color-card)] rounded-lg p-3 text-sm">
      <div
        class="flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded())}
      >
        <div>
          <span class="font-medium">{props.result.model_id}</span>
          <span class="text-[var(--color-fg-muted)] text-xs ml-2">{props.result.provider_name}</span>
        </div>
        <div class="flex items-center gap-4 text-xs">
          <Show when={props.result.elapsed_ms}>
            <span class="text-[var(--color-fg-muted)]">
              {formatElapsed(props.result.elapsed_ms!)}
            </span>
          </Show>
          <span class="text-[var(--color-fg-muted)]">
            {props.result.avg_latency_ms.toFixed(0)}ms avg
          </span>
          <Show when={totalRetries() > 0}>
            <span class="text-[var(--color-accent)]" title={`Total retries: ${totalRetries()}`}>
              ⚡{totalRetries()}
            </span>
          </Show>
          <span class={scoreColor(props.result.passed, props.result.total)}>
            {props.result.passed}/{props.result.total}
          </span>
          <span class="text-[var(--color-fg-muted)]">{expanded() ? "▲" : "▼"}</span>
        </div>
      </div>

      <Show when={expanded()}>
        <div class="mt-3 border-t border-[var(--color-border)] pt-3">
          <Show when={props.result.categories && Object.keys(props.result.categories).length > 0}>
            <div class="flex flex-wrap gap-1 mb-3">
              <For each={Object.entries(props.result.categories || {})}>
                {([cat, stats]) => (
                  <span class={`text-xs px-2 py-0.5 rounded ${scoreColor(stats.passed, stats.total)}`}>
                    {CAT_LABELS[cat] || cat}: {stats.passed}/{stats.total}
                  </span>
                )}
              </For>
            </div>
          </Show>

          <div class="flex flex-col gap-1">
            <For each={props.result.details}>
              {d => (
                <div class="flex items-start gap-2 text-xs">
                  <span class={d.correct ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}>
                    {d.correct ? "✓" : "✗"}
                  </span>
                  <span class="flex-1 text-[var(--color-fg-muted)] truncate" title={d.prompt}>
                    {d.prompt}
                  </span>
                  <span class="text-[var(--color-fg-muted)]">{d.expected}</span>
                  <span class="text-[var(--color-fg-muted)]">→</span>
                  <span
                    class={d.correct ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}
                  >
                    {d.actual || d.error}
                  </span>
                  <span class="text-[var(--color-fg-muted)] w-14 text-right">
                    {d.latency_ms.toFixed(0)}ms
                  </span>
                  {d.retries && d.retries > 0 ? (
                    <span class="text-[var(--color-accent)] w-8 text-right" title={`Retried ${d.retries} time(s)`}>
                      ⚡{d.retries}
                    </span>
                  ) : (
                    <span class="w-8" />
                  )}
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      <Show when={props.result.error}>
        <div class="text-[var(--color-danger)] text-xs mt-2">{props.result.error}</div>
      </Show>
    </div>
  )
}
