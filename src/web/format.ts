// The page's number formats (spec #4, Page › Formats). en-US is fixed so the
// prerendered HTML and every visitor's browser write the same text.

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const fourDecimals = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});
const oneDecimal = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** `12,345` */
export function formatInteger(value: number): string {
  return integer.format(value);
}

/** `1,234 ms` */
export function formatDuration(ms: number): string {
  return `${integer.format(ms)} ms`;
}

/** `$0.0123`, `$1,234.5678`; `<$0.0001` for a cost above 0 that rounds to zero; `unknown` for `null`. */
export function formatCost(usd: number | null): string {
  if (usd === null) return "unknown";
  const text = `$${fourDecimals.format(usd)}`;
  return usd > 0 && text === "$0.0000" ? "<$0.0001" : text;
}

/** `4.2`, or `no scores` when nothing was evaluated. */
export function formatScore(score: number | null): string {
  return score === null ? "no scores" : oneDecimal.format(score);
}
