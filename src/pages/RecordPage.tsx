import { Component, createSignal, onMount, onCleanup, For, Show } from "solid-js"
import { api, TestRun } from "../api"
import { ResultCard } from "../components/ResultCard"
import { usePolling } from "../hooks/usePolling"

const RecordPage: Component = () => {
  const [runs, setRuns] = createSignal<TestRun[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)

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

  const handleDelete = async (runId: string) => {
    if (!confirm(`Delete test run ${runId}? This cannot be undone.`)) return
    try {
      await api.deleteResult(runId)
      setRuns(prev => prev.filter(r => r.run_id !== runId))
    } catch (e) {
      setError(String(e))
    }
  }

  onMount(() => load())
  usePolling(() => load(true), 8000)

  return (
    <div>
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-bold">
          Run History <span class="text-sm font-normal text-[var(--color-fg-muted)] ml-2">({runs().length})</span>
        </h1>
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
        <For each={runs()}>
          {run => <ResultCard run={run} onDelete={handleDelete} />}
        </For>
      </Show>
    </div>
  )
}

export default RecordPage
