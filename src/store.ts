import { createStore } from "solid-js/store"
import { createSignal } from "solid-js"

interface ModelProgress {
  model_id: string
  started: boolean
  done: boolean
  completed: number
  passed: number
  total: number
  elapsedMs?: number
}

interface TestRunState {
  running: boolean
  elapsed: number
  runStartTime: number | null
  progress: Record<string, ModelProgress>
  activeRun: import("./api").TestRun | null
  error: string | null
}

interface UIState {
  activeTab: "providers" | "models" | "tests" | "testsapi" | "longctx" | "record" | "auth" | "security"
  expandedRuns: Record<string, boolean>
  sortRuns: Record<string, "accuracy" | "elapsed">
}

const [testRunState, setTestRunState] = createStore<TestRunState>({
  running: false,
  elapsed: 0,
  runStartTime: null,
  progress: {},
  activeRun: null,
  error: null,
})

const [uiState, setUiState] = createStore<UIState>({
  activeTab: "providers",
  expandedRuns: {},
  sortRuns: {},
})

const [authRunning, setAuthRunning] = createSignal(false)
const [securityRunning, setSecurityRunning] = createSignal(false)

function isAnyCheckRunning() {
  return testRunState.running || authRunning() || securityRunning()
}

export { testRunState, setTestRunState, uiState, setUiState }
export { authRunning, setAuthRunning, securityRunning, setSecurityRunning, isAnyCheckRunning }
export type { ModelProgress, TestRunState }
