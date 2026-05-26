import { Component, createResource, Show, For } from "solid-js"
import { useParams } from "@solidjs/router"
import { SolidApexCharts } from "solid-apexcharts"
import { api, TestRun, ModelResult } from "../api"
import { CAT_LABELS, formatElapsed, scoreColor } from "../components/ResultCard"
const DetailPage: Component = () => {
  const params = useParams<{ runId: string }>()
  const [data] = createResource(async () => {
    const r = await api.getResultById(params.runId)
    return r as TestRun | null
  })

  return (
    <div class="min-h-screen bg-[var(--color-bg)] text-[var(--color-fg)] p-8">
      <div class="max-w-7xl mx-auto">
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

  const providers = (): { name: string; results: ModelResult[] }[] => {
    const map = new Map<string, ModelResult[]>()
    for (const r of run().results) {
      const k = r.provider_name || "unknown"
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(r)
    }
    return Array.from(map.entries()).map(([name, results]) => ({ name, results }))
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
                <For each={allCats()}>
                  {cat => <th class="text-right px-4 py-3">{CAT_LABELS[cat] || cat}</th>}
                </For>
              </tr>
            </thead>
            <tbody>
              <For
                each={[...run().results].sort(
                  (a, b) =>
                    (b.total > 0 ? b.passed / b.total : 0) - (a.total > 0 ? a.passed / a.total : 0),
                )}
              >
                {r => (
                  <tr class="border-t border-[var(--color-border)] hover:bg-[var(--color-card)]/30">
                    <td class="px-4 py-3 font-medium">{r.model_id}</td>
                    <td class="px-4 py-3 text-[var(--color-fg-muted)] text-xs">{r.provider_name}</td>
                    <td class={`px-4 py-3 text-right font-semibold ${scoreColor(r.passed, r.total)}`}>
                      {r.total > 0 ? `${Math.round((r.passed / r.total) * 100)}%` : "-"}
                    </td>
                    <td class="px-4 py-3 text-right">
                      {r.passed}/{r.total}
                    </td>
                    <td class="px-4 py-3 text-right text-[var(--color-fg-muted)]">
                      {formatElapsed(r.elapsed_ms || 0)}
                    </td>
                    <td class="px-4 py-3 text-right text-[var(--color-fg-muted)]">
                      {r.avg_latency_ms.toFixed(0)}ms
                    </td>
                    <For each={allCats()}>
                      {cat => {
                        const c = (r.categories || {})[cat]
                        return (
                          <td class={`px-4 py-3 text-right ${c ? scoreColor(c.passed, c.total) : "text-[var(--color-fg-muted)]"}`}>
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
                      <span>{r.model_id}</span>
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
