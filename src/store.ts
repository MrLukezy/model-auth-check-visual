import { createStore } from "solid-js/store"

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
  activeTab: "providers" | "models" | "tests" | "record" | "auth"
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

export { testRunState, setTestRunState, uiState, setUiState }
export type { ModelProgress, TestRunState }
