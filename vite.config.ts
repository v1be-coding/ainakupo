import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Each built page carries its markup, so it shows with JavaScript off and before
// the bundle runs. The page is imported only when the hook runs: knip loads this
// config with a resolver that can't map the web code's .js imports to .tsx files.
const prerenderPage: Plugin = {
  name: "prerender-page",
  apply: "build",
  transformIndexHtml: {
    order: "pre",
    handler: async (html, ctx) =>
      (await import("./src/web/prerender.js")).prerender(
        html,
        ctx.path === "/404.html" ? "not-found" : "dashboard",
      ),
  },
};

const page = (name: string) => fileURLToPath(new URL(`./src/web/${name}`, import.meta.url));

export default defineConfig({
  root: "src/web",
  plugins: [react(), prerenderPage],
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    // 404.html is what production's CloudFront serves for an unknown path.
    rollupOptions: { input: { index: page("index.html"), notFound: page("404.html") } },
  },
});
