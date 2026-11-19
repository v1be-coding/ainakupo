import { StrictMode, useEffect, useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { App } from "./App.js";
import { loadDashboard } from "./load.js";
import type { PageState } from "./types.js";
import "./styles.css";

// Starts in the prerendered loading state and loads once: no polling.
function Dashboard() {
  const [state, setState] = useState<PageState>({ kind: "loading" });

  useEffect(() => {
    let current = true;
    void loadDashboard().then((next) => {
      if (current) setState(next);
    });
    return () => {
      current = false;
    };
  }, []);

  return <App state={state} />;
}

hydrateRoot(
  document.getElementById("root")!,
  <StrictMode>
    <Dashboard />
  </StrictMode>,
);
