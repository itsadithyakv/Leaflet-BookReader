import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installAppGuards } from "./platform/desktop/appGuards";
import "./index.css";

// Only the packaged app: `tauri dev` keeps F5 and the inspector, and a plain
// browser tab keeps its own behaviour.
if (import.meta.env.PROD && isTauri()) {
  installAppGuards();
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
