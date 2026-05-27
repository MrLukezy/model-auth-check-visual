import { onCleanup } from "solid-js"

/**
 * Runs `callback` every `intervalMs` milliseconds, but:
 * - Pauses completely when `document.hidden` is true (tab not visible)
 * - Skips overlapping calls: if previous run is still in progress, skip this tick
 * - Auto-cleans up on component unmount
 */
export function usePolling(callback: () => Promise<void> | void, intervalMs: number) {
  let running = false
  let hidden = document.hidden
  let timerId: number | null = null

  const tick = async () => {
    if (running || hidden) return
    running = true
    try {
      await callback()
    } finally {
      running = false
    }
  }

  const startTimer = () => {
    if (timerId !== null) window.clearInterval(timerId)
    timerId = window.setInterval(tick, intervalMs)
  }

  const stopTimer = () => {
    if (timerId !== null) {
      window.clearInterval(timerId)
      timerId = null
    }
  }

  const onVisibilityChange = () => {
    hidden = document.hidden
    if (hidden) {
      stopTimer()
    } else {
      tick()
      startTimer()
    }
  }

  startTimer()
  document.addEventListener("visibilitychange", onVisibilityChange)

  onCleanup(() => {
    stopTimer()
    document.removeEventListener("visibilitychange", onVisibilityChange)
  })
}
