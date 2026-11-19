import { renderToString } from "react-dom/server";
import { App } from "./App.js";

const EMPTY_ROOT = '<div id="root"></div>';

// Run by the build (vite.config.ts): the served page shows the shell and the
// loading status before any script runs, and main.tsx hydrates that markup.
export function prerender(template: string): string {
  if (!template.includes(EMPTY_ROOT)) throw new Error(`index.html has no ${EMPTY_ROOT}`);
  const markup = renderToString(<App state={{ kind: "loading" }} />);
  return template.replace(EMPTY_ROOT, `<div id="root">${markup}</div>`);
}
