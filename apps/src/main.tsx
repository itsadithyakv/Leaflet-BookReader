import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installAppGuards } from "./platform/desktop/appGuards";
import { diagnosticsService } from "./services/diagnosticsService";
import { startDesktopPip } from "./desktop-pip/sync";
import "./index.css";

// Only the packaged app: `tauri dev` keeps F5 and the inspector, and a plain
// browser tab keeps its own behaviour.
if (import.meta.env.PROD && isTauri()) {
  installAppGuards();
}

// Errors in the interface go to the log file; the release build has no console.
diagnosticsService.install();

// Pip on the desktop: tells Rust whether the reader has switched her on.
startDesktopPip();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
