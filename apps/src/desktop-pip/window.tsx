import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
// The moves the house added to Pip's library (the eyes that follow the
// pointer, the poke) and her own two. The app loads the first with the Pip
// tab; her window is its own page, so it loads them here.
import "../pip/house-moves.js";
import "./moves.js";
import "./desktop-pip.css";
import { DesktopPip } from "./DesktopPip";
import { tauriHost } from "./host";

/**
 * Desktop Pip's window: the entry of `desktop-pip.html`, a page of its own
 * beside the app's. It loads the sprite and nothing else of Leaflet: no
 * stores, no library, no stylesheet. Rust opens it only once the reader has
 * switched her on (src-tauri/src/desktop_pip/runtime.rs).
 */
const boot = async () => {
  const host = isTauri() ? tauriHost() : (await import("./standIn")).standInHost();
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <DesktopPip host={host} />
    </React.StrictMode>
  );
};

void boot();
