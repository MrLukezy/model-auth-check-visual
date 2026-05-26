import { Component, createSignal, onMount, For, Show } from "solid-js"
import { api, Provider, Model } from "../api"
import Dropdown from "../components/Dropdown"

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

  const load = async () => {
    try {
      const [p, m, q] = await Promise.all([
        api.listProviders(),
        api.listModels(),
        api.getQueue(),
      ])
      setProviders(p)
      setAllModels(m)
      setQueue(q)
    } catch (e) {
      setError(String(e))
    }
  }
  onMount(load)

  const handleFetch = async (providerId: string, providerName: string) => {
    setFetching(true)
    setError(null)
    setSuccess(null)
    try {
      const models = await api.fetchProviderModels(providerId)
      await load()
      setSuccess(`Found ${models.length} model(s) from ${providerName}`)
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

  const toggleAll = () => {
    const filtered = filteredModels()
    const allSelected = filtered.every(m => selectedIds().has(m.id))
    const next = new Set<string>(selectedIds())
    filtered.forEach(m => (allSelected ? next.delete(m.id) : next.add(m.id)))
    setSelectedIds(next)
  }

  const handleAddToQueue = async () => {
    const ids = Array.from(selectedIds()) as string[]
    if (!ids.length) return
    try {
      const res = await api.addToQueue(ids)
      setSuccess(`Added ${res.added.length} model(s) to test queue`)
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

  const filteredModels = () => {
    let models = allModels()
    if (filterProvider()) models = models.filter(m => m.provider_id === filterProvider())
    if (search()) {
      const q = search().toLowerCase()
      models = models.filter(m => m.model_id.toLowerCase().includes(q))
    }
    return models
  }

  const inQueue = (id: string) => queue().some(q => q.id === id)

  return (
    <div>
      <h1 class="text-2xl font-bold mb-6">Models</h1>

      {/* Fetch section */}
      <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 mb-6">
        <div class="text-sm font-semibold text-[var(--color-fg-muted)] mb-3">
          Fetch Models from Provider
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
              No providers configured. Add one in the Providers page.
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
              Test Queue{" "}
              <span class="text-[var(--color-accent)]">({queue().length})</span>
            </div>
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
            Go to Tests page to run evaluations on these models.
          </div>
        </div>
      </Show>

      {/* Filters and table */}
      <Show when={allModels().length > 0}>
        <div class="flex items-center gap-3 mb-4">
          <input
            class="flex-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] transition"
            placeholder="Search models..."
            value={search()}
            onInput={e => setSearch(e.currentTarget.value)}
          />

          <Dropdown
            trigger={
              filterProvider()
                ? providers().find(p => p.id === filterProvider())?.name ?? "All Providers"
                : "All Providers"
            }
          >
            <button
              class="block w-full text-left px-4 py-2 text-sm hover:bg-[var(--color-surface)] transition"
              onClick={() => setFilterProvider("")}
            >
              All Providers
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
              Add Selected ({selectedIds().size}) to Queue
            </button>
          </Show>
        </div>

        <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl overflow-hidden">
          <table class="w-full">
            <thead>
              <tr class="border-b border-[var(--color-border)] text-xs text-[var(--color-fg-muted)]">
                <th class="text-left px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={filteredModels().length > 0 && filteredModels().every(m => selectedIds().has(m.id))}
                    onChange={toggleAll}
                    class="accent-[var(--color-accent)]"
                  />
                </th>
                <th class="text-left px-4 py-3">Model ID</th>
                <th class="text-left px-4 py-3">Provider</th>
                <th class="text-left px-4 py-3">Owned By</th>
                <th class="text-left px-4 py-3 w-16">Status</th>
              </tr>
            </thead>
            <tbody>
              <For each={filteredModels()}>
                {m => (
                  <tr
                    class={`border-b border-[var(--color-border)] last:border-0 text-sm cursor-pointer transition ${
                      selectedIds().has(m.id) ? "bg-[var(--color-accent)]/5" : "hover:bg-[var(--color-card)]"
                    }`}
                    onClick={() => !inQueue(m.id) && toggleSelect(m.id)}
                  >
                    <td class="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds().has(m.id)}
                        onChange={() => !inQueue(m.id) && toggleSelect(m.id)}
                        disabled={inQueue(m.id)}
                        class="accent-[var(--color-accent)]"
                      />
                    </td>
                    <td class="px-4 py-3 font-mono text-xs">{m.model_id}</td>
                    <td class="px-4 py-3 text-[var(--color-fg-muted)]">{m.provider_name}</td>
                    <td class="px-4 py-3 text-[var(--color-fg-muted)] text-xs">{m.owned_by || "-"}</td>
                    <td class="px-4 py-3">
                      <Show when={inQueue(m.id)}>
                        <span class="text-[var(--color-success)] text-xs">Queued</span>
                      </Show>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>

      <Show when={!allModels().length}>
        <div class="text-center text-[var(--color-fg-muted)] py-12">
          No models fetched yet. Choose a provider above to fetch its models.
        </div>
      </Show>
    </div>
  )
}

export default ModelsPage
