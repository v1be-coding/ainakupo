import type { ReactNode } from "react";
import {
  formatCost,
  formatDuration,
  formatInteger,
  formatScore,
  formatStarted,
  formatStatus,
} from "./format.js";
import type { RecentTrace, Summary } from "./types.js";

const EPISODE_HEADERS = [
  "Episode",
  "Traces",
  "Input tokens",
  "Output tokens",
  "Known cost",
  "Unknown cost",
  "Avg duration",
  "Evaluations",
  "Avg score",
] as const;

const RECENT_HEADERS = [
  "Started (UTC)",
  "Episode",
  "Feature",
  "Model",
  "Input tokens",
  "Output tokens",
  "Duration",
  "Cost",
  "Status",
] as const;

// Columns whose cells are numbers: right-aligned with tabular digits.
const EPISODE_NUMERIC = new Set<string>(EPISODE_HEADERS.slice(1));
const RECENT_NUMERIC = new Set<string>(["Input tokens", "Output tokens", "Duration", "Cost"]);

/** One row per sending episode, in API order (spec #4, Page › Data, item 3). */
export function EpisodesTable({ episodes }: { episodes: Summary["episodes"] }) {
  return (
    <ScrollTable
      id="episodes-caption"
      caption="Sending episodes"
      headers={EPISODE_HEADERS}
      numeric={EPISODE_NUMERIC}
    >
      {episodes.map((row) => (
        <tr key={row.episode}>
          <th scope="row">{row.episode}</th>
          <td className="num">{formatInteger(row.traceCount)}</td>
          <td className="num">{formatInteger(row.inputTokens)}</td>
          <td className="num">{formatInteger(row.outputTokens)}</td>
          <td className="num">{formatCost(row.knownCostUsd)}</td>
          <td className="num">{formatInteger(row.unknownCostCount)}</td>
          <td className="num">
            {row.avgDurationMs === null ? "n/a" : formatDuration(row.avgDurationMs)}
          </td>
          <td className="num">{formatInteger(row.evaluationCount)}</td>
          <td className="num">{formatScore(row.avgScore)}</td>
        </tr>
      ))}
    </ScrollTable>
  );
}

/** One row per recent production trace, in API order (spec #4, Page › Data, item 4). */
export function RecentTracesTable({ traces }: { traces: RecentTrace[] }) {
  return (
    <ScrollTable
      id="recent-caption"
      caption="Recent traces"
      headers={RECENT_HEADERS}
      numeric={RECENT_NUMERIC}
    >
      {traces.map((trace) => (
        <tr key={trace.id}>
          <td>
            <time dateTime={trace.startedAt}>{formatStarted(trace.startedAt)}</time>
          </td>
          <td>{trace.episode}</td>
          <td>{trace.feature}</td>
          <td className="mono">{trace.model}</td>
          <td className="num">{formatInteger(trace.inputTokens)}</td>
          <td className="num">{formatInteger(trace.outputTokens)}</td>
          <td className="num">{formatDuration(trace.durationMs)}</td>
          <td className={trace.costUsd === null ? "num muted" : "num"}>
            {formatCost(trace.costUsd)}
          </td>
          <td className={`status status-${trace.status}`}>{formatStatus(trace.status)}</td>
        </tr>
      ))}
    </ScrollTable>
  );
}

// The wrapper scrolls sideways on narrow screens so the page itself doesn't.
// It is focusable and named by the caption so keyboard users can scroll it.
function ScrollTable({
  id,
  caption,
  headers,
  numeric,
  children,
}: {
  id: string;
  caption: string;
  headers: readonly string[];
  numeric: ReadonlySet<string>;
  children: ReactNode;
}) {
  return (
    <div className="table-scroll" role="region" aria-labelledby={id} tabIndex={0}>
      <table className="data-table">
        <caption id={id}>{caption}</caption>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col" className={numeric.has(header) ? "num" : undefined}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
