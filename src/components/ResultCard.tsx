import { Component, createSignal, For, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { TestRun, ModelResult } from "../api"
import { uiState, setUiState } from "../store"
import ConfirmModal from "./ConfirmModal"
import IconLegend from "./IconLegend"
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
      if (pb !== pa) return pb - pa
      // 准确率相同时，耗时越短排越前
      const ta = a.elapsed_ms && a.elapsed_ms > 0 ? a.elapsed_ms : Infinity
      const tb = b.elapsed_ms && b.elapsed_ms > 0 ? b.elapsed_ms : Infinity
      return ta - tb
    })
  } else {
    arr.sort((a, b) => (a.elapsed_ms || 0) - (b.elapsed_ms || 0))
  }
  return arr
}

export { CAT_LABELS }

interface ResultCardProps {
  run: TestRun
  highlight?: boolean
  onDelete?: (runId: string) => void
}

export const ResultCard: Component<ResultCardProps> = props => {
  const navigate = useNavigate()
  const isExpanded = () => uiState.expandedRuns[props.run.run_id] || false
  const sortBy = () => uiState.sortRuns[props.run.run_id] || "accuracy"
  const [confirmOpen, setConfirmOpen] = createSignal(false)

  const pct = () =>
    props.run.total_questions > 0
      ? Math.round((props.run.total_passed / props.run.total_questions) * 100)
      : 0

  const sorted = () => sortResults(props.run.results, sortBy())

  // Find the fastest model in this run (by total elapsed_ms)
  const fastestModelId = () => {
    const results = props.run.results
    if (!results || results.length === 0) return null
    let fastest = results[0]
    for (const r of results) {
      if ((r.elapsed_ms || 0) > 0 && (r.elapsed_ms || 0) < (fastest.elapsed_ms || Infinity)) {
        fastest = r
      }
    }
    return fastest?.model_id || null
  }

  // Find the model with best accuracy (highest pass/total ratio)
  const bestAccuracyModelId = () => {
    const results = props.run.results
    if (!results || results.length === 0) return null
    let best = results[0]
    let bestScore = best.total > 0 ? best.passed / best.total : 0
    let bestTime = best.elapsed_ms && best.elapsed_ms > 0 ? best.elapsed_ms : Infinity
    for (const r of results) {
      const score = r.total > 0 ? r.passed / r.total : 0
      const time = r.elapsed_ms && r.elapsed_ms > 0 ? r.elapsed_ms : Infinity
      if (
        score > bestScore ||
        (score === bestScore && time < bestTime)
      ) {
        best = r
        bestScore = score
        bestTime = time
      }
    }
    return best?.model_id || null
  }

  const toggleExpanded = () => {
    setUiState('expandedRuns', props.run.run_id, v => !v)
  }

  const setSort = (e: Event) => {
    setUiState('sortRuns', props.run.run_id, (e.target as HTMLSelectElement).value as any)
  }

  const openDetail = (e: Event) => {
    e.stopPropagation()
    navigate(`/detail/${props.run.run_id}`)
  }

  const handleDeleteClick = (e: Event) => {
    e.stopPropagation()
    setConfirmOpen(true)
  }

  const handleDeleteConfirm = () => {
    setConfirmOpen(false)
    props.onDelete?.(props.run.run_id)
  }

  const handleDeleteCancel = () => {
    setConfirmOpen(false)
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

        <div class="flex items-center gap-3 shrink-0">
          <Show when={props.run.cancelled}>
            <span class="text-red-400 text-xs" title="Run was manually stopped">🛑 Cancelled</span>
          </Show>
          <Show when={props.run.completed !== true && !props.run.cancelled}>
            <span class="text-yellow-400 text-xs" title="Run did not finish all questions">🚧 Incomplete</span>
          </Show>
          <Show when={props.onDelete}>
            <button
              class="text-[var(--color-fg-muted)] hover:text-[var(--color-danger)] transition p-1 rounded"
              onClick={handleDeleteClick}
              title="Delete this test run"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
              </svg>
            </button>
          </Show>
          <span class="text-[var(--color-fg-muted)]">{isExpanded() ? "▼" : "▶"}</span>
        </div>
      </div>

      <Show when={isExpanded()}>
        <div class="border-t border-[var(--color-border)] p-5">
          <IconLegend />
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
              {r => <ModelRow
                result={r}
                isFastest={r.model_id === fastestModelId()}
                isBestAccuracy={r.model_id === bestAccuracyModelId()}
              />}
            </For>
          </div>
        </div>
      </Show>

      <ConfirmModal
        open={confirmOpen()}
        title="Delete Test Run"
        message={`Are you sure you want to delete test run #${props.run.run_id}? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        danger
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
    </div>
  )
}

interface ModelRowProps {
  result: ModelResult
  isFastest?: boolean
  isBestAccuracy?: boolean
}

const ModelRow: Component<ModelRowProps> = props => {
  const [expanded, setExpanded] = createSignal(false)

  const totalRetries = () =>
    props.result.details.reduce((sum, d) => sum + (d.retries || 0), 0)

  const totalTimeouts = () =>
    props.result.details.filter(d => d.timed_out).length

  // Questions that had API/network/other errors (excluding timeouts, which are counted separately)
  const totalErrors = () =>
    props.result.details.filter(d => d.error && !d.timed_out && !d.cancelled).length

  const totalCancelled = () =>
    props.result.details.filter(d => d.cancelled).length

  const isIncomplete = () =>
    props.result.completed !== undefined && props.result.completed < props.result.total

  return (
    <div class={`rounded-lg p-3 text-sm relative ${props.isBestAccuracy ? "best-row-shimmer" : ""}`}
         style="background: var(--color-card);">
      <div
        class="flex items-center justify-between cursor-pointer relative z-10"
        onClick={() => setExpanded(!expanded())}
      >
        <div class="flex items-center gap-2">
          <Show when={props.isFastest}>
            <span class="text-[var(--color-accent)] text-sm" title="Fastest model">⚡</span>
          </Show>
          <Show when={props.isBestAccuracy}>
            <span class="score-diamond text-sm font-semibold" title="Best accuracy">🏆</span>
          </Show>
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
            <span class="text-orange-400" title={`Retried ${totalRetries()} time(s) total`}>
              🔄{totalRetries()}
            </span>
          </Show>
          <Show when={totalTimeouts() > 0}>
            <span class="text-[var(--color-danger)]" title={`${totalTimeouts()} question(s) timed out (60s)`}>
              ⏱{totalTimeouts()}
            </span>
          </Show>
          <Show when={totalErrors() > 0}>
            <span class="text-rose-400" title={`${totalErrors()} question(s) had API/network errors`}>
              ✗!{totalErrors()}
            </span>
          </Show>
          <Show when={totalCancelled() > 0}>
            <span class="text-red-400" title={`${totalCancelled()} question(s) cancelled by user`}>
              🛑{totalCancelled()}
            </span>
          </Show>
          <Show when={isIncomplete()}>
            <span class="text-yellow-400" title={`Only ${props.result.completed}/${props.result.total} questions finished`}>
              🚧
            </span>
          </Show>
          <span class={scoreColor(props.result.passed, props.result.total)}>
            {props.result.passed}/{props.result.total}
          </span>
          <span class="text-[var(--color-fg-muted)]">{expanded() ? "▲" : "▼"}</span>
        </div>
      </div>

      <Show when={expanded()}>
        <div class="mt-3 border-t border-[var(--color-border)] pt-3 relative z-10">
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
                  {d.timed_out ? (
                    <span class="text-[var(--color-danger)] w-8 text-center" title={`Timed out after ${d.retries || 0} retries`}>
                      ⏱
                    </span>
                  ) : d.cancelled ? (
                    <span class="text-red-400 w-8 text-center" title="Cancelled by user">
                      🛑
                    </span>
                  ) : d.error ? (
                    <span class="text-rose-400 w-8 text-center" title={`Error: ${d.error}`}>
                      ✗!
                    </span>
                  ) : d.retries && d.retries > 0 ? (
                    <span class="text-orange-400 w-8 text-center" title={`Retried ${d.retries} time(s)`}>
                      🔄{d.retries}
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
        <div class="text-[var(--color-danger)] text-xs mt-2 relative z-10">{props.result.error}</div>
      </Show>
    </div>
  )
}

export default ResultCard
