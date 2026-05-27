import { Component, Show } from "solid-js"

interface ConfirmModalProps {
  open: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

const ConfirmModal: Component<ConfirmModalProps> = props => {
  const confirmText = () => props.confirmText || "Confirm"
  const cancelText = () => props.cancelText || "Cancel"

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 flex items-center justify-center">
        {/* 遮罩层 */}
        <div
          class="absolute inset-0 bg-black/70 backdrop-blur-sm"
          onClick={props.onCancel}
        />
        {/* 对话框 */}
        <div class="relative bg-[var(--color-surface)] border border-[var(--color-gold)]/40 rounded-xl shadow-2xl p-6 max-w-md w-full mx-4 z-10">
          <div class="flex items-start gap-3 mb-4">
            <Show when={props.danger}>
              <div class="w-10 h-10 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" stroke-width="2">
                  <path d="M12 9v4M12 17h.01" />
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
            </Show>
            <div class="flex-1 min-w-0">
              <h3 class="text-lg font-semibold text-[var(--color-gold)] mb-1">
                {props.title}
              </h3>
              <p class="text-sm text-[var(--color-fg-muted)]">{props.message}</p>
            </div>
          </div>

          <div class="flex justify-end gap-3 mt-6">
            <button
              class="px-4 py-2 text-sm font-medium rounded-lg border border-[var(--color-border)] text-[var(--color-fg)] hover:bg-[var(--color-card)] transition"
              onClick={props.onCancel}
            >
              {cancelText()}
            </button>
            <button
              class={`px-4 py-2 text-sm font-medium rounded-lg transition ${
                props.danger
                  ? "bg-red-500 hover:bg-red-600 text-white"
                  : "bg-[var(--color-gold)] hover:bg-[var(--color-gold-light)] text-black"
              }`}
              onClick={props.onConfirm}
            >
              {confirmText()}
            </button>
          </div>
        </div>
      </div>
    </Show>
  )
}

export default ConfirmModal
