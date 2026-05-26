import { Component, createSignal, Show, For } from "solid-js"
import { HashRouter, Route, useNavigate, useLocation } from "@solidjs/router"
import ProvidersPage from "./pages/ProvidersPage"
import ModelsPage from "./pages/ModelsPage"
import TestsPage from "./pages/TestsPage"
import RecordPage from "./pages/RecordPage"
import DetailPage from "./pages/DetailPage"

type NavKey = "providers" | "models" | "tests" | "record"

const NAV: { key: NavKey; label: string; path: string }[] = [
  { key: "providers", label: "Providers", path: "/providers" },
  { key: "models", label: "Models", path: "/models" },
  { key: "tests", label: "Tests", path: "/tests" },
  { key: "record", label: "Record", path: "/record" },
]

const App: Component = () => {
  return (
    <HashRouter root={Layout}>
      <Route path="/providers" component={ProvidersPage} />
      <Route path="/models" component={ModelsPage} />
      <Route path="/tests" component={TestsPage} />
      <Route path="/record" component={RecordPage} />
      <Route path="/detail/:runId" component={DetailPage} />
      <Route path="/" component={ProvidersPage} />
    </HashRouter>
  )
}

const Layout: Component<import("solid-js").ParentProps> = props => {
  const navigate = useNavigate()
  const location = useLocation()

  const activeKey = (): NavKey => {
    const p = location.pathname
    if (p.startsWith("/providers")) return "providers"
    if (p.startsWith("/models")) return "models"
    if (p.startsWith("/tests")) return "tests"
    if (p.startsWith("/record")) return "record"
    return "providers"
  }

  const isDetailPage = () => location.pathname.startsWith("/detail")

  return (
    <Show when={isDetailPage()} fallback={
      <div class="flex h-screen bg-[var(--color-bg)]">
        <aside class="w-56 bg-[var(--color-surface)] border-r border-[var(--color-border)] flex flex-col shrink-0">
          <div class="px-5 py-4 border-b border-[var(--color-border)] text-lg font-semibold text-[var(--color-accent)]">
            Model Auth Check
          </div>
          <nav class="flex-1 p-3 flex flex-col gap-1">
            <For each={NAV}>
              {item => (
                <button
                  class={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    activeKey() === item.key
                      ? "bg-[var(--color-accent)] text-white shadow-sm"
                      : "text-[var(--color-fg-muted)] hover:bg-[var(--color-card)] hover:text-[var(--color-fg)]"
                  }`}
                  onClick={() => navigate(item.path)}
                >
                  {item.label}
                </button>
              )}
            </For>
          </nav>
          <BackendStatus />
        </aside>

        <main class="flex-1 overflow-auto p-8">{props.children}</main>
      </div>
    }>
      {props.children}
    </Show>
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
