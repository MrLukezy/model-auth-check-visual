import { Component, createSignal, onMount, For, Show } from "solid-js"
import { api, Provider } from "../api"

const PROVIDER_PRESETS = [
  { value: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini" },
  { value: "anthropic", label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", defaultModel: "claude-3-sonnet-20240229" },
  { value: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com", defaultModel: "deepseek-chat" },
  { value: "siliconflow", label: "SiliconFlow", baseUrl: "https://api.siliconflow.cn/v1", defaultModel: "deepseek-ai/DeepSeek-V3" },
  { value: "moonshot", label: "Moonshot (Kimi)", baseUrl: "https://api.moonshot.cn/v1", defaultModel: "moonshot-v1-8k" },
  { value: "zhipu", label: "Zhipu (GLM)", baseUrl: "https://open.bigmodel.cn/api/paas/v4", defaultModel: "glm-4-flash" },
  { value: "qwen", label: "Qwen (Tongyi)", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", defaultModel: "qwen-turbo" },
  { value: "minimax", label: "MiniMax", baseUrl: "https://api.minimax.chat/v1", defaultModel: "abab6.5-chat" },
  { value: "ollama", label: "Ollama (local)", baseUrl: "http://localhost:11434", defaultModel: "llama3.2" },
  { value: "custom", label: "Custom (Generic OpenAI)", baseUrl: "", defaultModel: "" },
]

const ProvidersPage: Component = () => {
  const [providers, setProviders] = createSignal<Provider[]>([])
  const [error, setError] = createSignal<string | null>(null)
  const [selectedPreset, setSelectedPreset] = createSignal("openai")
  const [name, setName] = createSignal("")
  const [baseUrl, setBaseUrl] = createSignal("")
  const [apiKey, setApiKey] = createSignal("")
  const [showKey, setShowKey] = createSignal(false)
  const [loading, setLoading] = createSignal(false)

  const preset = () => PROVIDER_PRESETS.find(p => p.value === selectedPreset())!

  const handlePresetChange = (value: string) => {
    setSelectedPreset(value)
    const p = PROVIDER_PRESETS.find(x => x.value === value)!
    setName(p.label)
    setBaseUrl(p.baseUrl)
  }

  const load = async () => {
    try {
      setProviders(await api.listProviders())
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }
  onMount(() => {
    handlePresetChange("openai")
    load()
  })

  const handleAdd = async (e: Event) => {
    e.preventDefault()
    if (!name().trim() || !baseUrl().trim() || !apiKey().trim()) {
      setError("Please fill in all fields")
      return
    }
    setLoading(true)
    try {
      await api.createProvider({ name: name(), base_url: baseUrl(), api_key: apiKey() })
      setApiKey("")
      setShowKey(false)
      await load()
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string, pName: string) => {
    if (!confirm(`Delete "${pName}" and all its models?`)) return
    try {
      await api.deleteProvider(id)
      await load()
    } catch (e) {
      setError(String(e))
    }
  }

  const handleTest = async (providerId: string, pName: string) => {
    setLoading(true)
    setError(null)
    try {
      const models = await api.fetchProviderModels(providerId)
      alert(`Connected! Found ${models.length} model(s) from ${pName}`)
    } catch (e) {
      setError(`Test failed: ${e}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div class="max-w-3xl">
      <h1 class="text-2xl font-bold mb-6">Providers</h1>

      <form
        onSubmit={handleAdd}
        class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 mb-6 flex flex-col gap-3"
      >
        <div class="text-sm font-semibold text-[var(--color-accent-muted)] mb-1">Add Provider</div>

        <div class="flex gap-3">
          <select
            class="flex-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] transition cursor-pointer"
            value={selectedPreset()}
            onChange={e => handlePresetChange(e.currentTarget.value)}
          >
            <For each={PROVIDER_PRESETS}>
              {p => <option value={p.value}>{p.label}</option>}
            </For>
          </select>
          <input
            class="flex-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] transition"
            placeholder="Provider Name (auto-filled)"
            value={name()}
            onInput={e => setName(e.currentTarget.value)}
          />
        </div>

        <input
          class="bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] transition"
          placeholder={preset().value === "ollama" ? "http://localhost:11434" : "Base URL (auto-filled based on provider)"}
          value={baseUrl()}
          onInput={e => setBaseUrl(e.currentTarget.value)}
        />

        <div class="flex gap-3">
          <input
            class="flex-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] transition font-mono"
            type={showKey() ? "text" : "password"}
            placeholder={preset().value === "ollama" ? "Leave empty for local" : "sk-..."}
            value={apiKey()}
            onInput={e => setApiKey(e.currentTarget.value)}
          />
          <button
            type="button"
            class="px-3 py-2 text-xs text-[var(--color-accent-muted)] hover:text-[var(--color-accent)] transition"
            onClick={() => setShowKey(!showKey())}
          >
            {showKey() ? "Hide" : "Show"}
          </button>
        </div>

        <div class="flex justify-end mt-1">
          <button
            type="submit"
            disabled={loading()}
            class="bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white px-5 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50"
          >
            {loading() ? "Adding..." : "Add Provider"}
          </button>
        </div>
      </form>

      <Show when={error()}>
        <div class="text-[var(--color-danger)] text-sm mb-4 px-4 py-2 bg-red-900/20 border border-red-900/40 rounded-lg">
          {error()}
        </div>
      </Show>

      <div class="text-xs text-[var(--color-accent-muted)] px-4 py-2 mb-4 bg-amber-900/10 border-l-3 border-[var(--color-accent)] rounded-r-lg">
        Provider configurations are saved locally. Ollama needs to be running locally.
      </div>

      <div class="flex flex-col gap-3">
        <For each={providers()}>
          {p => (
            <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl px-5 py-4 flex items-center justify-between gap-4">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="font-semibold">{p.name}</span>
                  {PROVIDER_PRESETS.find(pp => pp.label === p.name) && (
                    <span class="text-xs px-2 py-0.5 rounded-full bg-[var(--color-accent-muted)]/20 text-[var(--color-accent)] border border-[var(--color-accent-muted)]/30">
                      Preset
                    </span>
                  )}
                </div>
                <div class="text-xs text-[var(--color-fg-muted)] mt-1 font-mono truncate">
                  {p.base_url}
                </div>
                <div class="text-xs text-[var(--color-fg-muted)] mt-0.5">
                  Added {new Date(p.created_at).toLocaleDateString()}
                </div>
              </div>
              <div class="flex flex-col gap-2 shrink-0">
                <button
                  class="bg-[var(--color-surface)] border border-[var(--color-accent)] text-[var(--color-accent)] text-xs font-medium px-3 py-1.5 rounded-lg transition hover:bg-[var(--color-accent)] hover:text-white"
                  onClick={() => handleTest(p.id, p.name)}
                  disabled={loading()}
                >
                  {loading() ? "Testing..." : "Test"}
                </button>
                <button
                  class="text-[var(--color-danger)] hover:text-[var(--color-danger-hover)] text-xs font-medium transition"
                  onClick={() => handleDelete(p.id, p.name)}
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </For>

        <Show when={!providers().length && !loading()}>
          <div class="text-center text-[var(--color-fg-muted)] py-12">
            No providers yet. Add one above.
          </div>
        </Show>
      </div>
    </div>
  )
}

export default ProvidersPage
