import { renderToString } from "react-dom/server";
import { App, NotFound } from "./App.js";

const EMPTY_ROOT = '<div id="root"></div>';

export type Page = "dashboard" | "not-found";

// Run by the build (vite.config.ts): the dashboard shows the shell and the
// loading status before any script runs, and main.tsx hydrates that markup.
// The 404 page is complete as built and loads no script.
export function prerender(template: string, page: Page = "dashboard"): string {
  if (!template.includes(EMPTY_ROOT)) throw new Error(`the template has no ${EMPTY_ROOT}`);
  const markup = renderToString(
    page === "dashboard" ? <App state={{ kind: "loading" }} /> : <NotFound />,
  );
  return template.replace(EMPTY_ROOT, `<div id="root">${markup}</div>`);
}
