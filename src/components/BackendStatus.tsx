import { Component, createSignal, Show, onMount, onCleanup } from "solid-js"
import { api } from "../api"

const BackendStatus: Component = () => {
  const [ok, setOk] = createSignal<boolean | null>(null)
  const [attempts, setAttempts] = createSignal(0)

  onMount(() => {
    const check = async () => {
      try {
        await api.health()
        setOk(true)
      } catch {
        setOk(false)
        setAttempts(a => a + 1)
      }
    }
    check()
    const id = setInterval(check, 3000)
    onCleanup(() => clearInterval(id))
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
