import { Component, createSignal, onMount, onCleanup, For, Show } from "solid-js"
import { api, Provider, Model } from "../api"
import Dropdown from "../components/Dropdown"
import { usePolling } from "../hooks/usePolling"

interface ModelGroup {
  provider_id: string
  provider_name: string
  models: Model[]
}

const ModelsPage: Component = () => {
  const [providers, setProviders] = createSignal<Provider[]>([])
  const [allModels, setAllModels] = createSignal<Model[]>([])
  const [queue, setQueue] = createSignal<Model[]>([])
  const [fetching, setFetching] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [success, setSuccess] = createSignal<string | null>(null)
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set())
  const [filterProvider, setFilterProvider] = createSignal("")
  const [search, setSearch] = createSignal("")
  const [collapsedGroups, setCollapsedGroups] = createSignal<Set<string>>(new Set())

  const load = async (silent = false) => {
    try {
      const [p, m, q] = await Promise.all([
        api.listProviders(),
        api.listModels(),
        api.getQueue(),
      ])
      setProviders(p)
      setAllModels(m)
      setQueue(q)
      if (silent) setError(null)
    } catch (e) {
      if (!silent) setError(String(e))
    }
  }
  onMount(() => load())
  usePolling(() => load(true), 5000)

  const handleFetch = async (providerId: string, providerName: string) => {
    setFetching(true)
    setError(null)
    setSuccess(null)
    try {
      const models = await api.fetchProviderModels(providerId)
      await load()
      setSuccess(`从 ${providerName} 找到 ${models.length} 个模型`)
      setTimeout(() => setSuccess(null), 4000)
    } catch (e) {
      setError(String(e))
    } finally {
      setFetching(false)
    }
  }

  const toggleSelect = (id: string) => {
    const next = new Set<string>(selectedIds())
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  const handleAddToQueue = async () => {
    const ids = Array.from(selectedIds()) as string[]
    if (!ids.length) return
    try {
      const res = await api.addToQueue(ids)
      setSuccess(`已将 ${res.added.length} 个模型添加到测试队列`)
      setSelectedIds(new Set<string>())
      await load()
      setTimeout(() => setSuccess(null), 4000)
    } catch (e) {
      setError(String(e))
    }
  }

  const handleRemoveFromQueue = async (id: string) => {
    try {
      await api.removeFromQueue(id)
      await load()
    } catch (e) {
      setError(String(e))
    }
  }

  const handleClearQueue = async () => {
    try {
      await Promise.all(queue().map(m => api.removeFromQueue(m.id)))
      await load()
    } catch (e) {
      setError(String(e))
    }
  }

  const filteredModels = () => {
    let models = allModels()
    if (filterProvider()) models = models.filter(m => m.provider_id === filterProvider())
    if (search()) {
      const q = search().toLowerCase()
      models = models.filter(m => m.model_id.toLowerCase().includes(q))
    }
    return models
  }

  const groupedModels = () => {
    const models = filteredModels()
    const map = new Map<string, ModelGroup>()
    for (const m of models) {
      let g = map.get(m.provider_id)
      if (!g) {
        g = { provider_id: m.provider_id, provider_name: m.provider_name, models: [] }
        map.set(m.provider_id, g)
      }
      g.models.push(m)
    }
    return Array.from(map.values())
  }

  const toggleGroup = (providerId: string) => {
    const next = new Set(collapsedGroups())
    if (next.has(providerId)) next.delete(providerId)
    else next.add(providerId)
    setCollapsedGroups(next)
  }

  const toggleGroupSelect = (group: ModelGroup) => {
    const allSelected = group.models.every(m => selectedIds().has(m.id))
    const next = new Set(selectedIds())
    group.models.forEach(m => {
      if (inQueue(m.id)) return
      allSelected ? next.delete(m.id) : next.add(m.id)
    })
    setSelectedIds(next)
  }

  const inQueue = (id: string) => queue().some(q => q.id === id)

  return (
    <div>
      <h1 class="text-2xl font-bold mb-6">模型</h1>

      {/* Fetch section */}
      <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 mb-6">
        <div class="text-sm font-semibold text-[var(--color-fg-muted)] mb-3">
          从供应商获取模型
        </div>
        <div class="flex flex-wrap gap-2">
          <For each={providers()}>
            {p => (
              <button
                class={`border rounded-lg px-4 py-2 text-sm font-medium transition ${
                  fetching()
                    ? "border-[var(--color-border)] text-[var(--color-fg-muted)] opacity-60 cursor-wait"
                    : "border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white"
                }`}
                disabled={fetching()}
                onClick={() => handleFetch(p.id, p.name)}
              >
                {p.name}
              </button>
            )}
          </For>
          <Show when={!providers().length}>
            <span class="text-sm text-[var(--color-fg-muted)]">
              暂未配置供应商。请在供应商页面添加一个。
            </span>
          </Show>
        </div>
      </div>

      <Show when={error()}>
        <div class="text-[var(--color-danger)] text-sm mb-4">{error()}</div>
      </Show>
      <Show when={success()}>
        <div class="text-[var(--color-success)] text-sm mb-4">{success()}</div>
      </Show>

      {/* Test Queue */}
      <Show when={queue().length > 0}>
        <div class="bg-[var(--color-surface)] border border-[var(--color-accent)]/30 rounded-xl p-5 mb-6">
          <div class="flex items-center justify-between mb-3">
            <div class="text-sm font-semibold">
              测试队列{" "}
              <span class="text-[var(--color-accent)]">({queue().length})</span>
            </div>
            <button
              class="text-xs text-[var(--color-danger)] hover:text-[var(--color-danger)]/80 border border-[var(--color-danger)]/30 hover:border-[var(--color-danger)]/50 px-3 py-1 rounded-lg transition"
              onClick={handleClearQueue}
            >
              清空全部
            </button>
          </div>
          <div class="flex flex-wrap gap-2">
            <For each={queue()}>
              {m => (
                <span class="inline-flex items-center gap-2 bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30 text-[var(--color-accent)] text-xs font-medium px-3 py-1.5 rounded-full">
                  {m.provider_name}: {m.model_id}
                  <button
                    class="hover:text-white transition"
                    onClick={() => handleRemoveFromQueue(m.id)}
                  >
                    ✕
                  </button>
                </span>
              )}
            </For>
          </div>
          <div class="text-xs text-[var(--color-fg-muted)] mt-3">
            前往评测页面可对模型进行评测。
          </div>
        </div>
      </Show>

      {/* Filters and table */}
      <Show when={allModels().length > 0}>
        <div class="flex items-center gap-3 mb-4">
          <input
            class="flex-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] transition"
            placeholder="搜索模型..."
            value={search()}
            onInput={e => setSearch(e.currentTarget.value)}
          />

          <Dropdown
            trigger={
              filterProvider()
                ? providers().find(p => p.id === filterProvider())?.name ?? "所有供应商"
                : "所有供应商"
            }
          >
            <button
              class="block w-full text-left px-4 py-2 text-sm hover:bg-[var(--color-surface)] transition"
              onClick={() => setFilterProvider("")}
            >
              所有供应商
            </button>
            <For each={providers()}>
              {p => (
                <button
                  class="block w-full text-left px-4 py-2 text-sm hover:bg-[var(--color-surface)] transition"
                  onClick={() => setFilterProvider(p.id)}
                >
                  {p.name}
                </button>
              )}
            </For>
          </Dropdown>

          <Show when={selectedIds().size > 0}>
            <button
              class="bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-sm font-medium px-4 py-2 rounded-lg transition"
              onClick={handleAddToQueue}
            >
              将已选 ({selectedIds().size}) 添加到队列
            </button>
          </Show>
        </div>

        <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl overflow-hidden">
          <table class="w-full">
            <thead>
              <tr class="border-b border-[var(--color-border)] text-xs text-[var(--color-fg-muted)]">
                <th class="text-left px-4 py-3 w-10"></th>
                <th class="text-left px-4 py-3">模型ID</th>
                <th class="text-left px-4 py-3">所有者</th>
                <th class="text-left px-4 py-3 w-16">状态</th>
              </tr>
            </thead>
            <tbody>
              <For each={groupedModels()}>
                {group => {
                  const isCollapsed = () => collapsedGroups().has(group.provider_id)
                  const groupAllSelected = () => {
                    const selectable = group.models.filter(m => !inQueue(m.id))
                    return selectable.length > 0 && selectable.every(m => selectedIds().has(m.id))
                  }
                  const queuedCount = () => group.models.filter(m => inQueue(m.id)).length
                  return (
                    <>
                      <tr
                        class="bg-[var(--color-card)] border-b border-[var(--color-border)] cursor-pointer select-none hover:brightness-110 transition"
                        onClick={() => toggleGroup(group.provider_id)}
                      >
                        <td class="px-4 py-2.5">
                          <span class={`inline-block text-xs transition-transform ${isCollapsed() ? "" : "rotate-90"}`}>
                            &#9654;
                          </span>
                        </td>
                        <td class="px-4 py-2.5" colSpan={2}>
                          <div class="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={groupAllSelected()}
                              onChange={e => { e.stopPropagation(); toggleGroupSelect(group) }}
                              onClick={e => e.stopPropagation()}
                              class="accent-[var(--color-accent)]"
                            />
                            <span class="font-semibold text-sm">{group.provider_name}</span>
                            <span class="text-xs text-[var(--color-fg-muted)]">
                              ({group.models.length})
                            </span>
                            <Show when={queuedCount() > 0}>
                              <span class="text-xs text-[var(--color-success)]">
                                {queuedCount()} 个已入队
                              </span>
                            </Show>
                          </div>
                        </td>
                        <td class="px-4 py-2.5"></td>
                      </tr>
                      <Show when={!isCollapsed()}>
                        <For each={group.models}>
                          {m => (
                            <tr
                              class={`border-b border-[var(--color-border)] last:border-0 text-sm cursor-pointer transition ${
                                selectedIds().has(m.id) ? "bg-[var(--color-accent)]/5" : "hover:bg-[var(--color-card)]"
                              }`}
                              onClick={() => !inQueue(m.id) && toggleSelect(m.id)}
                            >
                              <td class="px-4 py-3 pl-10">
                                <input
                                  type="checkbox"
                                  checked={selectedIds().has(m.id)}
                                  onChange={() => !inQueue(m.id) && toggleSelect(m.id)}
                                  disabled={inQueue(m.id)}
                                  class="accent-[var(--color-accent)]"
                                />
                              </td>
                              <td class="px-4 py-3 font-mono text-xs">{m.model_id}</td>
                              <td class="px-4 py-3 text-[var(--color-fg-muted)] text-xs">{m.owned_by || "-"}</td>
                              <td class="px-4 py-3">
                                <Show when={inQueue(m.id)}>
                                  <span class="text-[var(--color-success)] text-xs">已入队</span>
                                </Show>
                              </td>
                            </tr>
                          )}
                        </For>
                      </Show>
                    </>
                  )
                }}
              </For>
            </tbody>
          </table>
        </div>
      </Show>

      <Show when={!allModels().length}>
        <div class="text-center text-[var(--color-fg-muted)] py-12">
          暂未获取模型。请选择上方的供应商以获取模型。
        </div>
      </Show>
    </div>
  )
}

export default ModelsPage
