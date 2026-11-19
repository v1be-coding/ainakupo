import { DataView } from "./DataView.js";
import type { PageState } from "./types.js";

const REPO_URL = "https://github.com/v1be-coding/ainakupo";

// The whole page for one state. Pure, so the build can prerender the loading
// state and the browser hydrates the same markup.
export function App({ state }: { state: PageState }) {
  return (
    <div className="page">
      <header className="page-header">
        <h1>AInakupo</h1>
        <p className="intro">
          What the AI features in V1be Coding&apos;s live apps cost, how fast they answer and how
          well.
        </p>
        <p className="scope">Production traces only · times in UTC</p>
      </header>
      <main className="content">
        <StateView state={state} />
      </main>
      <footer className="page-footer">
        <p>Prompt and response text is never shown here.</p>
        <p>
          <a href={REPO_URL}>Source on GitHub</a>
        </p>
      </footer>
    </div>
  );
}

function StateView({ state }: { state: PageState }) {
  switch (state.kind) {
    case "loading":
      return (
        <p className="notice" role="status">
          Loading…
        </p>
      );
    case "error":
      return (
        <p className="notice notice-error" role="alert">
          {state.message}
        </p>
      );
    case "empty":
      return (
        <div className="notice empty">
          <p className="empty-title">No traces yet</p>
          <p className="muted">
            Traces appear when a sending episode&apos;s live app calls a model.
          </p>
        </div>
      );
    case "data":
      return <DataView summary={state.summary} traces={state.traces} />;
  }
}
