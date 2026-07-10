import { Component, createSignal, For, Show } from "solid-js"

const PROFILES_LIST = [
  { value: "programmer", label: "程序员", desc: "编程25%+数学20%+逻辑20%+游戏15%+安全10%+常识10%" },
  { value: "full", label: "完整（8个类别）", desc: "所有类别按比例" },
  { value: "math_logic", label: "数学与逻辑", desc: "数学30%+逻辑30%+编程20%+常识20%" },
  { value: "safety", label: "安全", desc: "安全45%+语言25%+心理15%+常识15%" },
  { value: "quick", label: "快速筛查", desc: "编程25%+数学25%+逻辑20%+常识20%+安全10%" },
]

const QT_START_URL = "http://localhost:8765/api/quick-test/start"
const QT_SUBMIT_URL = "http://localhost:8765/api/quick-test/submit"

const TestsApiPage: Component = () => {
  const [profile, setProfile] = createSignal("programmer")
  const [numTests, setNumTests] = createSignal(100)
  const [copied, setCopied] = createSignal(false)

  const selectedProfile = () => PROFILES_LIST.find(p => p.value === profile())!

  const handleCopy = async () => {
    const p = selectedProfile()
    const prompt = `你现在要参加一场智力测试。你只需要回答题目，答案由你亲自给出。

【第一步：获取题目】
向以下端点发起 POST 请求获取题目：
POST ${QT_START_URL}
Content-Type: application/json

请求体：
{
  "model_name": "你的名字/模型ID",
  "num_questions": ${numTests()},
  "profile": "${p.value}"
}

响应示例：
{
  "session_id": "a1b2c3d4",
  "total": ${numTests()},
  "profile": "${p.value}",
  "questions": [
    {
      "question_id": "a1b2c3d4_0",
      "category": "coding_cs",
      "question": "题目内容..."
    },
    ...
  ]
}

保存 session_id，接下来答题要用。

【第二步：回答问题】
阅读每道题目，给出你认为正确的答案。答案应简洁（如单个字母、数字或短词）。
你可以一次性回答所有问题，也可以逐题回答。

【第三步：提交答案】
回答完所有题目后，向以下端点提交你的答案：
POST ${QT_SUBMIT_URL}
Content-Type: application/json

请求体：
{
  "session_id": "你在第一步获取到的 session_id",
  "answers": [
    { "question_id": "a1b2c3d4_0", "answer": "你的答案" },
    { "question_id": "a1b2c3d4_1", "answer": "你的答案" },
    ...
  ]
}

响应示例：
{
  "session_id": "a1b2c3d4",
  "model_name": "你的名字",
  "passed": 80,
  "answered": 100,
  "total": ${numTests()},
  "score": 80.0,
  "profile": "${p.value}",
  "details": [ ... ]
}

score 是你的得分（百分制，0-100）。

【测评方案说明】当前已选定 "${p.value}"（${p.label}：${p.desc}）。

【题目数】当前已设为 ${numTests()}。

【重要提示】
- 你本人就是被测模型，必须亲自给出答案，不能引用其他模型或外部资源
- 提交答案时 answer 字段填写你的原始回答，服务器会自动评分
- 本次测试的结果会被记录到服务器历史供查询

现在请按以上步骤开始测试。
`

    try {
      await navigator.clipboard.writeText(prompt)
    } catch {
      const ta = document.createElement("textarea")
      ta.value = prompt
      document.body.appendChild(ta)
      ta.select()
      document.execCommand("copy")
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div>
      <h1 class="text-2xl font-bold mb-6">测评（API）</h1>

      <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 mb-6 flex flex-col gap-5">
        <div>
          <div class="text-sm font-semibold text-[var(--color-accent)] mb-1">API 地址</div>
          <div class="flex flex-col gap-2">
            <div class="flex items-center gap-2">
              <span class="text-xs text-[var(--color-fg-muted)] w-20 shrink-0">获取题目：</span>
              <code class="flex-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm font-mono text-[var(--color-accent)]">
                {QT_START_URL}
              </code>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs text-[var(--color-fg-muted)] w-20 shrink-0">提交答案：</span>
              <code class="flex-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm font-mono text-[var(--color-accent)]">
                {QT_SUBMIT_URL}
              </code>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-4 flex-wrap">
          <label class="text-sm text-[var(--color-fg-muted)]">测评方案：</label>
          <select
            class="bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-1.5 text-sm outline-none focus:border-[var(--color-accent)] transition"
            value={profile()}
            onChange={e => setProfile(e.currentTarget.value)}
          >
            <For each={PROFILES_LIST}>
              {p => <option value={p.value}>{p.label}</option>}
            </For>
          </select>
          <span class="text-xs text-[var(--color-fg-muted)]">{selectedProfile().desc}</span>
        </div>

        <div class="flex items-center gap-4 flex-wrap">
          <label class="text-sm text-[var(--color-fg-muted)]">题目数：</label>
          <select
            class="bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-1.5 text-sm outline-none focus:border-[var(--color-accent)] transition"
            value={String(numTests())}
            onChange={e => setNumTests(parseInt(e.currentTarget.value) || 100)}
          >
            <option value="10">10</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="200">200</option>
            <option value="500">500</option>
            <option value="1000">1000</option>
          </select>
        </div>

        <div class="border-t border-[var(--color-border)] pt-4">
          <div class="flex items-center justify-between">
            <div class="text-xs text-[var(--color-fg-muted)]">
              复制提示词，粘贴到任意 LLM 对话框中，即可让该 Agent 直接调用本地智力测试 API
            </div>
            <button
              class="shrink-0 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-sm font-medium px-5 py-2.5 rounded-lg transition flex items-center gap-2"
              onClick={handleCopy}
            >
              <Show when={copied()}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </Show>
              <Show when={!copied()}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </Show>
              {copied() ? "已复制" : "一键复制"}
            </button>
          </div>
        </div>
      </div>

      <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5">
        <div class="text-sm font-semibold text-[var(--color-fg-muted)] mb-3">使用说明</div>
        <ul class="text-xs text-[var(--color-fg-muted)] flex flex-col gap-2 list-disc list-inside">
          <li>复制提示词发送给任意 LLM，它就会按步骤亲自做题</li>
          <li>Agent 自己就是被测模型，不需要 base_url 或 API Key</li>
          <li>答题完成后提交答案，服务器评分并记录到测试历史</li>
          <li>题目数和测评方案已按当前选择预填入提示词</li>
          <li>所有题目从本地题库抽取，不会上传到外部</li>
        </ul>
      </div>
    </div>
  )
}

export default TestsApiPage
