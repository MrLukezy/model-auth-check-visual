import { Component, createSignal, onCleanup, onMount, ParentProps, Show } from "solid-js"

const Dropdown: Component<ParentProps<{ trigger: string }>> = props => {
  const [open, setOpen] = createSignal(false)
  let ref: HTMLDivElement | undefined

  const handleClickOutside = (e: MouseEvent) => {
    if (ref && !ref.contains(e.target as Node)) setOpen(false)
  }

  onMount(() => document.addEventListener("click", handleClickOutside))
  onCleanup(() => document.removeEventListener("click", handleClickOutside))

  return (
    <div ref={ref} class="relative">
      <button
        class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-4 py-2 text-sm hover:border-[var(--color-accent)] transition flex items-center gap-2"
        onClick={() => setOpen(!open())}
      >
        {props.trigger}
        <span class="text-xs">▼</span>
      </button>
      <Show when={open()}>
        <div class="absolute right-0 top-full mt-1 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg shadow-xl min-w-48 z-50 py-1">
          {props.children}
        </div>
      </Show>
    </div>
  )
}

export default Dropdown
