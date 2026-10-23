#!/usr/bin/env node
// Leaflet's performance check (`npm run perf` in apps/): builds the app for production, serves it,
// drives headless Chrome (GPU on) through the flows that have to feel fast, and compares what it
// measured with the budgets in scripts/perf/budgets.json. Tauri's IPC is stood in for by mock.js,
// with a made-up library of 300 books and a made-up book (fixtures.mjs): no real data is used.
//
//   node scripts/perf/perf.mjs                    build, measure every shape and speed, check the budgets
//   --no-build                                    measure the last build (node_modules/.perf/dist)
//   --dist <dir>                                  measure another build
//   --configs desktop-1x,phone-4x                 only these (shape-speed)
//   --flows start,scroll,tabs                     only these flows
//   --runs 3                                      runs of each config; the median is kept (default 1)
//   --update                                      write today's numbers plus a margin as the budgets
//   --json <file>                                 also write the numbers measured
//   --budgets-from <file>                         write the budgets from a --json file (no measuring), and stop
//   --compare <before.json> <after.json>          a before-and-after table of two --json files, and stop
//   --shots <dir>                                 screenshots at each step, for a flow that does not find its way
//
// It is slow (a few minutes): not part of `npm test`. See docs/testing.md.
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureFixtures } from "./fixtures.mjs";
import { findChrome, launch, readText, sleep } from "./chrome.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../..");
const workDir = path.join(appDir, "node_modules", ".perf");
const budgetsFile = path.join(here, "budgets.json");

// ---- Options -------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};

const SHAPES = {
  desktop: { width: 1280, height: 800, scale: 1, phone: false },
  phone: { width: 393, height: 852, scale: 2.75, phone: true }
};
const ALL_CONFIGS = ["desktop-1x", "desktop-4x", "phone-1x", "phone-4x"];
const ALL_FLOWS = ["start", "scroll", "tabs", "sheets", "pip", "hollow", "reader"];

/** What each number is, its unit, and how much room a budget gives it over today's (see --update). */
const METRICS = {
  startUsableMs: ["Start to library usable (first cards drawn)", "ms"],
  startCoversMs: ["Start to the first screen of covers shown", "ms"],
  startLongTaskMs: ["Long tasks before library usable (total)", "ms"],
  startLongestTaskMs: ["Longest task before library usable", "ms"],
  startJsKB: ["JavaScript loaded before library usable", "KB"],
  startLongTaskMs5s: ["Long tasks in the first 5 s (total)", "ms"],
  scrollJankPct: ["Library fling: frames over 20 ms", "%"],
  scrollP95Ms: ["Library fling: 95th percentile frame", "ms"],
  tabToLibraryMs: ["Tab switch back to Library (median)", "ms"],
  tabAwayMs: ["Tab switch away from Library (worst, warm)", "ms"],
  heapLibraryMB: ["JS heap on Library after tab switches", "MB"],
  heapOtherTabMB: ["JS heap on another tab", "MB"],
  nodesOtherTab: ["DOM nodes on another tab", "nodes"],
  settingsOpenMs: ["Settings open (median)", "ms"],
  profileOpenMs: ["Profile sheet open (median)", "ms"],
  bookMenuOpenMs: ["Book menu open (median)", "ms"],
  pipThrowJankPct: ["Pip throw: frames over 20 ms", "%"],
  pipThrowP95Ms: ["Pip throw: 95th percentile frame", "ms"],
  hollowBusyMsPerS: ["Hollow idle: main thread busy per second", "ms"],
  hollowJankPct: ["Hollow idle: frames over 20 ms", "%"],
  openFirstTextMs: ["Open a book to first text", "ms"],
  smartJankPct: ["Smart Read: frames over 20 ms", "%"],
  autoJankPct: ["Auto-scroll: frames over 20 ms", "%"]
};
/** Cold starts measured in each run (the start numbers are their median). */
const START_LOADS = 3;
const MARGIN ={ ms: [1.3, 25], KB: [1.1, 30], "%": [1.5, 4], MB: [1.25, 2], nodes: [1.2, 200] };

// ---- Comparing two runs --------------------------------------------------------------------------
if (flag("--compare")) {
  const at = argv.indexOf("--compare");
  const [a, b] = [argv[at + 1], argv[at + 2]].map((file) => JSON.parse(readFileSync(file, "utf8")));
  for (const config of Object.keys(b)) {
    if (!a[config]) continue;
    console.log(`\n#### ${config}\n`);
    console.log("| | Before | After | Change |");
    console.log("|---|---:|---:|---:|");
    for (const [key, [label, unit]] of Object.entries(METRICS)) {
      const x = a[config][key];
      const y = b[config][key];
      if (x == null && y == null) continue;
      const change = x != null && y != null && x !== 0 ? `${y < x ? "" : "+"}${Math.round(((y - x) / x) * 100)}%` : "";
      console.log(`| ${label} (${unit}) | ${x ?? "n/a"} | ${y ?? "n/a"} | ${change} |`);
    }
  }
  process.exit(0);
}

// ---- Budgets: today's numbers plus a margin ------------------------------------------------------
const readBudgets = () => (existsSync(budgetsFile) ? JSON.parse(readFileSync(budgetsFile, "utf8")) : { configs: {} });
const writeBudgets = (results) => {
  const budgets = readBudgets();
  budgets.note =
    "Written by `npm run perf -- --runs 3 --update` (or --budgets-from): the median of three runs plus a margin (MARGIN in perf.mjs). Lower is better for every number.";
  for (const [config, values] of Object.entries(results)) {
    budgets.configs[config] = budgets.configs[config] || {};
    for (const [key, value] of Object.entries(values)) {
      if (!METRICS[key]) continue;
      const [factor, slack] = MARGIN[METRICS[key][1]];
      budgets.configs[config][key] = Math.ceil(value * factor + slack);
    }
  }
  budgets.updated = new Date().toISOString().slice(0, 10);
  writeFileSync(budgetsFile, JSON.stringify(budgets, null, 2) + "\n");
  console.log(`Budgets written to ${path.relative(appDir, budgetsFile)}.`);
  return budgets;
};
if (flag("--budgets-from")) {
  writeBudgets(JSON.parse(readFileSync(option("--budgets-from"), "utf8")));
  process.exit(0);
}

const configs = option("--configs", ALL_CONFIGS.join(",")).split(",");
const flows = option("--flows", ALL_FLOWS.join(",")).split(",");
const runs = Number(option("--runs", "1"));
const chrome = findChrome(option("--chrome"));

// ---- Build, fixtures and a server ----------------------------------------------------------------
let dist = option("--dist") ? path.resolve(option("--dist")) : path.join(workDir, "dist");
if (!option("--dist") && !flag("--no-build")) {
  console.log("Building for production…");
  execFileSync(process.execPath, [path.join(appDir, "node_modules/vite/bin/vite.js"), "build", "--outDir", dist, "--emptyOutDir", "--logLevel", "warn"], {
    cwd: appDir,
    stdio: "inherit"
  });
}
if (!existsSync(path.join(dist, "index.html"))) {
  console.error(`No build at ${dist}. Run without --no-build first.`);
  process.exit(2);
}
mkdirSync(workDir, { recursive: true });
const fixtures = ensureFixtures(path.join(workDir, "fixtures"));

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png",
  ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff",
  ".ttf": "font/ttf", ".json": "application/json", ".epub": "application/epub+zip", ".mp3": "audio/mpeg", ".ogg": "audio/ogg",
  ".wasm": "application/wasm", ".gif": "image/gif"
};
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  let file;
  const cover = /^\/perf-cover\/.*?b(\d+)/.exec(decodeURIComponent(url.pathname));
  if (cover) {
    const w = Number(url.searchParams.get("w")) || 0;
    file = path.join(fixtures, "covers", w && w <= 240 ? "t240" : w && w <= 480 ? "t480" : "full", `${Number(cover[1]) % 60}.png`);
  } else if (url.pathname === "/perf-book.epub") {
    file = path.join(fixtures, "book.epub");
  } else {
    file = path.join(dist, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
    if (!file.startsWith(dist)) {
      res.statusCode = 403;
      return res.end();
    }
  }
  try {
    if (statSync(file).isDirectory()) file = path.join(file, "index.html");
    const body = readFileSync(file);
    res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
    res.setHeader("Cache-Control", file.endsWith("index.html") ? "no-cache" : "max-age=3600");
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// ---- In the page: long tasks, interactions, frames, and when the library is usable -----------------
const INSTRUMENTS = `(() => {
  const m = window.__perf = { long: [], events: [], frames: [], on: false, last: 0, usable: null, covers: null };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) m.long.push([e.startTime, e.duration]); }).observe({ type: "longtask", buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) m.events.push([e.name, e.startTime, e.duration]); }).observe({ type: "event", durationThreshold: 16, buffered: true }); } catch {}
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight; };
  const tick = (t) => {
    if (m.on && m.last) m.frames.push(t - m.last);
    m.last = t;
    if (!m.usable && [...document.querySelectorAll(".book-card")].some(visible)) m.usable = t;
    if (m.usable && !m.covers) {
      const imgs = [...document.querySelectorAll(".book-card img")].filter(visible);
      if (imgs.length && imgs.every((i) => i.complete && i.naturalWidth > 0)) m.covers = t;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

const median = (values) => {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};
const round = (x, digits = 0) => (x == null ? null : Math.round(x * 10 ** digits) / 10 ** digits);

async function measureConfig(config) {
  const [shapeName, speed] = config.split("-");
  const shape = SHAPES[shapeName];
  const rate = Number(speed.replace("x", ""));
  const page = await launch({
    chrome,
    shape,
    init: [`window.__PERF = ${JSON.stringify({ books: 300, material: "none" })};\n` + readText(path.join(here, "mock.js")), INSTRUMENTS]
  });
  const { send, evaluate } = page;
  const out = {};
  const log = [];
  const metrics = async () => {
    const r = await send("Performance.getMetrics");
    return Object.fromEntries(r.result.metrics.map((x) => [x.name, x.value]));
  };
  const throttle = (r) => send("Emulation.setCPUThrottlingRate", { rate: r });
  const now = () => evaluate("performance.now()");
  const center = (selector) =>
    evaluate(`(() => { const el = ${selector}; if (!el) return null; const r = el.getBoundingClientRect();
      if (r.width === 0) return null; return [r.left + r.width / 2, r.top + Math.min(r.height / 2, 40)]; })()`);
  const click = async (selector) => {
    const at = await center(selector);
    if (!at) return false;
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at[0], y: at[1] });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: at[0], y: at[1], button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at[0], y: at[1], button: "left", clickCount: 1 });
    return true;
  };
  const key = async (k, code, vk) => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
  };
  const escape = () => key("Escape", "Escape", 27);
  const navButton = (label) =>
    `[...document.querySelectorAll(".leaflet-sidebar button, .mobile-nav button")].find((b) => { const r = b.getBoundingClientRect();
      return r.width > 0 && (b.querySelector(".sidebar-copy, .mobile-nav-label")?.textContent || b.textContent || "").trim().toLowerCase().startsWith(${JSON.stringify(label.toLowerCase())}); })`;
  const nav = (label) => click(navButton(label));
  /** The longest interaction (input to the next paint) that began after `since`. */
  const interaction = async (since) =>
    evaluate(`Math.max(0, ...window.__perf.events.filter((e) => e[1] >= ${since}).map((e) => e[2]))`);
  const framesOn = () => evaluate(`(() => { const m = window.__perf; m.on = true; m.frames = []; m.last = 0; m.mark = performance.now(); return 1; })()`);
  const framesOff = async () => {
    const d = await evaluate(`(() => { const m = window.__perf; m.on = false; return { frames: m.frames.slice(), long: m.long.filter(([s]) => s >= m.mark), span: performance.now() - m.mark }; })()`);
    const sorted = [...d.frames].sort((a, b) => a - b);
    return {
      jank: d.frames.length ? (100 * d.frames.filter((x) => x > 20).length) / d.frames.length : null,
      p95: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))] : null,
      longMs: d.long.reduce((a, [, x]) => a + x, 0),
      span: d.span
    };
  };
  const heap = async () => {
    await send("HeapProfiler.collectGarbage");
    await sleep(300);
    const m = await metrics();
    return { heapMB: m.JSHeapUsedSize / 1048576, nodes: m.Nodes };
  };
  const shots = option("--shots");
  let shotCount = 0;
  const shot = async (name) => {
    if (!shots) return;
    mkdirSync(shots, { recursive: true });
    const r = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(shots, `${config}-${String(++shotCount).padStart(2, "0")}-${name}.png`), Buffer.from(r.result.data, "base64"));
  };
  const toTop = () => evaluate(`(() => { const s = document.querySelector(".app-main-scroll"); if (s) s.scrollTop = 0; return 1; })()`);

  try {
    if (rate > 1) await throttle(rate);
    // ---- Start to library usable ----
    // Three starts, the first with nothing cached: one start's time varies by half again from run to
    // run (where the first frames fall), so each number is the median of the three.
    const starts = [];
    for (let load = 0; load < START_LOADS; load++) {
      // Each start from nothing: no page, nothing in the caches.
      await send("Page.navigate", { url: "about:blank" });
      await sleep(300);
      await send("Network.clearBrowserCache");
      await send("Page.navigate", { url: `${origin}/` });
      for (let i = 0; i < 300; i++) {
        await sleep(100);
        const ready = await evaluate("!!(window.__perf && window.__perf.covers)").catch(() => false);
        if (ready) break;
      }
      await sleep(5500);
      starts.push(
        await evaluate(`(() => { const m = window.__perf; const usable = m.usable || 1e9;
          const js = performance.getEntriesByType("resource").filter((r) => /\\.m?js(\\?|$)/.test(r.name) && r.startTime < usable);
          const before = m.long.filter(([s]) => s < usable);
          return { usable: m.usable, covers: m.covers, jsKB: js.reduce((a, r) => a + r.decodedBodySize, 0) / 1024,
            longMs: before.reduce((a, [, d]) => a + d, 0), longest: Math.max(0, ...before.map(([, d]) => d)),
            long5s: m.long.filter(([s]) => s < 5000).reduce((a, [, d]) => a + d, 0) }; })()`)
      );
    }
    const start = Object.fromEntries(Object.keys(starts[0]).map((key) => [key, median(starts.map((s) => s[key]))]));
    // What was loaded is the first start's (nothing cached), not the median's.
    start.jsKB = starts[0].jsKB;
    await shot("library");
    if (flows.includes("start")) {
      Object.assign(out, {
        startUsableMs: start.usable,
        startCoversMs: start.covers,
        startLongTaskMs: start.longMs,
        startLongestTaskMs: start.longest,
        startJsKB: start.jsKB,
        startLongTaskMs5s: start.long5s
      });
    }
    const pointerAt = shape.phone ? [shape.width / 2, shape.height * 0.6] : [shape.width * 0.6, shape.height * 0.6];
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pointerAt[0], y: pointerAt[1] });

    // ---- Library fling ----
    if (flows.includes("scroll")) {
      const fling = (distance) =>
        send("Input.synthesizeScrollGesture", {
          x: pointerAt[0], y: pointerAt[1], yDistance: distance, speed: 6000,
          gestureSourceType: shape.phone ? "touch" : "mouse", preventFling: false
        });
      await fling(-1500);
      await sleep(600);
      await toTop();
      await sleep(600);
      await framesOn();
      for (let i = 0; i < 4; i++) {
        await fling(-3000);
        await sleep(200);
      }
      for (let i = 0; i < 2; i++) {
        await fling(3000);
        await sleep(200);
      }
      await sleep(800);
      const f = await framesOff();
      out.scrollJankPct = f.jank;
      out.scrollP95Ms = f.p95;
      await toTop();
      await sleep(800);
    }

    // ---- Tab switches ----
    if (flows.includes("tabs")) {
      // Each page's code is fetched once first, so what is timed is the switch itself.
      for (const tab of ["Collections", "Social", "Library"]) {
        await nav(tab);
        await sleep(1500);
      }
      const back = [];
      const away = [];
      let other = null;
      for (const tab of ["Collections", "Library", "Social", "Library", "Collections", "Library", "Social", "Library"]) {
        const since = await now();
        if (!(await nav(tab))) log.push(`no nav ${tab}`);
        await sleep(1200);
        const took = await interaction(since);
        (tab === "Library" ? back : away).push(took);
        if (tab === "Collections" && !other) other = await heap();
      }
      const onLibrary = await heap();
      Object.assign(out, {
        tabToLibraryMs: median(back),
        tabAwayMs: Math.max(...away),
        heapLibraryMB: onLibrary.heapMB,
        heapOtherTabMB: other?.heapMB ?? null,
        nodesOtherTab: other?.nodes ?? null
      });
    }

    // ---- Settings, the profile sheet, a book's menu ----
    if (flows.includes("sheets")) {
      const settings = [];
      const profile = [];
      const menu = [];
      for (let i = 0; i < 3; i++) {
        let since = await now();
        if (shape.phone) {
          await click(`document.querySelector(".profile-button")`);
          await sleep(900);
          since = await now();
          await click(`document.querySelector(".profile-settings-row")`);
        } else {
          await nav("Settings");
        }
        await sleep(1200);
        settings.push(await interaction(since));
        await nav("Library");
        await sleep(1200);
        since = await now();
        await click(`document.querySelector(".profile-button")`);
        await sleep(900);
        profile.push(await interaction(since));
        await escape();
        await sleep(800);
        since = await now();
        await click(`document.querySelector('[aria-label^="More for"]')`);
        await sleep(900);
        menu.push(await interaction(since));
        await escape();
        await sleep(800);
      }
      Object.assign(out, { settingsOpenMs: median(settings), profileOpenMs: median(profile), bookMenuOpenMs: median(menu) });
    }

    // ---- Throwing Pip about over the library ----
    if (flows.includes("pip")) {
      await toTop();
      const pip = `[...document.querySelectorAll('button[aria-label^="Pip."]')].find((b) => b.getBoundingClientRect().width > 0)`;
      if (!(await center(pip))) {
        await click(`document.querySelector("[data-pip-home]")`);
        await sleep(3000);
      }
      const at = await center(pip);
      await shot("pip-before-throw");
      if (at) {
        await framesOn();
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at[0], y: at[1] });
        await send("Input.dispatchMouseEvent", { type: "mousePressed", x: at[0], y: at[1], button: "left", clickCount: 1 });
        let [x, y] = at;
        for (let i = 0; i < 10; i++) {
          x += shape.phone ? 14 : 40;
          y -= shape.phone ? 18 : 24;
          await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
          await sleep(16);
        }
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
        await sleep(400);
        await shot("pip-thrown");
        await sleep(2100);
        const f = await framesOff();
        out.pipThrowJankPct = f.jank;
        out.pipThrowP95Ms = f.p95;
      } else {
        log.push("pip: not found");
      }
      await sleep(1500);
    }

    // ---- The Hollow, left to itself ----
    if (flows.includes("hollow")) {
      await nav("Pip");
      await sleep(3500);
      const m0 = await metrics();
      await framesOn();
      await sleep(6000);
      const f = await framesOff();
      const m1 = await metrics();
      out.hollowBusyMsPerS = ((m1.TaskDuration - m0.TaskDuration) * 1000) / (f.span / 1000);
      out.hollowJankPct = f.jank;
      await shot("hollow");
      await nav("Library");
      await sleep(1500);
    }

    // ---- Opening a book, Smart Read and auto-scroll ----
    if (flows.includes("reader")) {
      await toTop();
      // Off the rail, which opens over the first books while the pointer (or the keyboard's focus) is on it.
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pointerAt[0], y: pointerAt[1] });
      await evaluate("document.activeElement?.blur?.(), 1");
      await sleep(800);
      await evaluate(`(() => { window.__perf.text = null; const t = () => {
        const f = [...document.querySelectorAll("iframe")].find((x) => { try { return (x.contentDocument?.body?.innerText || "").trim().length > 200 && x.getBoundingClientRect().width > 0; } catch { return false; } });
        if (f) { window.__perf.text = performance.now(); return; } requestAnimationFrame(t); }; requestAnimationFrame(t); return 1; })()`);
      await shot("before-open");
      const since = await now();
      if (!(await click(`document.querySelector(".book-card button, .book-card")`))) log.push("no book card");
      let text = null;
      for (let i = 0; i < 200 && !text; i++) {
        await sleep(100);
        text = await evaluate("window.__perf.text");
      }
      out.openFirstTextMs = text ? text - since : null;
      if (!text) log.push("reader: no text");
      await shot("book-open");
      await sleep(2500);
      // The "welcome back" card, if it comes: carry on.
      await evaluate(`(() => { const b = [...document.querySelectorAll("button")].find((x) => /^carry on$/i.test((x.textContent || "").trim())); b?.click(); return 1; })()`);
      await sleep(800);
      const smart = await evaluate(`(async () => { const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const more = document.querySelector('[aria-label^="More: reading mode"]'); if (!more) return "no menu";
        more.click(); await sleep(500);
        const select = [...document.querySelectorAll("select")].find((x) => [...x.options].some((o) => o.value === "smart"));
        if (!select) return "no select";
        const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
        set.call(select, "smart"); select.dispatchEvent(new Event("change", { bubbles: true }));
        await sleep(800);
        const b = [...document.querySelectorAll("button")].find((x) => /current view/i.test(x.textContent || "")); b?.click();
        await sleep(600); return b ? "ok" : "no start"; })()`);
      if (smart === "ok") {
        await sleep(800);
        await framesOn();
        await sleep(6000);
        out.smartJankPct = (await framesOff()).jank;
      } else {
        log.push(`smart: ${smart}`);
      }
      const auto = await evaluate(`(async () => { const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const more = document.querySelector('[aria-label^="More: reading mode"]'); if (!more) return "no menu";
        more.click(); await sleep(500);
        const select = [...document.querySelectorAll("select")].find((x) => [...x.options].some((o) => o.value === "smart"));
        if (select && select.value !== "standard" && [...select.options].some((o) => o.value === "standard")) {
          const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
          set.call(select, "standard"); select.dispatchEvent(new Event("change", { bubbles: true })); await sleep(700); }
        if (!document.querySelector('[title="Start auto scroll"]')) { document.querySelector('[aria-label^="More: reading mode"]')?.click(); await sleep(500); }
        const b = document.querySelector('[title="Start auto scroll"]'); if (!b) return "no auto"; b.click(); await sleep(300); return "ok"; })()`);
      if (auto === "ok") {
        await escape();
        await sleep(1000);
        await framesOn();
        await sleep(6000);
        out.autoJankPct = (await framesOff()).jank;
      } else {
        log.push(`auto: ${auto}`);
      }
    }
  } finally {
    await throttle(1).catch(() => undefined);
    out._log = log;
    out._errors = page.errors.slice(0, 5);
    await page.close();
  }
  return out;
}

// ---- Run, compare, report ------------------------------------------------------------------------
const results = {};
for (const config of configs) {
  if (!ALL_CONFIGS.includes(config)) {
    console.error(`Unknown config ${config} (${ALL_CONFIGS.join(", ")})`);
    process.exit(2);
  }
  const each = [];
  for (let run = 0; run < runs; run++) {
    process.stdout.write(`Measuring ${config}${runs > 1 ? ` (run ${run + 1} of ${runs})` : ""}…\n`);
    each.push(await measureConfig(config));
  }
  const merged = {};
  for (const key of Object.keys(METRICS)) {
    const value = median(each.map((r) => r[key]));
    if (value != null) merged[key] = round(value, METRICS[key][1] === "%" || METRICS[key][1] === "MB" ? 1 : 0);
  }
  const notes = [...new Set(each.flatMap((r) => [...r._log, ...r._errors]))];
  if (notes.length) console.log(`  notes: ${notes.join(" | ")}`);
  results[config] = merged;
}
server.close();

if (option("--json")) writeFileSync(option("--json"), JSON.stringify(results, null, 2));

const budgets = flag("--update") ? writeBudgets(results) : readBudgets();

let failed = 0;
for (const [config, values] of Object.entries(results)) {
  const limits = budgets.configs?.[config] ?? {};
  const rows = Object.entries(values).map(([key, value]) => {
    const limit = limits[key];
    const over = limit != null && value > limit;
    if (over) failed += 1;
    return [METRICS[key][0], `${value} ${METRICS[key][1]}`, limit == null ? "-" : `${limit} ${METRICS[key][1]}`, limit == null ? "no budget" : over ? "OVER" : "ok"];
  });
  const widths = [0, 1, 2, 3].map((i) => Math.max(...rows.map((r) => r[i].length), ["Flow", "Measured", "Budget", ""][i].length));
  const line = (r) => r.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join("  ");
  console.log(`\n${config} (${SHAPES[config.split("-")[0]].width}x${SHAPES[config.split("-")[0]].height}, CPU ${config.split("-")[1]})`);
  console.log(line(["Flow", "Measured", "Budget", ""]));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) console.log(line(r));
}
if (failed && !flag("--update")) {
  console.log(`\n${failed} over budget. A slower machine, or a busy one, measures slower: run again before believing it.`);
  process.exit(1);
}
console.log("\nAll within budget.");
