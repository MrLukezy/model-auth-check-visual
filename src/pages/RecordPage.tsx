import { Component, createSignal, onMount, For, Show } from "solid-js"
import { api, TestRun } from "../api"
import { ResultCard } from "../components/ResultCard"
import IconLegend from "../components/IconLegend"
import ConfirmModal from "../components/ConfirmModal"
import { usePolling } from "../hooks/usePolling"

const RecordPage: Component = () => {
  const [runs, setRuns] = createSignal<TestRun[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [deleteTarget, setDeleteTarget] = createSignal<string | null>(null)

  const load = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const r = await api.getResults()
      const newFingerprint = getFingerprint(r)
      const currentFingerprint = getFingerprint(runs())
      if (newFingerprint !== currentFingerprint) {
        setRuns(r)
      }
      if (silent) setError(null)
    } catch (e) {
      if (!silent) setError(String(e))
    } finally {
      if (!silent) setLoading(false)
    }
  }

  const getFingerprint = (runs: TestRun[]): string => {
    return runs.map(r => `${r.run_id}:${r.timestamp}:${r.total_passed}`).join('|')
  }

  const handleDeleteClick = (runId: string) => {
    setDeleteTarget(runId)
  }

  const confirmDelete = async () => {
    const runId = deleteTarget()
    if (!runId) return
    setDeleteTarget(null)
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
          运行历史 <span class="text-sm font-normal text-[var(--color-fg-muted)] ml-2">({runs().length})</span>
        </h1>
      </div>

      <IconLegend />

      <Show when={error()}>
        <div class="text-[var(--color-danger)] text-sm mb-4">{error()}</div>
      </Show>

      <Show when={loading()}>
        <div class="text-center text-[var(--color-fg-muted)] py-12">加载中...</div>
      </Show>

      <Show when={!loading() && !runs().length}>
        <div class="text-center text-[var(--color-fg-muted)] py-12">
          暂无测试记录。请前往评测页面运行您的第一次评测。
        </div>
      </Show>

      <Show when={!loading() && runs().length > 0}>
        <For each={runs()}>
          {run => <ResultCard run={run} onDelete={handleDeleteClick} />}
        </For>
      </Show>

      <Show when={deleteTarget()}>
        <ConfirmModal
          open={true}
          title="删除测试运行"
          message={`确定要删除测试运行 #${deleteTarget()} 吗？此操作无法撤销。`}
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

export default RecordPage
