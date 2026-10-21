import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installAppGuards } from "./platform/desktop/appGuards";
import { diagnosticsService } from "./services/diagnosticsService";
import { startDesktopPip } from "./desktop-pip/sync";
import { installDeviceSignals } from "./platform/device";
import { installPerfTier } from "./platform/perfTier";
import { installShellShape } from "./platform/shape";
import { installKeyboardFocus } from "./platform/keyboardFocus";
import { installWindowMaterial } from "./platform/desktop/windowMaterial";
// Android's Back, ready for the native side to call (`window.__leafletBack`).
import "./platform/back";
import "./platform/device.css";
import "./index.css";
// The app around the pages by a finger, on a phone or a tablet: after index.css, so it wins at equal weight.
import "./styles/touch-shell.css";
// The pages by a finger, calmer: flat keys, compact covers and tiles, room under the bar (after touch-shell).
import "./styles/phone-polish.css";
// Liquid glass, and the motion in and out of every floating surface (last, so it wins at equal weight).
import "./styles/glass.css";
// The desktop window's material (Mica on Windows 11): a see-through window, a vibrancy rail, Mac-like chrome.
import "./styles/window-material.css";
// The lighter visual effects (Smooth, minimal: `html[data-perf]`, platform/perfTier.ts), over all of the above.
import "./styles/perf.css";
import { installSurfaceMotion } from "./components/ui/motion";
import { installGlassRefraction } from "./components/ui/glassRefraction";

// Only the packaged app: `tauri dev` keeps F5 and the inspector, and a plain
// browser tab keeps its own behaviour.
if (import.meta.env.PROD && isTauri()) {
  installAppGuards();
}

// Which device, which input, which way up: attributes on <html> for the phone and tablet layouts.
installDeviceSignals();
// How much glass this device draws (full, Smooth, minimal): `html[data-perf]`, before anything draws it.
installPerfTier();
// The window's shape (upright, sideways, wide) as `html[data-shape]`: steady while a keyboard is up.
installShellShape();
// A phone's keyboard up: the field being typed in is scrolled into sight.
installKeyboardFocus();

// Mica or not, and the window's light or dark with the app's theme.
installWindowMaterial();

// Sheets, dialogs, menus and toasts leave as softly as they came.
installSurfaceMotion();

// Liquid glass bends what is behind it where the WebView can draw that (Chromium) and the effects are full:
// `html.glass-refracts`.
installGlassRefraction();

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
