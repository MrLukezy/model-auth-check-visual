import { Component, createSignal, Show, For } from "solid-js"
import ProvidersPage from "./pages/ProvidersPage"
import ModelsPage from "./pages/ModelsPage"
import TestsPage from "./pages/TestsPage"

type Page = "providers" | "models" | "tests"

const NAV: { key: Page; label: string }[] = [
  { key: "providers", label: "Providers" },
  { key: "models", label: "Models" },
  { key: "tests", label: "Tests" },
]

const App: Component = () => {
  const [page, setPage] = createSignal<Page>("providers")

  return (
    <div class="flex h-screen bg-[var(--color-bg)]">
      <aside class="w-56 bg-[var(--color-surface)] border-r border-[var(--color-border)] flex flex-col shrink-0">
        <div class="px-5 py-4 border-b border-[var(--color-border)] text-lg font-semibold text-[var(--color-accent)]">
          Model Auth Check
        </div>
        <nav class="flex-1 p-3 flex flex-col gap-1">
          <For each={NAV}>
            {({ key, label }) => (
              <button
                class={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  page() === key
                    ? "bg-[var(--color-accent)] text-white shadow-sm"
                    : "text-[var(--color-fg-muted)] hover:bg-[var(--color-card)] hover:text-[var(--color-fg)]"
                }`}
                onClick={() => setPage(key)}
              >
                {label}
              </button>
            )}
          </For>
        </nav>
        <BackendStatus />
      </aside>

      <main class="flex-1 overflow-auto p-8">
        <Show when={page() === "providers"}>
          <ProvidersPage />
        </Show>
        <Show when={page() === "models"}>
          <ModelsPage />
        </Show>
        <Show when={page() === "tests"}>
          <TestsPage />
        </Show>
      </main>
    </div>
  )
}

const BackendStatus: Component = () => {
  const [ok, setOk] = createSignal<boolean | null>(null)
  const [attempts, setAttempts] = createSignal(0)

  const check = async () => {
    try {
      const { api } = await import("./api")
      await api.health()
      setOk(true)
    } catch {
      setOk(false)
      setAttempts(a => a + 1)
    }
  }

  check()
  setInterval(check, 3000)

  return (
    <div class="px-5 py-3 border-t border-[var(--color-border)] text-xs flex items-center gap-2">
      <Show
        when={ok() === true}
        fallback={
          <>
            <span class="w-2 h-2 rounded-full bg-[var(--color-danger)] animate-pulse" />
            <span class="text-[var(--color-fg-muted)]">
              {attempts() === 0 ? "Checking..." : "Backend starting..."}
            </span>
          </>
        }
      >
        <span class="w-2 h-2 rounded-full bg-[var(--color-success)]" />
        <span class="text-[var(--color-fg-muted)]">Backend connected</span>
      </Show>
    </div>
  )
}

export default App
