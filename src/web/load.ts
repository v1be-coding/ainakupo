import { api, RateLimitedError } from "./api.js";
import type { PageState, RecentTrace, Summary } from "./types.js";

const GENERAL_ERROR = "Couldn't load data. Try again later.";

type FetchJson = <T>(path: string) => Promise<T>;

// Loads both routes once and settles on the state the page shows. A 429 on
// either fetch wins over any other failure, so a limited visitor learns when
// to come back instead of seeing a vague error.
export async function loadDashboard(fetchJson: FetchJson = api): Promise<PageState> {
  const [summary, recent] = await Promise.allSettled([
    fetchJson<Summary>("/api/summary"),
    fetchJson<{ traces: RecentTrace[] }>("/api/traces/recent"),
  ]);

  if (summary.status === "fulfilled" && recent.status === "fulfilled") {
    return summary.value.episodes.length === 0
      ? { kind: "empty" }
      : { kind: "data", summary: summary.value, traces: recent.value.traces };
  }

  const limited = [summary, recent]
    .map((result) => (result.status === "rejected" ? (result.reason as unknown) : undefined))
    .find((reason): reason is RateLimitedError => reason instanceof RateLimitedError);
  return {
    kind: "error",
    message: limited
      ? `Too many requests. Try again in ${limited.retryAfterSeconds} seconds.`
      : GENERAL_ERROR,
  };
}
