// A small Chrome DevTools Protocol client over a fresh headless Chrome (no puppeteer to install).
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Chrome, from CHROME_PATH or where it usually is. */
export const findChrome = (given) => {
  const candidates = [
    given,
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    path.join(os.homedir(), "AppData/Local/Google/Chrome/Application/chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error("No Chrome found. Set CHROME_PATH to a Chrome or Chromium executable.");
  }
  return found;
};

/** A neutral user agent for each shape: no real device, no real person. */
const AGENTS = {
  desktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  // "K" is Chrome's own reduced placeholder for the device model.
  phone: "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
};

/**
 * Starts Chrome headless with the GPU on (the app's look depends on it) and opens one page.
 * `shape`: { phone, width, height, scale }. `init`: scripts run in the page before the app.
 */
export async function launch({ chrome, shape, init = [] }) {
  const port = 9600 + Math.floor(Math.random() * 300);
  const profile = mkdtempSync(path.join(os.tmpdir(), "leaflet-perf-"));
  const flags = [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--mute-audio",
    `--window-size=${shape.width},${shape.height}`,
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--enable-gpu",
    "--ignore-gpu-blocklist",
    "--enable-gpu-rasterization",
    "--js-flags=--expose-gc"
  ];
  if (process.platform === "win32") flags.push("--use-angle=d3d11");
  const proc = spawn(chrome, [...flags, "about:blank"], { stdio: "ignore" });
  let targets = [];
  for (let i = 0; i < 120 && !targets.length; i++) {
    try {
      targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === "page");
    } catch {
      // Not listening yet.
    }
    if (!targets.length) await sleep(150);
  }
  if (!targets.length) {
    proc.kill();
    throw new Error("Chrome did not start.");
  }
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  let id = 0;
  const pending = new Map();
  const errors = [];
  const handlers = new Set();
  ws.addEventListener("message", (event) => {
    const m = JSON.parse(event.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
    if (m.method === "Runtime.exceptionThrown") {
      errors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || "").slice(0, 300));
    }
    for (const handler of handlers) handler(m);
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const n = ++id;
      pending.set(n, resolve);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const evaluate = async (expression, timeout = 60000) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout });
    if (r.result?.exceptionDetails) {
      throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
    }
    return r.result?.result?.value;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Performance.enable", { timeDomain: "timeTicks" });
  await send("Emulation.setUserAgentOverride", { userAgent: shape.phone ? AGENTS.phone : AGENTS.desktop });
  await send("Emulation.setDeviceMetricsOverride", {
    width: shape.width,
    height: shape.height,
    deviceScaleFactor: shape.scale ?? 1,
    mobile: Boolean(shape.phone)
  });
  if (shape.phone) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  for (const source of init) await send("Page.addScriptToEvaluateOnNewDocument", { source });
  const close = async () => {
    try {
      ws.close();
    } catch {}
    try {
      proc.kill();
    } catch {}
    await sleep(500);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // Chrome may still hold a file for a moment; the folder is in the temp dir.
    }
  };
  return { send, evaluate, errors, handlers, close };
}

export const readText = (file) => readFileSync(file, "utf8");
