import { Component, createSignal, Show } from "solid-js"

const ICONS = [
  { icon: "⚡", label: "最快模型", desc: "在最短的总时间内完成运行", color: "text-[var(--color-accent)]" },
  { icon: "🏆", label: "最佳准确率", desc: "正确率最高；相同时按速度排序", color: "score-diamond" },
  { icon: "🔄", label: "已重试", desc: "请求失败后已自动重试", color: "text-orange-400" },
  { icon: "⏱", label: "超时", desc: "该问题超过了60秒的总时限", color: "text-[var(--color-danger)]" },
  { icon: "✗!", label: "回答错误", desc: "API或网络错误导致无法获取答案", color: "text-rose-400" },
  { icon: "🚧", label: "未完成", desc: "测试运行已取消或未完成", color: "text-yellow-400" },
  { icon: "🛑", label: "用户停止", desc: "运行已被手动停止", color: "text-red-400" },
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
        <span>图标说明</span>
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
