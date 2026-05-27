import { Component, createSignal, Show, onMount, onCleanup } from "solid-js"
import { api } from "../api"

const BackendStatus: Component = () => {
  const [ok, setOk] = createSignal<boolean | null>(null)
  const [attempts, setAttempts] = createSignal(0)

  onMount(() => {
    let slowMode = false

    const check = async () => {
      try {
        await api.health()
        if (!ok()) {
          setOk(true)
          setAttempts(0)
          // Switch to slower polling once connected (less resource pressure)
          slowMode = true
          clearInterval(id)
          id = window.setInterval(check, 15000)
        }
      } catch {
        setOk(false)
        setAttempts(a => a + 1)
        // When disconnected, speed back up to detect recovery quickly
        if (slowMode) {
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

  return (
    <div class="px-5 py-3 border-t border-[var(--color-ink-2)]/30 text-xs flex items-center gap-2">
      <Show
        when={ok() === true}
        fallback={
          <>
            <span class="w-2 h-2 rounded-full bg-[var(--color-danger)] animate-pulse" />
            <span class="text-[var(--color-ink-1)]">
              {attempts() === 0 ? "Checking..." : "Backend starting..."}
            </span>
          </>
        }
      >
        <span class="w-2 h-2 rounded-full bg-[var(--color-gold)] shadow-[0_0_6px_var(--color-gold)]" />
        <span class="text-[var(--color-ink-1)]">Backend connected</span>
      </Show>
    </div>
  )
}

export default BackendStatus
