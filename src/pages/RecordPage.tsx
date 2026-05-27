import { Component, createSignal, onMount, onCleanup, For, Show } from "solid-js"
import { api, TestRun } from "../api"
import { ResultCard, formatElapsed, scoreColor } from "../components/ResultCard"

type ListSort = "time" | "accuracy" | "elapsed"

const RecordPage: Component = () => {
  const [runs, setRuns] = createSignal<TestRun[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [sort, setSort] = createSignal<ListSort>("time")

  const load = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const r = await api.getResults()
      const newFingerprint = getFingerprint(r)
      const currentFingerprint = getFingerprint(runs())
      if (newFingerprint !== currentFingerprint) {
        setRuns(r)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      if (!silent) setLoading(false)
    }
  }

  const getFingerprint = (runs: TestRun[]): string => {
    return runs.map(r => `${r.run_id}:${r.timestamp}:${r.total_passed}`).join('|')
  }

  onMount(() => load())
  onMount(() => {
    const pollId = setInterval(() => load(true), 5000)
    onCleanup(() => clearInterval(pollId))
  })

  const sortedRuns = () => {
    const arr = [...runs()]
    if (sort() === "accuracy") {
      arr.sort((a, b) => {
        const pa = a.total_questions > 0 ? a.total_passed / a.total_questions : 0
        const pb = b.total_questions > 0 ? b.total_passed / b.total_questions : 0
        return pb - pa
      })
    } else if (sort() === "elapsed") {
      arr.sort((a, b) => {
        const ea = a.results.reduce((s, r) => s + (r.elapsed_ms || 0), 0)
        const eb = b.results.reduce((s, r) => s + (r.elapsed_ms || 0), 0)
        return ea - eb
      })
    } else {
      arr.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    }
    return arr
  }

  return (
    <div>
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-bold">
          Run History <span class="text-sm font-normal text-[var(--color-fg-muted)] ml-2">({runs().length})</span>
        </h1>
        <label class="flex items-center gap-2 text-sm text-[var(--color-fg-muted)]">
          Sort by:
          <select
            class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-3 py-1.5 text-sm outline-none focus:border-[var(--color-accent)] transition"
            value={sort()}
            onChange={e => setSort(e.currentTarget.value as ListSort)}
          >
            <option value="time">Run Time</option>
            <option value="accuracy">Accuracy (desc)</option>
            <option value="elapsed">Total Elapsed (asc)</option>
          </select>
        </label>
      </div>

      <Show when={error()}>
        <div class="text-[var(--color-danger)] text-sm mb-4">{error()}</div>
      </Show>

      <Show when={loading()}>
        <div class="text-center text-[var(--color-fg-muted)] py-12">Loading...</div>
      </Show>

      <Show when={!loading() && !runs().length}>
        <div class="text-center text-[var(--color-fg-muted)] py-12">
          No test runs yet. Go to the Tests page to run your first evaluation.
        </div>
      </Show>

      <Show when={!loading() && runs().length > 0}>
        <For each={sortedRuns()}>
          {run => <ResultCard run={run} />}
        </For>
      </Show>
    </div>
  )
}

export default RecordPage
