import type { RecentTrace, Summary } from "./types.js";

export interface DataViewProps {
  summary: Summary;
  traces: RecentTrace[];
}

// The data state: Totals, the chart, then the Sending episodes and Recent
// traces tables, in that order (spec #4, Page › Data). The page data tickets
// replace this placeholder; the shell only decides when it shows.
export function DataView({ summary, traces }: DataViewProps) {
  return (
    <div className="data" data-state="data">
      <p className="muted">
        {summary.episodes.length} sending episodes, {traces.length} recent traces
      </p>
    </div>
  );
}
