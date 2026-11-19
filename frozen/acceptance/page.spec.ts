import { newTrace, nowToTheSecond, TEST_EPISODE, type RecentTrace, type Summary } from "../helpers/ainakupo.js";
import { expect, test } from "../helpers/fixtures.js";
import {
  CHART_CAPTION,
  chartName,
  formatCost,
  formatDuration,
  formatInteger,
  formatScore,
  formatStarted,
  last14UtcDates,
  startsWithValue,
} from "../helpers/format.js";

// Spec #4: the dashboard at /. Each title starts with the test contract lines
// (in the spec issue) that it checks. Tests of the data states use the real
// backend; only the empty and error states fake the API with page.route.

const SUMMARY = /\/api\/summary(\?.*)?$/;
const RECENT = /\/api\/traces\/recent(\?.*)?$/;
const GENERAL_ERROR = "Couldn't load data. Try again later.";
const SENDING_EPISODES_HEADERS = ["Episode", "Traces", "Input tokens", "Output tokens", "Known cost", "Unknown cost", "Avg duration", "Evaluations", "Avg score"];
const RECENT_HEADERS = ["Started (UTC)", "Episode", "Feature", "Model", "Input tokens", "Output tokens", "Duration", "Cost", "Status"];
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => ({ status, headers, contentType: "application/json", body: JSON.stringify(body) });

test("C22: the page always shows its title, heading, intro, scope line and footer", { tag: ["@C22"] }, async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("AInakupo");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("AInakupo");
  await expect(page.getByText("What the AI features in V1be Coding's live apps cost, how fast they answer and how well.")).toBeVisible();
  await expect(page.getByText("Production traces only · times in UTC")).toBeVisible();
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByText("Prompt and response text is never shown here.")).toBeVisible();
  await expect(footer.getByRole("link", { name: "Source on GitHub" })).toHaveAttribute("href", "https://github.com/v1be-coding/ainakupo");
});

test.describe("the prerendered page", () => {
  test.use({ javaScriptEnabled: false });

  test("C23, C29: the prerendered HTML shows the loading status and no alert", { tag: ["@C23", "@C29"] }, async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("status")).toHaveText("Loading…");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("AInakupo");
  });
});

test("C24, C30: the Totals region shows the summary's totals, and the page loads each route once", { tag: ["@C24", "@C30"] }, async ({ page, keyed, request }) => {
  // A production trace with no cost, so the unknown-cost line shows.
  expect((await keyed.post("/api/traces", { key: "production", json: newTrace({ costUsd: null }) })).status).toBe(201);
  const apiPaths: string[] = [];
  page.on("request", (sent) => {
    apiPaths.push(new URL(sent.url()).pathname);
  });

  await page.goto("/");
  const totals = page.getByRole("region", { name: "Totals" });
  await expect(totals).toBeVisible();
  const { totals: t } = (await (await request.get("/api/summary")).json()) as Summary;

  await expect(totals.getByRole("term")).toHaveText(["Traces", "Tokens", "Known cost", "Avg duration", "Avg score"]);
  await expect(totals.getByRole("definition")).toHaveText([
    startsWithValue(formatInteger(t.traceCount)),
    startsWithValue(formatInteger(t.inputTokens + t.outputTokens)),
    startsWithValue(formatCost(t.knownCostUsd)),
    startsWithValue(formatDuration(t.avgDurationMs ?? Number.NaN)),
    startsWithValue(formatScore(t.avgScore, true)),
  ]);
  await expect(totals.getByText(`+ ${formatInteger(t.unknownCostCount)} with unknown cost`)).toBeVisible();
  await expect(totals.getByText(`from ${formatInteger(t.evaluationCount)} evaluations`)).toHaveCount(Math.min(1, t.evaluationCount));
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("No traces yet")).toHaveCount(0);

  // No polling: nothing more is requested in the next 5 seconds.
  await page.waitForTimeout(5_000);
  expect(apiPaths.filter((path) => path === "/api/summary")).toEqual(["/api/summary"]);
  expect(apiPaths.filter((path) => path === "/api/traces/recent")).toEqual(["/api/traces/recent"]);
});

test("C25: the chart is a captioned figure whose image is named with the 14 days' counts", { tag: ["@C25"] }, async ({ page, keyed, request }) => {
  expect((await keyed.post("/api/traces", { key: "production", json: newTrace() })).status).toBe(201);

  await page.goto("/");
  const figure = page.getByRole("figure", { name: CHART_CAPTION });
  await expect(figure).toBeVisible();
  const { daily } = (await (await request.get("/api/summary")).json()) as Summary;

  await expect(figure.getByText(CHART_CAPTION, { exact: true })).toBeVisible();
  await expect(figure.getByRole("img", { name: chartName(daily), exact: true })).toBeVisible();
  expect(daily.map((day) => day.date)).toEqual(last14UtcDates(Date.now()));
});

test("C26: the Sending episodes table shows test-episode's row from the summary", { tag: ["@C26"] }, async ({ page, keyed, request }) => {
  expect((await keyed.post("/api/traces", { key: "production", json: newTrace() })).status).toBe(201);

  await page.goto("/");
  const table = page.getByRole("table", { name: "Sending episodes" });
  await expect(table).toBeVisible();
  const { episodes } = (await (await request.get("/api/summary")).json()) as Summary;
  const [row] = episodes;

  await expect(table.getByRole("columnheader")).toHaveText(SENDING_EPISODES_HEADERS);
  await expect(table.getByRole("rowheader")).toHaveText(episodes.map((episode) => episode.episode));
  const episodeRow = table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: TEST_EPISODE, exact: true }) });
  await expect(episodeRow.getByRole("cell")).toHaveText([
    formatInteger(row?.traceCount ?? Number.NaN),
    formatInteger(row?.inputTokens ?? Number.NaN),
    formatInteger(row?.outputTokens ?? Number.NaN),
    formatCost(row?.knownCostUsd ?? Number.NaN),
    formatInteger(row?.unknownCostCount ?? Number.NaN),
    formatDuration(row?.avgDurationMs ?? Number.NaN),
    formatInteger(row?.evaluationCount ?? Number.NaN),
    formatScore(row?.avgScore ?? null, false),
  ]);
});

test("C27: the Recent traces table shows each trace in API order, formatted", { tag: ["@C27"] }, async ({ page, keyed, request }) => {
  const startedAt = nowToTheSecond();
  const priced = newTrace({ startedAt, inputTokens: 12_345, outputTokens: 678, durationMs: 1_234, costUsd: 0.0123, status: "ok" });
  const tiny = newTrace({ startedAt, inputTokens: 5, outputTokens: 0, durationMs: 7, costUsd: 0.00004, status: "error" });
  const unpriced = newTrace({ startedAt, provider: "openai", model: "gpt-test", inputTokens: 1_000_000, outputTokens: 2_500, durationMs: 61_000, costUsd: null });
  for (const trace of [priced, tiny, unpriced]) {
    expect((await keyed.post("/api/traces", { key: "production", json: trace })).status).toBe(201);
  }

  await page.goto("/");
  const table = page.getByRole("table", { name: "Recent traces" });
  await expect(table).toBeVisible();
  const { traces } = (await (await request.get("/api/traces/recent")).json()) as { traces: RecentTrace[] };

  await expect(table.getByRole("columnheader")).toHaveText(RECENT_HEADERS);
  const started = formatStarted(startedAt);
  const rowOf = (trace: Record<string, unknown>) => table.getByRole("row").filter({ hasText: String(trace.feature) });
  await expect(rowOf(priced).getByRole("cell")).toHaveText([started, TEST_EPISODE, String(priced.feature), "claude-haiku-5-5", "12,345", "678", "1,234 ms", "$0.0123", "OK"]);
  await expect(rowOf(tiny).getByRole("cell")).toHaveText([started, TEST_EPISODE, String(tiny.feature), "claude-haiku-5-5", "5", "0", "7 ms", "<$0.0001", "Error"]);
  await expect(rowOf(unpriced).getByRole("cell")).toHaveText([started, TEST_EPISODE, String(unpriced.feature), "gpt-test", "1,000,000", "2,500", "61,000 ms", "unknown", "OK"]);
  // One row per trace, in the API's order.
  await expect(table.getByRole("row").filter({ has: page.getByRole("cell") })).toHaveText(traces.map((trace) => new RegExp(trace.feature)));
});

test("C28: with no episodes, the page shows the empty text and no data", { tag: ["@C28"] }, async ({ page }) => {
  const zero = { traceCount: 0, inputTokens: 0, outputTokens: 0, knownCostUsd: 0, unknownCostCount: 0, avgDurationMs: null, evaluationCount: 0, avgScore: null };
  const daily = last14UtcDates(Date.now()).map((date) => ({ date, traceCount: 0 }));
  await page.route(SUMMARY, (route) => route.fulfill(json({ totals: zero, episodes: [], daily })));
  await page.route(RECENT, (route) => route.fulfill(json({ traces: [] })));

  await page.goto("/");

  await expect(page.getByText("No traces yet")).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Totals" })).toHaveCount(0);
  await expect(page.getByRole("figure")).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("C29: an aborted summary fetch shows the general error alone", { tag: ["@C29"] }, async ({ page }) => {
  await page.route(SUMMARY, (route) => route.abort("failed"));

  await page.goto("/");

  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveText(GENERAL_ERROR);
  await expect(page.getByRole("region", { name: "Totals" })).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByRole("figure")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByText("No traces yet")).toHaveCount(0);
});

test("C29: a 500 from the recent traces fetch shows the general error alone", { tag: ["@C29"] }, async ({ page }) => {
  await page.route(RECENT, (route) => route.fulfill(json({ error: "internal", message: "Internal error" }, 500)));

  await page.goto("/");

  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveText(GENERAL_ERROR);
  await expect(page.getByRole("region", { name: "Totals" })).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveCount(0);
});

test.describe("a rate-limited fetch", () => {
  // The 429s here are stand-ins from page.route, not real ones.
  test.use({ allow429: true });
  const limited = (seconds: string) => json({ error: "rate_limited", message: "Too many requests", retryAfterSeconds: Number(seconds) }, 429, { "retry-after": seconds });

  test("C29: a 429 on the summary shows the limit text with its retry-after", { tag: ["@C29"] }, async ({ page }) => {
    await page.route(SUMMARY, (route) => route.fulfill(limited("30")));

    await page.goto("/");

    await expect(page.getByRole("alert")).toHaveCount(1);
    await expect(page.getByRole("alert")).toHaveText("Too many requests. Try again in 30 seconds.");
    await expect(page.getByRole("region", { name: "Totals" })).toHaveCount(0);
    await expect(page.getByRole("table")).toHaveCount(0);
  });

  test("C29: a 429 on one fetch and a 500 on the other shows the limit text", { tag: ["@C29"] }, async ({ page }) => {
    await page.route(SUMMARY, (route) => route.fulfill(json({ error: "internal", message: "Internal error" }, 500)));
    await page.route(RECENT, (route) => route.fulfill(limited("17")));

    await page.goto("/");

    await expect(page.getByRole("alert")).toHaveCount(1);
    await expect(page.getByRole("alert")).toHaveText("Too many requests. Try again in 17 seconds.");
  });

  test("C29: a 429 on one fetch and an aborted other shows the limit text", { tag: ["@C29"] }, async ({ page }) => {
    await page.route(SUMMARY, (route) => route.fulfill(limited("12")));
    await page.route(RECENT, (route) => route.abort("failed"));

    await page.goto("/");

    await expect(page.getByRole("alert")).toHaveCount(1);
    await expect(page.getByRole("alert")).toHaveText("Too many requests. Try again in 12 seconds.");
  });
});
