import { Component, createSignal, Show, For, onMount } from "solid-js"
import { HashRouter, Route } from "@solidjs/router"
import { invoke } from "@tauri-apps/api/core"
import ProvidersPage from "./pages/ProvidersPage"
import ModelsPage from "./pages/ModelsPage"
import TestsPage from "./pages/TestsPage"
import RecordPage from "./pages/RecordPage"
import DetailPage from "./pages/DetailPage"
import BackendStatus from "./components/BackendStatus"
import { testRunState } from "./store"
import { api } from "./api"

type Page = "providers" | "models" | "tests" | "record"

const NAV: { key: Page; label: string }[] = [
  { key: "providers", label: "Providers" },
  { key: "models", label: "Models" },
  { key: "tests", label: "Tests" },
  { key: "record", label: "Record" },
]

const MainLayout: Component = () => {
  const [page, setPage] = createSignal<Page>("providers")

  onMount(async () => {
    try {
      const r = await api.getResults()
      if (r.length > 0) {
        // Load latest run into store
      }
    } catch {
      // ignore
    }
  })

  return (
    <div class="h-screen flex flex-col bg-[var(--color-bg)]">
      {/* Custom Frameless Title Bar */}
      <div
        data-tauri-drag-region
        class="h-8 bg-[var(--color-surface)] flex items-center justify-between px-3 select-none border-b border-[var(--color-ink-2)]/30"
      >
        <div data-tauri-drag-region class="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-gold)" stroke-width="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
          <span class="font-mono text-sm text-[var(--color-gold)]">Model Auth Check</span>
        </div>
        <div class="flex gap-1">
          <button
            onClick={() => invoke("minimize_window")}
            class="w-8 h-7 flex items-center justify-center hover:bg-[var(--color-ink-3)] rounded-sm transition-colors text-[var(--color-gold)]/70"
          >
            <svg width="10" height="2" viewBox="0 0 10 2" fill="currentColor">
              <rect width="10" height="1" y="0.5" />
            </svg>
          </button>
          <button
            onClick={() => invoke("toggle_maximize_window")}
            class="w-8 h-7 flex items-center justify-center hover:bg-[var(--color-ink-3)] rounded-sm transition-colors text-[var(--color-gold)]/70"
          >
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor">
              <rect x="0.5" y="0.5" width="9" height="9" />
            </svg>
          </button>
          <button
            onClick={() => invoke("close_window")}
            class="w-8 h-7 flex items-center justify-center hover:bg-[var(--color-danger)] hover:text-white rounded-sm transition-colors text-[var(--color-gold)]/70"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor">
              <line x1="1" y1="1" x2="9" y2="9" stroke-width="1.2" />
              <line x1="9" y1="1" x2="1" y2="9" stroke-width="1.2" />
            </svg>
          </button>
        </div>
      </div>

      <div class="flex flex-1 overflow-hidden">
        <aside class="w-56 bg-[var(--color-surface)] border-r border-[var(--color-ink-2)]/30 flex flex-col shrink-0">
          <nav class="flex-1 p-3 flex flex-col gap-1 pt-4">
            <For each={NAV}>
              {item => (
                <button
                  class={`relative w-full text-left px-3 py-2.5 text-sm font-medium transition-all ${
                    page() === item.key
                      ? "text-[var(--color-gold)]"
                      : "text-[var(--color-ink-1)] hover:text-[var(--color-gold)]/80 hover:bg-[var(--color-ink-3)]"
                  }`}
                  onClick={() => setPage(item.key)}
                >
                  <Show when={page() === item.key}>
                    <div class="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-[var(--color-gold)] rounded-r" />
                  </Show>
                  {item.label}
                  <Show when={item.key === "tests" && testRunState.running}>
                    <span class="ml-2 inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-gold)] animate-pulse" />
                  </Show>
                </button>
              )}
            </For>
          </nav>
          <BackendStatus />
        </aside>

        <main class="flex-1 overflow-auto p-8 relative">
          <div class={page() === "providers" ? "" : "hidden"}><ProvidersPage /></div>
          <div class={page() === "models" ? "" : "hidden"}><ModelsPage /></div>
          <div class={page() === "tests" ? "" : "hidden"}><TestsPage /></div>
          <div class={page() === "record" ? "" : "hidden"}><RecordPage /></div>
        </main>
      </div>
    </div>
  )
}

const App: Component = () => {
  return (
    <HashRouter root={RootLayout}>
      <Route path="/detail/:runId" component={DetailPage} />
      <Route path="/*" component={MainLayout} />
    </HashRouter>
  )
}

const RootLayout: Component<import("solid-js").ParentProps> = props => {
  return <>{props.children}</>
}

export default App
