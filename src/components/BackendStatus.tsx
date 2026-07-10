import { Component, createSignal, Show, onMount, onCleanup } from "solid-js"
import { api } from "../api"
import { isAnyCheckRunning } from "../store"

const BackendStatus: Component = () => {
  const [ok, setOk] = createSignal<boolean | null>(null)
  const [attempts, setAttempts] = createSignal(0)
  const [consecutiveFailures, setConsecutiveFailures] = createSignal(0)

  onMount(() => {
    let slowMode = false

    const check = async () => {
      // When a test is running, the SSE stream proves the backend is alive.
      // Health-check polling during tests is pointless AND wasteful — it
      // consumes a concurrent HTTP connection slot (browsers limit to 6
      // connections per host), competing with the SSE stream and other
      // polling requests, causing spurious timeouts.
      if (isAnyCheckRunning()) {
        // Keep the backend state as "connected" since SSE is alive.
        // Reset failure counters so that when the test ends we start fresh.
        if (!ok()) setOk(true)
        setConsecutiveFailures(0)
        return
      }

      try {
        await api.health()
        if (!ok()) {
          setOk(true)
          setAttempts(0)
          setConsecutiveFailures(0)
          // Switch to slower polling once connected (less resource pressure)
          slowMode = true
          clearInterval(id)
          id = window.setInterval(check, 15000)
        } else {
          setConsecutiveFailures(0)
        }
      } catch {
        setAttempts(a => a + 1)
        const failures = consecutiveFailures() + 1
        setConsecutiveFailures(failures)

        // When a test is running, the SSE stream is alive — the backend is
        // clearly not dead. Health-check timeouts during test runs are
        // transient (event loop saturation from 9 concurrent model workers).
        // We require many more consecutive failures before showing "disconnected".
        const isBusy = isAnyCheckRunning()
        const threshold = isBusy ? 15 : 3

        // Flap protection: require N+ consecutive failures before flipping UI
        // to "disconnected". During massive test runs, uvicorn's event loop
        // can be saturated, causing brief health-check timeouts even though
        // the backend is alive and processing — we don't want to mislead
        // the user into thinking the server died.
        if (failures >= threshold) {
          setOk(false)
        } else if (ok() === null) {
          // First-ever check failed - show as not connected
          setOk(false)
        }
        // When really disconnected, speed back up to detect recovery quickly
        if (failures >= threshold && slowMode) {
          slowMode = false
          clearInterval(id)
          id = window.setInterval(check, 3000)
        }
      }
    }

    check()
    let id = window.setInterval(check, 3000)

    const onVisibilityChange = () => {
      if (document.hidden) {
        // Tab hidden: slow everything down aggressively
        clearInterval(id)
        id = window.setInterval(check, 30000)
      } else if (ok()) {
        clearInterval(id)
        id = window.setInterval(check, 15000)
        // Trigger an immediate check when becoming visible again
        check()
      } else {
        clearInterval(id)
        id = window.setInterval(check, 3000)
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange)

    onCleanup(() => {
      clearInterval(id)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    })
  })

  // Show a subtle "busy" state while tests are running
  const isTesting = () => isAnyCheckRunning()

  return (
    <div class="px-5 py-3 border-t border-[var(--color-ink-2)]/30 text-xs flex items-center gap-2">
      <Show
        when={ok() === true}
        fallback={
          <>
            <Show when={isTesting()} fallback={
              <>
                <span class="w-2 h-2 rounded-full bg-[var(--color-danger)] animate-pulse" />
                <span class="text-[var(--color-ink-1)]">
                  {attempts() === 0 ? "检查中..." : "后端启动中..."}
                </span>
              </>
            }>
              <span class="w-2 h-2 rounded-full bg-[var(--color-gold)] shadow-[0_0_6px_var(--color-gold)] animate-pulse" />
              <span class="text-[var(--color-ink-1)]">检测中（服务器繁忙）</span>
            </Show>
          </>
        }
      >
        <Show when={isTesting()} fallback={
          <>
            <span class="w-2 h-2 rounded-full bg-[var(--color-gold)] shadow-[0_0_6px_var(--color-gold)]" />
            <span class="text-[var(--color-ink-1)]">后端已连接</span>
          </>
        }>
          <span class="w-2 h-2 rounded-full bg-[var(--color-gold)] shadow-[0_0_6px_var(--color-gold)] animate-pulse" />
          <span class="text-[var(--color-ink-1)]">检测中...</span>
        </Show>
      </Show>
    </div>
  )
}

export default BackendStatus
