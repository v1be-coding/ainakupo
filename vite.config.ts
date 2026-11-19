import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// The built index.html carries the page shell and its loading status, so it
// shows with JavaScript off and before the bundle runs. The page is imported
// only when the hook runs: knip loads this config with a resolver that can't
// map the web code's .js imports to .tsx files.
const prerenderPage: Plugin = {
  name: "prerender-page",
  apply: "build",
  transformIndexHtml: {
    order: "pre",
    handler: async (html) => (await import("./src/web/prerender.js")).prerender(html),
  },
};

export default defineConfig({
  root: "src/web",
  plugins: [react(), prerenderPage],
  build: { outDir: "../../dist/web", emptyOutDir: true },
});
