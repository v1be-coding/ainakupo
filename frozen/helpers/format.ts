// The dashboard's formats (spec #4, Test contract inputs › Page › Formats), so a
// browser test can build the text it expects from the API's numbers.

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const fourDecimals = new Intl.NumberFormat("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const oneDecimal = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function formatInteger(value: number): string {
  return integer.format(value);
}

export function formatDuration(ms: number): string {
  return `${integer.format(ms)} ms`;
}

export function formatCost(usd: number | null): string {
  if (usd === null) return "unknown";
  const text = `$${fourDecimals.format(usd)}`;
  return usd > 0 && text === "$0.0000" ? "<$0.0001" : text;
}

// The Totals region writes `4.2 / 5`, the episodes table `4.2`.
export function formatScore(score: number | null, outOf: boolean): string {
  if (score === null) return "no scores";
  return outOf ? `${oneDecimal.format(score)} / 5` : oneDecimal.format(score);
}

// `Started (UTC)`: `YYYY-MM-DD HH:MM:SS` from an ISO timestamp.
export function formatStarted(startedAt: string): string {
  return `${startedAt.slice(0, 10)} ${startedAt.slice(11, 19)}`;
}

export function formatStatus(status: "ok" | "error"): string {
  return status === "ok" ? "OK" : "Error";
}

// Matches text that starts with `value` and doesn't go on with more of a number,
// so `5` doesn't match `15` or `5,000`, and a line after the value is allowed.
export function startsWithValue(value: string): RegExp {
  return new RegExp(`^\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\d,.])`);
}

export const CHART_CAPTION = "Traces per day (UTC), last 14 days";

export function chartName(daily: readonly { date: string; traceCount: number }[]): string {
  const first = daily[0]?.date ?? "";
  const last = daily.at(-1)?.date ?? "";
  return `${CHART_CAPTION}, from ${first} to ${last}: ${daily.map((day) => day.traceCount).join(", ")}`;
}

// The 14 UTC dates ending on `now`'s, oldest first.
export function last14UtcDates(now: number): string[] {
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  return Array.from({ length: 14 }, (_, i) => new Date(today - (13 - i) * 86_400_000).toISOString().slice(0, 10));
}
