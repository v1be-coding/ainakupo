import { describe, expect, it } from "vitest";
import {
  formatCost,
  formatDuration,
  formatInteger,
  formatScore,
  formatStarted,
  formatStatus,
} from "./format.js";

describe("formatInteger", () => {
  it.each([
    [0, "0"],
    [5, "5"],
    [12_345, "12,345"],
    [1_000_000, "1,000,000"],
  ])("writes %d as %s", (value, text) => {
    expect(formatInteger(value)).toBe(text);
  });
});

describe("formatDuration", () => {
  it.each([
    [7, "7 ms"],
    [1_234, "1,234 ms"],
    [61_000, "61,000 ms"],
  ])("writes %d as %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe("formatCost", () => {
  it.each([
    [0, "$0.0000"],
    [0.0123, "$0.0123"],
    [1_234.5678, "$1,234.5678"],
    [0.0001, "$0.0001"],
    [0.00004, "<$0.0001"],
    [0.000001, "<$0.0001"],
  ])("writes %d as %s", (usd, text) => {
    expect(formatCost(usd)).toBe(text);
  });

  it("writes unknown for a null cost", () => {
    expect(formatCost(null)).toBe("unknown");
  });
});

describe("formatScore", () => {
  it.each([
    [4.2, "4.2"],
    [5, "5.0"],
    [1, "1.0"],
  ])("writes %d as %s", (score, text) => {
    expect(formatScore(score)).toBe(text);
  });

  it("writes no scores for null", () => {
    expect(formatScore(null)).toBe("no scores");
  });
});

describe("formatStarted", () => {
  it.each([
    ["2026-11-19T14:03:07.000Z", "2026-11-19 14:03:07"],
    ["2026-01-02T03:04:05.999Z", "2026-01-02 03:04:05"],
    ["2026-11-19T23:30:00.000-02:00", "2026-11-20 01:30:00"],
  ])("writes %s as %s", (startedAt, text) => {
    expect(formatStarted(startedAt)).toBe(text);
  });

  it("shows text that isn't a date as is", () => {
    expect(formatStarted("not a date")).toBe("not a date");
  });
});

describe("formatStatus", () => {
  it("writes OK and Error", () => {
    expect(formatStatus("ok")).toBe("OK");
    expect(formatStatus("error")).toBe("Error");
  });
});
