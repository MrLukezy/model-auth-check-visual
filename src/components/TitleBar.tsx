import { Component } from "solid-js"
import { invoke } from "@tauri-apps/api/core"

interface TitleBarProps {
  title?: string
  leftContent?: import("solid-js").JSX.Element
}

const TitleBar: Component<TitleBarProps> = props => {
  return (
    <div
      data-tauri-drag-region
      class="h-8 bg-[var(--color-surface)] flex items-center justify-between px-3 select-none border-b border-[var(--color-ink-2)]/30 shrink-0"
    >
      <div data-tauri-drag-region class="flex items-center gap-2">
        {props.leftContent ? (
          props.leftContent
        ) : (
          <>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-gold)"
              stroke-width="2"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            <span class="font-mono text-sm text-[var(--color-gold)]">
              {props.title || "Real-O-Meter"}
            </span>
          </>
        )}
      </div>
      <div class="flex gap-1">
        <button
          onClick={() => invoke("minimize_window")}
          class="w-8 h-7 flex items-center justify-center hover:bg-[var(--color-ink-3)] rounded-sm transition-colors text-[var(--color-gold)]/70"
          title="Minimize"
        >
          <svg width="10" height="2" viewBox="0 0 10 2" fill="currentColor">
            <rect width="10" height="1" y="0.5" />
          </svg>
        </button>
        <button
          onClick={() => invoke("toggle_maximize_window")}
          class="w-8 h-7 flex items-center justify-center hover:bg-[var(--color-ink-3)] rounded-sm transition-colors text-[var(--color-gold)]/70"
          title="Maximize / Restore"
        >
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor">
            <rect x="0.5" y="0.5" width="9" height="9" />
          </svg>
        </button>
        <button
          onClick={() => invoke("close_window")}
          class="w-8 h-7 flex items-center justify-center hover:bg-[var(--color-danger)] hover:text-white rounded-sm transition-colors text-[var(--color-gold)]/70"
          title="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor">
            <line x1="1" y1="1" x2="9" y2="9" stroke-width="1.2" />
            <line x1="9" y1="1" x2="1" y2="9" stroke-width="1.2" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export default TitleBar
