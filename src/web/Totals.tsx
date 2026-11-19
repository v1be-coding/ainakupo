import type { ReactNode } from "react";
import { formatCost, formatDuration, formatInteger, formatScore } from "./format.js";
import type { Summary } from "./types.js";

// The headline numbers (spec #4, Page › Data › Totals). A section named by its
// heading is a `Totals` region; the terms are <dt> so they don't collide with
// the tables' column headers.
export function Totals({ totals }: { totals: Summary["totals"] }) {
  return (
    <section className="totals" aria-labelledby="totals-heading">
      <h2 id="totals-heading" className="visually-hidden">
        Totals
      </h2>
      <dl className="tiles">
        <Tile term="Traces" value={formatInteger(totals.traceCount)} />
        <Tile term="Tokens" value={formatInteger(totals.inputTokens + totals.outputTokens)} />
        <Tile term="Known cost" value={formatCost(totals.knownCostUsd)}>
          {totals.unknownCostCount > 0 &&
            `+ ${formatInteger(totals.unknownCostCount)} with unknown cost`}
        </Tile>
        <Tile
          term="Avg duration"
          value={totals.avgDurationMs === null ? "n/a" : formatDuration(totals.avgDurationMs)}
        />
        <Tile
          term="Avg score"
          value={
            totals.avgScore === null ? formatScore(null) : `${formatScore(totals.avgScore)} / 5`
          }
        >
          {totals.evaluationCount > 0 &&
            `from ${formatInteger(totals.evaluationCount)} evaluations`}
        </Tile>
      </dl>
    </section>
  );
}

// The note goes inside the <dd>, after the value, so each term keeps exactly
// one definition.
function Tile({ term, value, children }: { term: string; value: string; children?: ReactNode }) {
  return (
    <div className="tile">
      <dt className="tile-term">{term}</dt>
      <dd className="tile-value">
        <span className="tile-number">{value}</span>
        {children ? <span className="tile-note">{children}</span> : null}
      </dd>
    </div>
  );
}
