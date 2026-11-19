import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chartName, formatCost, formatDuration, formatInteger, formatScore, formatStarted, formatStatus, last14UtcDates, startsWithValue } from "../format.ts";

describe("the dashboard's formats", () => {
  it("groups integers with commas", () => {
    assert.equal(formatInteger(12345), "12,345");
    assert.equal(formatInteger(0), "0");
  });

  it("writes durations in ms", () => {
    assert.equal(formatDuration(1234), "1,234 ms");
  });

  it("writes costs with 4 decimals, <$0.0001 and unknown", () => {
    assert.equal(formatCost(0.0123), "$0.0123");
    assert.equal(formatCost(1234.5678), "$1,234.5678");
    assert.equal(formatCost(0.00004), "<$0.0001");
    assert.equal(formatCost(0), "$0.0000");
    assert.equal(formatCost(null), "unknown");
  });

  it("writes scores with 1 decimal, out of 5 in the totals", () => {
    assert.equal(formatScore(4.2, true), "4.2 / 5");
    assert.equal(formatScore(4, false), "4.0");
    assert.equal(formatScore(null, true), "no scores");
    assert.equal(formatScore(null, false), "no scores");
  });

  it("writes start times and statuses", () => {
    assert.equal(formatStarted("2026-11-19T08:05:09.123Z"), "2026-11-19 08:05:09");
    assert.equal(formatStatus("ok"), "OK");
    assert.equal(formatStatus("error"), "Error");
  });
});

describe("startsWithValue", () => {
  it("matches a value and whatever line follows it", () => {
    assert.match("$0.0123+ 2 with unknown cost", startsWithValue("$0.0123"));
    assert.match(" 4.2 / 5from 3 evaluations", startsWithValue("4.2 / 5"));
    assert.match("<$0.0001", startsWithValue("<$0.0001"));
  });

  it("doesn't match a longer number", () => {
    assert.doesNotMatch("15", startsWithValue("5"));
    assert.doesNotMatch("5,000", startsWithValue("5"));
    assert.doesNotMatch("$0.01234", startsWithValue("$0.0123"));
  });
});

describe("the chart", () => {
  it("names the image from daily, counts unformatted", () => {
    const daily = [
      { date: "2026-11-06", traceCount: 0 },
      { date: "2026-11-07", traceCount: 1234 },
      { date: "2026-11-19", traceCount: 5 },
    ];
    assert.equal(chartName(daily), "Traces per day (UTC), last 14 days, from 2026-11-06 to 2026-11-19: 0, 1234, 5");
  });

  it("lists the 14 UTC dates ending today", () => {
    const dates = last14UtcDates(Date.parse("2026-03-01T23:59:59.000Z"));
    assert.equal(dates.length, 14);
    assert.equal(dates[0], "2026-02-16");
    assert.equal(dates[13], "2026-03-01");
  });
});
