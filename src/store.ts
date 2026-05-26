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

const [testRunState, setTestRunState] = createStore<TestRunState>({
  running: false,
  elapsed: 0,
  runStartTime: null,
  progress: {},
  activeRun: null,
  error: null,
})

export { testRunState, setTestRunState }
export type { ModelProgress, TestRunState }
