import { DailyChart } from "./DailyChart.js";
import { Totals } from "./Totals.js";
import type { RecentTrace, Summary } from "./types.js";

export interface DataViewProps {
  summary: Summary;
  traces: RecentTrace[];
}

// The data state: Totals, the chart, then the Sending episodes and Recent
// traces tables, in that order (spec #4, Page › Data).
export function DataView({ summary, traces }: DataViewProps) {
  return (
    <div className="data" data-state="data">
      <Totals totals={summary.totals} />
      <DailyChart daily={summary.daily} />
      {/* The Sending episodes and Recent traces tables go here (ticket #18),
          replacing this placeholder line. */}
      <p className="muted">
        {summary.episodes.length} sending episodes, {traces.length} recent traces
      </p>
    </div>
  );
}
