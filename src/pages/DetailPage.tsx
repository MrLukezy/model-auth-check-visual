import { Component, createResource, Show, For } from "solid-js"
import { useParams, useNavigate } from "@solidjs/router"
import { SolidApexCharts } from "solid-apexcharts"
import { api, TestRun, ModelResult } from "../api"
import { CAT_LABELS, formatElapsed, scoreColor } from "../components/ResultCard"
import IconLegend from "../components/IconLegend"
import "../components/score-colors.css"
const DetailPage: Component = () => {
  const params = useParams<{ runId: string }>()
  const navigate = useNavigate()
  const [data] = createResource(async () => {
    const r = await api.getResultById(params.runId)
    return r as TestRun | null
  })

  return (
    <div class="h-screen overflow-auto bg-[var(--color-bg)] text-[var(--color-fg)]">
      <div class="max-w-7xl mx-auto p-8">
        <button
          onClick={() => navigate(-1)}
          class="mb-4 text-sm text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition flex items-center gap-1"
        >
          ← Back
        </button>
        <IconLegend />
        <Show
          when={data()}
          fallback={
            <div class="text-center text-[var(--color-fg-muted)] py-12">
              {data.loading ? "Loading..." : "Run not found."}
            </div>
          }
        >
          {run => <RunDetail run={run()} />}
        </Show>
      </div>
    </div>
  )
}

const RunDetail: Component<{ run: TestRun }> = props => {
  const run = () => props.run
  const pct = () =>
    run().total_questions > 0
      ? Math.round((run().total_passed / run().total_questions) * 100)
      : 0

  const fastestModelId = () => {
    const results = run().results
    if (!results || results.length === 0) return null
    let fastest = results[0]
    for (const r of results) {
      if ((r.elapsed_ms || 0) > 0 && (r.elapsed_ms || 0) < (fastest.elapsed_ms || Infinity)) {
        fastest = r
      }
    }
    return fastest?.model_id || null
  }

  const bestAccuracyModelId = () => {
    const results = run().results
    if (!results || results.length === 0) return null
    let best = results[0]
    let bestScore = best.total > 0 ? best.passed / best.total : 0
    let bestTime = best.elapsed_ms && best.elapsed_ms > 0 ? best.elapsed_ms : Infinity
    for (const r of results) {
      const score = r.total > 0 ? r.passed / r.total : 0
      const time = r.elapsed_ms && r.elapsed_ms > 0 ? r.elapsed_ms : Infinity
      if (
        score > bestScore ||
        (score === bestScore && time < bestTime)
      ) {
        best = r
        bestScore = score
        bestTime = time
      }
    }
    return best?.model_id || null
  }

  const providers = (): { key: string; name: string; results: ModelResult[] }[] => {
    // Use provider_name + model_id as the grouping key so that the same
    // model_id under different providers (e.g. DawnShift's 5.5 vs TimiCC's 5.5)
    // remain distinct, while true duplicates are merged.
    const map = new Map<string, ModelResult[]>()
    for (const r of run().results) {
      const providerName = r.provider_name || "unknown"
      const key = `${providerName}::${r.model_id}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(r)
    }

    // Detect provider_names that appear more than once across distinct models
    // (e.g. "5.5" used by both DawnShift and TimiCC). When so, disambiguate
    // the card title with the model_id to avoid them looking like the same vendor.
    const nameCounts = new Map<string, Set<string>>()
    for (const [k, results] of map.entries()) {
      const name = k.split("::")[0]
      if (!nameCounts.has(name)) nameCounts.set(name, new Set())
      for (const r of results) nameCounts.get(name)!.add(r.model_id)
    }
    const ambiguousNames = new Set(
      Array.from(nameCounts.entries())
        .filter(([, ids]) => ids.size > 1)
        .map(([name]) => name),
    )

    return Array.from(map.entries()).map(([key, results]) => {
      const [providerName] = key.split("::")
      const first = results[0]
      const label = ambiguousNames.has(providerName) && results.length === 1
        ? `${providerName} · ${first.model_id}`
        : providerName
      return { key, name: label, results }
    })
  }

  const allCats = () => {
    const set = new Set<string>()
    for (const r of run().results) {
      for (const k of Object.keys(r.categories || {})) set.add(k)
    }
    return Array.from(set)
  }

  const accuracySeries = () => [
    {
      name: "Accuracy %",
      data: run().results.map(r =>
        r.total > 0 ? Math.round((r.passed / r.total) * 100) : 0,
      ),
    },
  ]

  const accuracyOptions = (): any => ({
    chart: { type: "bar" as const, toolbar: { show: false }, background: "transparent", foreColor: "#a3a3a3" },
    plotOptions: { bar: { borderRadius: 6, columnWidth: "60%" } },
    colors: run().results.map(r => (r.total > 0 && r.passed / r.total >= 0.95 ? "#e8d49a" : r.total > 0 && r.passed / r.total >= 0.8 ? "#2ecc71" : r.total > 0 && r.passed / r.total >= 0.6 ? "#f39c12" : "#e74c3c")),
    theme: { mode: "dark" as const },
    xaxis: {
      categories: run().results.map(r => r.model_id),
      labels: { style: { fontSize: "11px" } },
    },
    yaxis: { max: 100, labels: { formatter: (v: number) => `${v}%` } },
    tooltip: { y: { formatter: (v: number) => `${v}%` } },
    grid: { borderColor: "#333" },
    dataLabels: { enabled: true, formatter: (v: number) => `${v}%` },
  })

  const elapsedSeries = () => [
    {
      name: "Total Elapsed (s)",
      data: run().results.map(r => Math.round((r.elapsed_ms || 0) / 1000)),
    },
  ]

  const elapsedOptions = (): any => ({
    chart: { type: "bar" as const, toolbar: { show: false }, background: "transparent", foreColor: "#a3a3a3" },
    plotOptions: { bar: { borderRadius: 6, horizontal: true, barHeight: "60%" } },
    colors: ["#c9a961"],
    theme: { mode: "dark" as const },
    xaxis: { labels: { formatter: (v: number) => `${v}s` } },
    yaxis: {
      labels: { style: { fontSize: "11px" } },
    },
    grid: { borderColor: "#333" },
  })

  const categoryData = () => {
    const cats = allCats()
    const models = run().results.map(r => r.model_id)
    const matrix: number[][] = cats.map(cat =>
      run().results.map(r => {
        const c = (r.categories || {})[cat]
        if (!c || c.total === 0) return 0
        return Math.round((c.passed / c.total) * 100)
      }),
    )
    return {
      series: cats.map((cat, i) => ({ name: CAT_LABELS[cat] || cat, data: matrix[i] })),
      options: {
        chart: { type: "bar" as const, stacked: false, toolbar: { show: false }, background: "transparent", foreColor: "#a3a3a3" },
        plotOptions: { bar: { borderRadius: 4, columnWidth: "70%" } },
        theme: { mode: "dark" as const },
        xaxis: { categories: models, labels: { style: { fontSize: "11px" } } },
        yaxis: { max: 100, labels: { formatter: (v: number) => `${v}%` } },
        legend: { position: "top" as const },
        grid: { borderColor: "#333" },
        dataLabels: { enabled: false },
      } as any,
    }
  }

  return (
    <>
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold flex items-center gap-3">
            Run <span class="font-mono text-[var(--color-accent)]">#{run().run_id}</span>
          </h1>
          <div class="text-sm text-[var(--color-fg-muted)] mt-1">
            {new Date(run().timestamp).toLocaleString()}
            {run().profile && <span class="ml-3">profile: {run().profile}</span>}
            {run().num_tests && <span class="ml-3">{run().num_tests} questions</span>}
            {run().seed && <span class="ml-3">seed: {run().seed}</span>}
          </div>
        </div>
        <div class="text-right">
          <div class="text-sm text-[var(--color-fg-muted)]">Overall</div>
          <div class={`text-3xl font-bold ${scoreColor(run().total_passed, run().total_questions)}`}>
            {pct()}%
          </div>
          <div class="text-sm text-[var(--color-fg-muted)]">
            {run().total_passed}/{run().total_questions} ({run().total_models} models)
          </div>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-6 mb-6">
        <ChartCard title="Accuracy by Model">
          <SolidApexCharts type="bar" options={accuracyOptions()} series={accuracySeries()} height={320} />
        </ChartCard>
        <ChartCard title="Total Elapsed by Model">
          <SolidApexCharts type="bar" options={elapsedOptions()} series={elapsedSeries()} height={320} />
        </ChartCard>
      </div>

      <Show when={allCats().length > 0}>
        <ChartCard title="Category Breakdown per Model">
          <SolidApexCharts
            type="bar"
            options={categoryData().options}
            series={categoryData().series}
            height={360}
          />
        </ChartCard>
      </Show>

      <h2 class="text-lg font-semibold mt-8 mb-4">Detailed Comparison</h2>

      <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl overflow-hidden mb-6">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="bg-[var(--color-card)] text-[var(--color-fg-muted)] text-xs">
                <th class="text-left px-4 py-3">Model</th>
                <th class="text-left px-4 py-3">Provider</th>
                <th class="text-right px-4 py-3">Accuracy</th>
                <th class="text-right px-4 py-3">Passed</th>
                <th class="text-right px-4 py-3">Elapsed</th>
                <th class="text-right px-4 py-3">Avg Latency</th>
                <th class="text-right px-4 py-3">Retries</th>
                <For each={allCats()}>
                  {cat => <th class="text-right px-4 py-3">{CAT_LABELS[cat] || cat}</th>}
                </For>
              </tr>
            </thead>
            <tbody>
              <For
                each={[...run().results].sort((a, b) => {
                  const sa = a.total > 0 ? a.passed / a.total : 0
                  const sb = b.total > 0 ? b.passed / b.total : 0
                  if (sb !== sa) return sb - sa
                  const ta = a.elapsed_ms && a.elapsed_ms > 0 ? a.elapsed_ms : Infinity
                  const tb = b.elapsed_ms && b.elapsed_ms > 0 ? b.elapsed_ms : Infinity
                  return ta - tb
                })}
              >
                {r => (
                  <tr class={`border-t border-[var(--color-border)] hover:bg-[var(--color-card)]/30 ${r.model_id === bestAccuracyModelId() ? "best-row-shimmer" : ""}`}>
                    <td class="px-4 py-3 font-medium relative z-10">
                      <div class="flex items-center gap-1">
                        <Show when={r.model_id === fastestModelId()}>
                          <span class="text-[var(--color-accent)]" title="Fastest model">⚡</span>
                        </Show>
                        <Show when={r.model_id === bestAccuracyModelId()}>
                          <span class="score-diamond font-semibold" title="Best accuracy">🏆</span>
                        </Show>
                        {r.model_id}
                      </div>
                    </td>
                    <td class="px-4 py-3 text-[var(--color-fg-muted)] text-xs relative z-10">{r.provider_name}</td>
                    <td class={`px-4 py-3 text-right font-semibold ${scoreColor(r.passed, r.total)} relative z-10`}>
                      {r.total > 0 ? `${Math.round((r.passed / r.total) * 100)}%` : "-"}
                    </td>
                    <td class="px-4 py-3 text-right relative z-10">
                      {r.passed}/{r.total}
                    </td>
                    <td class="px-4 py-3 text-right text-[var(--color-fg-muted)] relative z-10">
                      {formatElapsed(r.elapsed_ms || 0)}
                    </td>
                    <td class="px-4 py-3 text-right text-[var(--color-fg-muted)] relative z-10">
                      {r.avg_latency_ms.toFixed(0)}ms
                    </td>
                    <td class="px-4 py-3 text-right relative z-10">
                      {(() => {
                        const rt = r.details.reduce((sum, d) => sum + (d.retries || 0), 0)
                        const to = r.details.filter(d => d.timed_out).length
                        const parts: string[] = []
                        return (
                          <div class="flex items-center justify-end gap-1">
                            {rt > 0 && <span class="text-orange-400" title={`Retried ${rt} time(s)`}>🔄{rt}</span>}
                            {to > 0 && <span class="text-[var(--color-danger)]" title={`${to} timed out (60s)`}>⏱{to}</span>}
                            {rt === 0 && to === 0 && <span class="text-[var(--color-fg-muted)]">0</span>}
                          </div>
                        )
                      })()}
                    </td>
                    <For each={allCats()}>
                      {cat => {
                        const c = (r.categories || {})[cat]
                        return (
                          <td class={`px-4 py-3 text-right relative z-10 ${c ? scoreColor(c.passed, c.total) : "text-[var(--color-fg-muted)]"}`}>
                            {c ? `${Math.round((c.passed / c.total) * 100)}%` : "-"}
                          </td>
                        )
                      }}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </div>

      <h2 class="text-lg font-semibold mt-8 mb-4">Provider Grouping</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <For each={providers()}>
          {group => (
            <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5">
              <h3 class="font-semibold mb-3">{group.name}</h3>
              <div class="space-y-2 text-sm">
                <For each={group.results}>
                  {r => (
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-1">
                        <Show when={r.model_id === fastestModelId()}>
                          <span class="text-[var(--color-accent)]" title="Fastest model">⚡</span>
                        </Show>
                        <span>{r.model_id}</span>
                      </div>
                      <span class={scoreColor(r.passed, r.total)}>
                        {r.total > 0 ? `${Math.round((r.passed / r.total) * 100)}%` : "-"}
                        <span class="text-xs text-[var(--color-fg-muted)] ml-2">
                          ({r.passed}/{r.total})
                        </span>
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>
    </>
  )
}

const ChartCard: import("solid-js").ParentComponent<{ title: string }> = props => (
  <div class="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5">
    <h3 class="text-sm font-semibold mb-3 text-[var(--color-fg-muted)]">{props.title}</h3>
    {props.children}
  </div>
)

export default DetailPage
