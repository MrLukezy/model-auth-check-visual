import { Component, Show, For, onMount } from "solid-js"
import { HashRouter, Route, useNavigate } from "@solidjs/router"
import ProvidersPage from "./pages/ProvidersPage"
import ModelsPage from "./pages/ModelsPage"
import TestsPage from "./pages/TestsPage"
import TestsApiPage from "./pages/TestsApiPage"
import RecordPage from "./pages/RecordPage"
import AuthCheckPage from "./pages/AuthCheckPage"
import SecurityCheckPage from "./pages/SecurityCheckPage"
import LongContextPage from "./pages/LongContextPage"
import DetailPage from "./pages/DetailPage"
import BackendStatus from "./components/BackendStatus"
import TitleBar from "./components/TitleBar"
import { testRunState, uiState, setUiState } from "./store"
import { api } from "./api"

type Page = "providers" | "models" | "tests" | "testsapi" | "longctx" | "record" | "auth" | "security"

const NAV: { key: Page; label: string }[] = [
  { key: "providers", label: "供应商" },
  { key: "models", label: "模型" },
  { key: "tests", label: "评测" },
  { key: "testsapi", label: "测评（API）" },
  { key: "longctx", label: "长上下文测试" },
  { key: "record", label: "历史记录" },
  { key: "auth", label: "安全性综合检测" },
  { key: "security", label: "Agent安全检测" },
]

const MainLayout: Component = () => {
  const page = () => uiState.activeTab
  const setPage = (p: Page) => setUiState("activeTab", p)

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
      <TitleBar />
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
          <div class={page() === "testsapi" ? "" : "hidden"}><TestsApiPage /></div>
          <div class={page() === "longctx" ? "" : "hidden"}><LongContextPage /></div>
          <div class={page() === "record" ? "" : "hidden"}><RecordPage /></div>
          <div class={page() === "auth" ? "" : "hidden"}><AuthCheckPage /></div>
          <div class={page() === "security" ? "" : "hidden"}><SecurityCheckPage /></div>
        </main>
      </div>
    </div>
  )
}

const DetailLayout: Component = () => {
  const navigate = useNavigate()

  return (
    <div class="h-screen flex flex-col bg-[var(--color-bg)]">
      <TitleBar
        leftContent={
          <button
            onClick={() => navigate(-1)}
            class="flex items-center gap-1.5 text-xs font-medium text-[var(--color-gold)]/80 hover:text-[var(--color-gold)] transition-colors"
            title="返回"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
            <span class="font-mono">详细对比</span>
          </button>
        }
      />
      <DetailPage />
    </div>
  )
}

const App: Component = () => {
  return (
    <HashRouter>
      <Route path="/detail/:runId" component={DetailLayout} />
      <Route path="/*" component={MainLayout} />
    </HashRouter>
  )
}

export default App
