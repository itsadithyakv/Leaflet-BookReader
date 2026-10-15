import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installAppGuards } from "./platform/desktop/appGuards";
import { diagnosticsService } from "./services/diagnosticsService";
import { startDesktopPip } from "./desktop-pip/sync";
import { installDeviceSignals } from "./platform/device";
// Android's Back, ready for the native side to call (`window.__leafletBack`).
import "./platform/back";
import "./platform/device.css";
import "./index.css";
// The app around the pages by a finger, on a phone or a tablet: after index.css, so it wins at equal weight.
import "./styles/touch-shell.css";

// Only the packaged app: `tauri dev` keeps F5 and the inspector, and a plain
// browser tab keeps its own behaviour.
if (import.meta.env.PROD && isTauri()) {
  installAppGuards();
}

// Which device, which input, which way up: attributes on <html> for the phone and tablet layouts.
installDeviceSignals();

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
