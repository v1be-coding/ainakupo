# Dashboard design prior art (for the AInakupo spec)

Researched 2026-11-19 against primary sources: vendor docs, vendor UI source on GitHub (Langfuse, Phoenix,
Helicone), and W3C/WAI pages. Where a source did not answer a question, the text says **not confirmed**
rather than guessing. Vendor UIs change fast. Re-check anything a frozen test will depend on.

Tools covered: Langfuse, Helicone, LangSmith, Arize Phoenix, Braintrust, Lunary, plus Grafana and
Plausible as general dashboards. Lunary's UI source could not be read: `github.com/lunary-ai/lunary`
returned "Repository not found" on 2026-11-19, so Lunary claims come from its docs only. Vercel's
Analytics docs describe panels and filters, not the page layout, so Vercel is not used below.

---

## 1. Summary

- **Headline numbers come first, then breakdowns.** Phoenix puts a row of labelled numbers (Total Traces,
  Total Cost, Latency P50, Latency P99, then one per score) above its traces table. Helicone's grid opens
  with "Avg Cost / Req" and token tiles. Plausible opens with its headline metrics over the main graph.
- **Per-project breakdowns are tables, not charts.** Langfuse's "Model Costs" and "Scores" home widgets
  are pivot tables. Phoenix's project list shows Traces / Sessions / Latency P50 per project.
- **Cost precision grows for small values.** Phoenix shows 4 decimals under $1 and `<$0.0001` below
  that. Langfuse shows up to 6 decimals. Helicone shows 2 to 6. A fixed `$0.0123` (4 dp) is in line with these.
- **Unknown cost is shown as a word or a dash, never as `$0`.** Helicone says "Cost Unsupported",
  Langfuse "no cost", and Braintrust and Phoenix use a dash. Missing scores and latencies use `--` (Phoenix),
  `n/a` (Helicone) or `-` (Grafana).
- **Trace lists show absolute timestamps** (Phoenix, Helicone, Langfuse), with tooltips for the exact
  value. Status is a coloured indicator _with a text label_ ("OK" / "Error" in Phoenix).
- **Time-series charts are everywhere** (every tool's home page, plus Grafana's stat sparklines). A small
  inline-SVG "traces per day" bar chart is worth adding to v1. It needs one API addition: daily buckets.
- **For accessibility, use a native `<table>` with `<caption>` and `<th scope="col">`, right-aligned numbers,
  and text on status (not colour alone).** The caption gives the table its accessible name, which suits
  `getByRole('table', { name })`.
- **Light/dark:** the tools ship toggles, but a read-only page can just follow the OS through
  `prefers-color-scheme` plus `color-scheme: light dark`, with no JS and no stored state.

---

## 2. Layout

| Tool           | What comes first                                                                                                                                                                                                                                                                                                                                                      | Cost / tokens / latency / scores                                                                                                                                                                                                                                 | Per-project breakdown                                                                                                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phoenix**    | Project page: a row of labelled stats, "Total Traces", "Total Cost", "Latency P50", "Latency P99", then one summary per annotation name, above the traces table ([ProjectStats.tsx](https://github.com/Arize-ai/phoenix/blob/main/js/app/src/pages/project/ProjectStats.tsx))                                                                                         | Values in monospace (`fontFamily="mono"`). Cost total opens a prompt/completion breakdown tooltip. Null latency shows `--` ([ProjectStats.tsx](https://github.com/Arize-ai/phoenix/blob/main/js/app/src/pages/project/ProjectStats.tsx))                         | Projects page cards show "Traces", "Sessions", "Latency P50" for each project ([ProjectsPage.tsx](https://github.com/Arize-ai/phoenix/blob/main/js/app/src/pages/projects/ProjectsPage.tsx)) |
| **Langfuse**   | Home preset, in order: "Traces" (bar list), "Model Costs" (pivot table), "Scores" (pivot table), "Traces & Observations over time", "Model Usage", "User Consumption", "Scores over time", then latency percentile tables ([home-preset-registry.tsx](https://github.com/langfuse/langfuse/blob/main/web/src/features/dashboard/components/home-preset-registry.tsx)) | Model cost table columns "Model", "Tokens" (right-aligned, compact), "USD" (right-aligned), with a "Total cost" headline ([ModelCostTableCard.tsx](https://github.com/langfuse/langfuse/blob/main/web/src/features/dashboard/components/ModelCostTableCard.tsx)) | One project per dashboard. Cross-project usage sits in org settings ([custom dashboards](https://langfuse.com/docs/metrics/features/custom-dashboards))                                      |
| **Helicone**   | Grid opens with tiles "Avg Cost / Req", "Avg Prompt Tokens / Req", "Avg Completion Tokens / Req", "Avg Total Tokens / Req", then "Requests" with a Success/Error area chart, then Costs, Users, Latency, and so on ([dashboardPage.tsx](https://github.com/Helicone/helicone/blob/main/web/components/templates/dashboard/dashboardPage.tsx))                         | Latency tile as `"<n> s / req"`. Costs tile uses 7 decimals below $0.02 ([dashboardPage.tsx](https://github.com/Helicone/helicone/blob/main/web/components/templates/dashboard/dashboardPage.tsx))                                                               | **Not confirmed**                                                                                                                                                                            |
| **LangSmith**  | Per-project prebuilt dashboard sections: Traces (count, latency, error rate), LLM Calls, Cost & Tokens, Tools, Run Types, Feedback Scores (average for numeric) ([dashboards](https://docs.langchain.com/langsmith/dashboards))                                                                                                                                       | All charts. A "group by" control splits series ([dashboards](https://docs.langchain.com/langsmith/dashboards))                                                                                                                                                   | One dashboard per project ([dashboards](https://docs.langchain.com/langsmith/dashboards))                                                                                                    |
| **Braintrust** | Built-in "Cost and quality" dashboard of time-series charts: request counts, latency, tokens, costs, scores ([monitor](https://docs.braintrust.dev/guides/monitor))                                                                                                                                                                                                   | Charts, with filters at the top ([monitor](https://docs.braintrust.dev/guides/monitor))                                                                                                                                                                          | Group by `metadata.*` fields ([monitor](https://docs.braintrust.dev/guides/monitor))                                                                                                         |
| **Lunary**     | Docs list analytics for Costs, Usage (calls & tokens), Latency, Errors, Users ([observability](https://docs.lunary.ai/features/observability.md)). Layout **not confirmed**                                                                                                                                                                                           | **Not confirmed**                                                                                                                                                                                                                                                | **Not confirmed**                                                                                                                                                                            |
| **Plausible**  | Headline metrics (unique visitors, visits, pageviews, views per visit, bounce rate, visit duration) on top of the main graph. Clicking a metric charts it. Breakdown reports below ([guided tour](https://plausible.io/docs/guided-tour))                                                                                                                             | n/a                                                                                                                                                                                                                                                              | Breakdown tables (Sources, Top Pages, ...) with sortable metric headings ([top pages](https://plausible.io/docs/top-pages))                                                                  |
| **Grafana**    | Stat panel: a big single value with an optional sparkline behind it ("graph mode") ([stat](https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/stat/))                                                                                                                                                                                       | Empty value shows "-" by default ([stat](https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/stat/))                                                                                                                                    | n/a                                                                                                                                                                                          |

**Takeaways.**

- The consistent order is headline numbers, then a time chart, then breakdown tables, then the raw
  list. Phoenix's header row is the closest match to AInakupo's data: count, cost, latency and scores
  over one table.
- Plausible is a precedent for a _public_ read-only dashboard: a toggle "make your website stats public"
  gives a public URL ([visibility](https://plausible.io/docs/visibility)). Every LLM tool needs a login.

---

## 3. Trace list columns and formatting

| Tool           | Default columns (in order)                                                                                                                                                                                                                                                                | Cost                                                                                                                                                                                                        | Tokens                                                                                                                                                                              | Latency                                                                                                                                                                                                                                                                           | Time                                                                                                                                               | Status / model                                                                                                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phoenix**    | status, kind, name, input, output, ..., start time, latency, total tokens, total cost ([TracesTable.tsx](https://github.com/Arize-ai/phoenix/blob/main/js/app/src/pages/project/TracesTable.tsx))                                                                                         | `formatCost`: `$0`, `<$0.01`, 2 dp under $100. `formatCostPrecise`: 4 dp under $1, `<$0.0001` ([numberFormatUtils.ts](https://github.com/Arize-ai/phoenix/blob/main/js/app/src/utils/numberFormatUtils.ts)) | Thousands commas below 1M, then SI (`1.2M`) ([numberFormatUtils.ts](https://github.com/Arize-ai/phoenix/blob/main/js/app/src/utils/numberFormatUtils.ts))                           | `850ms`, `1.2s`, `2m 5s`, monospace with a clock icon ([numberFormatUtils.ts](https://github.com/Arize-ai/phoenix/blob/main/js/app/src/utils/numberFormatUtils.ts), [LatencyText.tsx](https://github.com/Arize-ai/phoenix/blob/main/js/app/src/components/trace/LatencyText.tsx)) | Absolute, in `<time title=ISO>` ([TimestampCell.tsx](https://github.com/Arize-ai/phoenix/blob/main/js/app/src/components/table/TimestampCell.tsx)) | Labels "OK" / "Error" / "Unset" ([SpanStatusIndicator.tsx](https://github.com/Arize-ai/phoenix/blob/main/js/app/src/components/trace/SpanStatusIndicator.tsx)). Latency, tokens and cost columns are `textAlign: "right"` |
| **Langfuse**   | Timestamp, Name, Input, Output, Observation Levels, Latency, Tokens, Total Cost, Environment, Tags, Metadata. Hidden by default: Scores, Status, Input/Output Tokens and more ([TracesTable.tsx](https://github.com/langfuse/langfuse/blob/main/web/src/features/traces/TracesTable.tsx)) | `usdFormatter`: Intl currency, 2–6 fraction digits ([numbers.ts](https://github.com/langfuse/langfuse/blob/main/web/src/utils/numbers.ts))                                                                  | Input/Output Tokens columns: `numberFormatter(value, 0)`, en-US grouped ([TracesTable.tsx](https://github.com/langfuse/langfuse/blob/main/web/src/features/traces/TracesTable.tsx)) | Unit picked by size (ms, s, min, ...) ([numbers.ts](https://github.com/langfuse/langfuse/blob/main/web/src/utils/numbers.ts))                                                                                                                                                     | Absolute timestamp column                                                                                                                          | Status hidden by default                                                                                                                                                                                                  |
| **Helicone**   | Created At, Status, Provider, Request, Response, Model, Total/Prompt/Completion Tokens, Latency, ..., Cost ([initialColumns.tsx](https://github.com/Helicone/helicone/blob/main/web/components/templates/requests/initialColumns.tsx))                                                    | `$` + 2–6 dp ([initialColumns.tsx](https://github.com/Helicone/helicone/blob/main/web/components/templates/requests/initialColumns.tsx))                                                                    | Raw integer, "not found" if NaN                                                                                                                                                     | Seconds: `ms/1000` + `s`                                                                                                                                                                                                                                                          | Absolute US date, 24 h time in a tooltip                                                                                                           | `StatusBadge`, `ModelPill`                                                                                                                                                                                                |
| **LangSmith**  | Exact default order **not confirmed**. Run fields include latency, first-token time, prompt/completion/total tokens and costs, feedback stats ([run format](https://docs.langchain.com/langsmith/run-data-format))                                                                        | **Not confirmed**                                                                                                                                                                                           | **Not confirmed**                                                                                                                                                                   | **Not confirmed**                                                                                                                                                                                                                                                                 | **Not confirmed**                                                                                                                                  | **Not confirmed**                                                                                                                                                                                                         |
| **Braintrust** | Logs table has an "Estimated cost" column ([KB](https://docs.braintrust.dev/kb/estimated-cost-missing-in-logs-table-with-project-level-providers.md)). Other columns **not confirmed**                                                                                                    | `–` when missing                                                                                                                                                                                            | **Not confirmed**                                                                                                                                                                   | **Not confirmed**                                                                                                                                                                                                                                                                 | **Not confirmed**                                                                                                                                  | **Not confirmed**                                                                                                                                                                                                         |

**Takeaways.**

- Numbers sit right-aligned in the order _latency, tokens, cost_, after the identifying columns.
- 4 decimal places under $1 is Phoenix's "precise" rule, chosen because the fractions of a cent are "the
  whole difference between the token types of one LLM call"
  ([numberFormatUtils.ts](https://github.com/Arize-ai/phoenix/blob/main/js/app/src/utils/numberFormatUtils.ts)).
  The draft's `$0.0123` matches. Add `<$0.0001` for tiny non-zero costs so they don't read as `$0.0000`.
- None of the four tools whose time column was checked uses relative time ("3 min ago") by default. For a
  prerendered page with no polling, relative time would also go stale.
- Model names appear as the raw model id, sometimes in a pill. No tool rewrites them into marketing names.

---

## 4. Unknown cost and missing scores

| Tool           | Unknown cost, per row                                                                                                                                                                                                                                                                                                                                                                                          | Unknown cost, in totals                                                                                                                                                                   | Missing score / value                                                                                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Langfuse**   | A warning badge labelled **"no cost"**. Its tooltip reads "No model price matched this generation…" ([ObservationMetadataBadgesTooltip.tsx](https://github.com/langfuse/langfuse/blob/main/web/src/features/traces/components/ObservationMetadataBadgesTooltip.tsx), [UsageCostWarningBadge.tsx](https://github.com/langfuse/langfuse/blob/main/web/src/features/traces/components/UsageCostWarningBadge.tsx)) | The model cost table shows `$0` for a missing sum ([ModelCostTableCard.tsx](https://github.com/langfuse/langfuse/blob/main/web/src/features/dashboard/components/ModelCostTableCard.tsx)) | Charts: missing averages are `null` and drawn as gaps, "never coerced to 0" ([chart-props.ts](https://github.com/langfuse/langfuse/blob/main/web/src/features/widgets/chart-library/chart-props.ts)) |
| **Helicone**   | **"Cost Unsupported"** pill, linking to docs ([costPill.tsx](https://github.com/Helicone/helicone/blob/main/web/components/templates/requests/costPill.tsx))                                                                                                                                                                                                                                                   | **Not confirmed**                                                                                                                                                                         | Tiles fall back to "n/a" ([dashboardPage.tsx](https://github.com/Helicone/helicone/blob/main/web/components/templates/dashboard/dashboardPage.tsx))                                                  |
| **Phoenix**    | `--` ([TracesTable.tsx](https://github.com/Arize-ai/phoenix/blob/main/js/app/src/pages/project/TracesTable.tsx))                                                                                                                                                                                                                                                                                               | Total treats missing as 0 (`?? 0`) ([ProjectStats.tsx](https://github.com/Arize-ai/phoenix/blob/main/js/app/src/pages/project/ProjectStats.tsx))                                          | `--` for any null number ([numberFormatUtils.ts](https://github.com/Arize-ai/phoenix/blob/main/js/app/src/utils/numberFormatUtils.ts))                                                               |
| **Braintrust** | `–` ([KB](https://docs.braintrust.dev/kb/estimated-cost-missing-in-logs-table-with-project-level-providers.md))                                                                                                                                                                                                                                                                                                | The cost preset drops spans with unknown models ([cost preset](https://docs.braintrust.dev/kb/total-llm-cost-preset-requirements.md))                                                     | **Not confirmed**                                                                                                                                                                                    |
| **Grafana**    | n/a                                                                                                                                                                                                                                                                                                                                                                                                            | n/a                                                                                                                                                                                       | "No value" option, default "-" ([stat](https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/stat/))                                                                          |

**Takeaways.**

- A _word_ ("no cost", "Cost Unsupported") beats a dash for a public audience and for tests: a dash is
  read inconsistently by screen readers and is hard to target in a test. The draft's "unknown" fits.
- Totals silently treat unknown as 0 in Phoenix and Langfuse. AInakupo's `unknownCostCount` is better:
  show it next to the known total so the total isn't mistaken for complete.
- For a missing average score, use a word too, such as "no scores". This follows Langfuse's rule that a
  missing average is never 0.

---

## 5. Empty and error states

- **Phoenix:** an empty traces table shows a graphic and "No traces found that match the selected filters"
  ([ProjectTableEmpty.tsx](https://github.com/Arize-ai/phoenix/blob/main/js/app/src/pages/project/ProjectTableEmpty.tsx)).
  Each stat is wrapped in an `ErrorBoundary` with a text fallback, so one failing metric doesn't blank the
  page ([ProjectStats.tsx](https://github.com/Arize-ai/phoenix/blob/main/js/app/src/pages/project/ProjectStats.tsx)).
- **Langfuse:** charts fall back to a "No data" card when there is nothing honest to draw
  ([InlineWidget.tsx](https://github.com/langfuse/langfuse/blob/main/web/src/features/widgets/components/InlineWidget.tsx),
  [ScoreAnalytics.tsx](https://github.com/langfuse/langfuse/blob/main/web/src/features/dashboard/components/score-analytics/ScoreAnalytics.tsx)).
- **Helicone:** a not-yet-onboarded org sees mock data plus a `DashboardEmptyState` overlay. The overlay
  text is **not confirmed**
  ([dashboardPage.tsx](https://github.com/Helicone/helicone/blob/main/web/components/templates/dashboard/dashboardPage.tsx)).
- **WAI-ARIA APG on alerts:** an alert is for "a brief, important message". Screen readers announce alerts
  that are added dynamically, but "do not inform users of alerts that are present on the page before page
  load completes". Alerts must not move focus or disappear on their own
  ([APG alert](https://www.w3.org/WAI/ARIA/apg/patterns/alert/)).
  - For a prerendered page, render the `role="alert"` element only after the fetch fails, never in the
    prerendered HTML.

**Takeaways.** Show one empty state for the whole page rather than one per table. Two copies of
"No traces yet" would also make `getByText` ambiguous. Keep the draft's error text.

---

## 6. Charts: common, and worth it?

- **Common:** every LLM tool's home page is mostly time series. Langfuse has "Traces & Observations over
  time" and "Model Usage" ([home-preset-registry.tsx](https://github.com/langfuse/langfuse/blob/main/web/src/features/dashboard/components/home-preset-registry.tsx)).
  Helicone puts a chart under each tile ([dashboardPage.tsx](https://github.com/Helicone/helicone/blob/main/web/components/templates/dashboard/dashboardPage.tsx)).
  LangSmith and Braintrust dashboards are all charts ([LangSmith](https://docs.langchain.com/langsmith/dashboards),
  [Braintrust](https://docs.braintrust.dev/guides/monitor)). Phoenix bundles `recharts` rather than
  loading a CDN ([package.json](https://github.com/Arize-ai/phoenix/blob/main/js/app/package.json)).
- **Cheap without a library:** a 14-bar chart is about 40 lines of React emitting `<svg><rect height=…>`.
  No chart lib is needed, so the CSP isn't a problem. Set geometry with SVG _attributes_, not `style=""`
  markup, because `default-src 'self'` also blocks inline style attributes in prerendered HTML.
- **Data needed:** nothing in today's API gives a time axis. `recent` has only 50 rows. Add per-day
  buckets for production traces, e.g. `daily: [{ date: "2026-11-19", traceCount, knownCostUsd }]` for the
  last 14 UTC days, oldest first, with **zero-filled** days. Langfuse fills missing count buckets with a
  real 0, because "zero events happened", but leaves averages as gaps
  ([chart-props.ts](https://github.com/langfuse/langfuse/blob/main/web/src/features/widgets/chart-library/chart-props.ts)).
- **Accessibility:** give the chart a short text alternative, plus a long one carrying the values and trend
  ([W3C complex images](https://www.w3.org/WAI/tutorials/images/complex/)). Bars need 3:1 contrast
  against the background, unless the same values are also given as text
  ([WCAG 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)).
  - For tests, `role="img"` with an exact `aria-label` is easy to pin. Don't add a hidden third
    `<table>`, which would compete with the two captioned tables.

**Verdict:** add it. It's the one thing that makes the page read as a "dashboard" in a portfolio, and it
costs one aggregate query. If the spec budget is tight, it's the first item to cut. Nothing else depends
on it.

---

## 7. Data table accessibility

- **The caption names the table.** HTML-AAM §4.1.11: if there's no `aria-label`/`aria-labelledby`, "use
  the subtree of the first such caption"
  ([HTML-AAM](https://www.w3.org/TR/html-aam-1.0/#table-element-accessible-name-computation)). So
  `getByRole('table', { name: 'Recent traces' })` works with a plain `<caption>`.
  - "A caption functions like a heading for a table" and should be short
    ([WAI tables: caption](https://www.w3.org/WAI/tutorials/tables/caption-summary/)).
- **Header cells:** use `<th scope="col">`. Without scope, "some screen readers may announce the wrong
  header" ([WAI tables: one header](https://www.w3.org/WAI/tutorials/tables/one-header/)). Native `<th>`
  maps to `columnheader`. APG strongly encourages the native `table` element over ARIA roles
  ([APG table](https://www.w3.org/WAI/ARIA/apg/patterns/table/)).
  - Optionally make the first cell of each row (Episode) a `<th scope="row">`. This gives a `rowheader`.
    If you do, pin it in the spec so tests query the right role.
- **Numeric alignment:** "When comparing columns of numbers, align the numbers to the right" (GOV.UK
  Design System, [table](https://design-system.service.gov.uk/components/table/)). Phoenix right-aligns
  latency, tokens and cost ([TracesTable.tsx](https://github.com/Arize-ai/phoenix/blob/main/js/app/src/pages/project/TracesTable.tsx)),
  and Langfuse right-aligns Tokens and USD ([ModelCostTableCard.tsx](https://github.com/langfuse/langfuse/blob/main/web/src/features/dashboard/components/ModelCostTableCard.tsx)).
  - Add `font-variant-numeric: tabular-nums` so digits line up. Phoenix uses monospace for the same effect.
- **Status must not rely on colour:** WCAG 1.4.1, "Color is not used as the only visual means of conveying
  information" ([understanding 1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)).
  Show the word "Error", not just a red dot. Phoenix's indicator carries a label even when hidden visually
  ([SpanStatusIndicator.tsx](https://github.com/Arize-ai/phoenix/blob/main/js/app/src/components/trace/SpanStatusIndicator.tsx)).
- **Narrow screens:** put the table in a wrapper with `overflow-x: auto` and `tabindex="0"` plus a label,
  so the page itself doesn't scroll sideways. The wrapper pattern is **not confirmed** against a W3C source.

---

## 8. Light and dark themes

- Langfuse shipped dark mode in 2024 ([changelog](https://langfuse.com/changelog/2024-05-23-dark-mode)) and
  depends on `next-themes` ([web/package.json](https://github.com/langfuse/langfuse/blob/main/web/package.json)).
  Whether it defaults to the OS setting is **not confirmed**.
- Phoenix has a light/dark/system toggle in its account menu
  ([release notes 07-2026](https://arize.com/docs/phoenix/release-notes/07-2026/07-07-2026-metric-charts-trace-search-and-rest-api)).
- Langfuse charts take a per-series colour as a `{ light, dark }` pair
  ([chart-props.ts](https://github.com/langfuse/langfuse/blob/main/web/src/features/widgets/chart-library/chart-props.ts)).
  Define chart colours as tokens per theme, not as one fixed hex.
- **Platform mechanism:** `prefers-color-scheme` detects the user's light/dark preference. `light` also
  covers "has not expressed an active preference"
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-color-scheme)).
  `color-scheme: light dark` on `:root` adapts scrollbars, form controls and the canvas. A
  `<meta name="color-scheme">` helps avoid a flash of the wrong scheme
  ([MDN color-scheme](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/color-scheme)).

**Takeaway:** for v1, follow the OS with CSS only. A toggle needs JS plus stored state, and it causes a
first-paint flash on a prerendered page. Check text contrast (4.5:1) and bar contrast (3:1) in both themes.

---

## 9. Recommended v1 page for AInakupo

Items marked **[CHANGE]** differ from the draft. Items marked **[ADD]** are new to it. Unmarked items keep the draft.

**Sections, in order**

1. **Header.** `<h1>` "AInakupo". **[ADD]** Under it, one line of text: "What the AI features in V1be
   Coding's live apps cost, how fast they answer and how well they score." Then a small muted line:
   "Production traces only · times in UTC".
2. **[ADD] Totals.** A `<section aria-labelledby>` with a visually hidden `<h2>` "Totals", holding a `<dl>`
   of 5 tiles. These are computed client-side from `/api/summary`, so **no API change** is needed:
   - "Traces": sum of `traceCount`, grouped (`1,234`).
   - "Tokens": sum of input + output tokens, grouped. Second line "1,000 in · 234 out".
   - "Known cost": sum of `knownCostUsd` as `$0.0123`. When the summed `unknownCostCount` > 0, a second
     line "+ 3 traces with unknown cost".
   - "Avg duration": `Σ(avgDurationMs × traceCount) / Σ traceCount`, as `1,234 ms`.
   - "Avg score": `Σ(avgScore × evaluationCount) / Σ evaluationCount`, 1 dp, shown "4.2 / 5". Shows "no
     scores" when there are no evaluations. Second line "from 12 evaluations".
   - Tile labels are `<dt>`, so they don't collide with column headers when tests use roles. Tests should
     scope text checks with `within(region)`, since "Traces" also appears elsewhere.
3. **[ADD, needs API] Chart.** `<figure>` with a visible `<figcaption>` "Traces per day (UTC), last 14 days"
   and an inline `<svg role="img" aria-label="Traces per day, last 14 days: 0 to 37, total 210">`. It has
   14 bars, a baseline, and first/last date labels.
   - **API change:** add `daily: [{ date: "YYYY-MM-DD", traceCount: number }]` (14 entries, oldest first,
     zero-filled, production only) to `GET /api/summary`. `knownCostUsd` per day is optional.
   - If cut from v1, drop this section only.
4. **Table "Sending episodes"**, with `<caption>` "Sending episodes". One row per episode, sorted by Traces
   descending **[ADD: pin the order]**. Numeric columns are right-aligned with tabular-nums.

   | Header text   | Cell format                                                          |
   | ------------- | -------------------------------------------------------------------- |
   | Episode       | episode slug as text (`<th scope="row">`, **[ADD]** pin `rowheader`) |
   | Traces        | `1,234`                                                              |
   | Input tokens  | `12,345` **[CHANGE: thousands separators]**                          |
   | Output tokens | `6,789` **[CHANGE]**                                                 |
   | Known cost    | `$0.0123`. `<$0.0001` if > 0 and < 0.0001 **[ADD]**                  |
   | Unknown cost  | count of traces with unknown cost, `0` if none **[ADD column]**      |
   | Avg duration  | `1,234 ms` **[CHANGE: separator]**                                   |
   | Evaluations   | `12`                                                                 |
   | Avg score     | `4.2` (1 dp) or `no scores` **[ADD: missing-score text]**            |

5. **Table "Recent traces"**, with `<caption>` "Recent traces", 50 newest, newest first.

   | Header text   | Cell format                                                                               |
   | ------------- | ----------------------------------------------------------------------------------------- |
   | Started (UTC) | `2026-11-19 14:03:07` in `<time datetime="2026-11-19T14:03:07Z">` **[ADD: exact format]** |
   | Episode       | slug                                                                                      |
   | Feature       | name                                                                                      |
   | Model         | raw model id in monospace, e.g. `claude-haiku-4-5`                                        |
   | Input tokens  | `1,234`                                                                                   |
   | Output tokens | `567`                                                                                     |
   | Duration      | `1,234 ms`                                                                                |
   | Cost          | `$0.0123`, or `unknown` (muted, not `$0`)                                                 |
   | Status        | badge with text `OK` or `Error` plus icon/colour **[CHANGE if draft shows `ok`/`error`]** |

6. **[ADD] Footer.** "Prompt and response text is never shown here." plus a link to the repo.

**States**

- **Loading [ADD]:** the prerendered HTML has a `role="status"` "Loading…" where the content goes. No
  tiles or tables are rendered while loading.
- **Empty:** when `/api/summary` returns no episodes, show one block, `<p>` "No traces yet", with a muted
  second line "Traces appear when a sending episode's live app calls a model."
  - **[CHANGE/clarify]** Tiles, chart and both tables are hidden, so the text appears once.
- **Error:** `role="alert"` "Couldn't load data. Try again later." is inserted only after either fetch
  fails, never prerendered. It replaces all data sections, and focus doesn't move.
- **No polling.** Data loads once.

**Theme and CSP.** Follow the OS (`prefers-color-scheme`, `color-scheme: light dark`, colour tokens on
`:root`), with no toggle. Use a system font stack, with no web fonts. All CSS goes in a bundled file, with
no inline `style=""` markup. The chart sets geometry through SVG attributes.

**Wireframe (desktop; tiles wrap to 2 columns and tables scroll inside their box on phones)**

```
+--------------------------------------------------------------------------------+
| AInakupo                                                                       |
| What the AI features in V1be Coding's live apps cost, how fast they answer ... |
| Production traces only · times in UTC                                          |
|                                                                                |
| +------------+ +-------------+ +--------------+ +-------------+ +------------+ |
| | Traces     | | Tokens      | | Known cost   | | Avg duration| | Avg score  | |
| | 1,234      | | 1,234,567   | | $3.4521      | | 1,234 ms    | | 4.2 / 5    | |
| |            | | in · out    | | + 3 unknown  | |             | | from 12    | |
| +------------+ +-------------+ +--------------+ +-------------+ +------------+ |
|                                                                                |
| Traces per day (UTC), last 14 days                                             |
|   ▂ ▃ ▁ ▅ ▇ ▃ ▂ ▁ ▄ ▆ █ ▅ ▃ ▄                                                  |
|   Nov 6                                                   Nov 19               |
|                                                                                |
| Sending episodes                                                               |
| Episode   Traces  Input tokens  Output tokens  Known cost  Unknown cost  ...   |
| doodlr       812       401,230         98,114     $2.1034             0  ...   |
| quizzly      422       201,001         40,220     $1.3487             3  ...   |
|              ... Avg duration  Evaluations  Avg score                          |
|              ...     1,210 ms           12        4.2                          |
|              ...       988 ms            0  no scores                          |
|                                                                                |
| Recent traces                                                                  |
| Started (UTC)        Episode  Feature  Model             In     Out  Duration  |
| 2026-11-19 14:03:07  doodlr   chat     claude-haiku-4-5  1,234  567  1,234 ms  |
|                                                    Cost: $0.0123  Status: OK   |
| 2026-11-19 13:58:41  quizzly  grade    some-other-model    880  120    912 ms  |
|                                                    Cost: unknown  Status: Error|
|                                                                                |
| Prompt and response text is never shown here. · Source on GitHub              |
+--------------------------------------------------------------------------------+
```

**For the spec / frozen tests.**

- Pin the exact header texts above, the tile labels, the chart's `aria-label` pattern, and the
  number formats: grouping, 4 dp cost, `<$0.0001`, `unknown`, `no scores`, `OK`/`Error`.
- Have tests scope text checks by table name (`getByRole('table', { name: 'Recent traces' })`) or by
  region, because "Traces" and "Avg duration" appear in both the tiles and the episode table.
