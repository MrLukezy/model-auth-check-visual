import { Component, createSignal, Show } from "solid-js"

const ICONS = [
  { icon: "⚡", label: "Fastest model", desc: "Finished the run in the shortest wall-clock time", color: "text-[var(--color-accent)]" },
  { icon: "🏆", label: "Best accuracy", desc: "Highest correct rate; ties broken by speed", color: "score-diamond" },
  { icon: "🔄", label: "Retried", desc: "The request failed and was automatically retried", color: "text-orange-400" },
  { icon: "⏱", label: "Timed out", desc: "The question exceeded the 60-second total budget", color: "text-[var(--color-danger)]" },
  { icon: "✗!", label: "Answer error", desc: "API or network error prevented getting an answer", color: "text-rose-400" },
  { icon: "🚧", label: "Incomplete", desc: "The test run was cancelled or did not finish", color: "text-yellow-400" },
  { icon: "🛑", label: "Stopped by user", desc: "The run was manually stopped", color: "text-red-400" },
]

const IconLegend: Component = () => {
  const [open, setOpen] = createSignal(false)

  return (
    <div class="mb-4">
      <button
        class="text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-accent)] transition flex items-center gap-1"
        onClick={() => setOpen(!open())}
      >
        <span>{open() ? "▼" : "▶"}</span>
        <span>Icon legend</span>
      </button>
      <Show when={open()}>
        <div class="mt-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            {ICONS.map(({ icon, label, desc, color }) => (
              <div class="flex items-start gap-2">
                <span class={`${color} w-6 text-center shrink-0 leading-5 text-base`}>{icon}</span>
                <div>
                  <div class="font-semibold text-[var(--color-fg)]">{label}</div>
                  <div class="text-[var(--color-fg-muted)]">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Show>
    </div>
  )
}

export default IconLegend
